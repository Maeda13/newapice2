// tests/sessaoAtualizada.test.js
// A sessão guardava uma cópia do usuário feita no login e nunca mais a
// conferia com o banco. Sessões de dev abertas por e-mail ficaram sem o
// github_id (a chave dos dados do dev), o que mudava noutro aparelho ou pelo
// admin não chegava a quem já estava logado, e conta suspensa continuava
// navegando até a sessão vencer. O banco é simulado.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const request = require("supertest");
const db = require("../database/db");
const { sessaoAtualizada, INTERVALO_MS } = require("../middlewares/sessaoAtualizada");

let banco, agora;
beforeEach(() => {
  jest.clearAllMocks();
  agora = Date.parse("2026-11-19T12:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => agora);
  jest.spyOn(console, "error").mockImplementation(() => {});
  banco = {
    users: { 7: { type: "dev", active: 1 }, 8: { type: "empresa", active: 1 }, 9: { type: "admin", active: 1 } },
    dev: { 7: { nome: "Ana", sobrenome: "Lima", github_login: "ana-dev", github_id: 5551234, nivel: "junior", avatar_url: "/api/fotos/7?v=1" } },
    empresa: { 8: { nome_fantasia: "Azul Tech", razao_social: "Azul Tecnologia Ltda", logo_url: "/api/fotos/8?v=3" } },
    admin: { 9: { nome: "Carla" } },
  };
  db.query.mockImplementation(async (sql, [id]) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT type, active FROM users WHERE id = ?")) return [banco.users[id] ? [banco.users[id]] : []];
    if (q.startsWith("SELECT nome, sobrenome, github_login, github_id, nivel, avatar_url FROM user_dev_profiles")) return [banco.dev[id] ? [banco.dev[id]] : []];
    if (q.startsWith("SELECT nome_fantasia, razao_social, logo_url FROM user_company_profiles")) return [banco.empresa[id] ? [banco.empresa[id]] : []];
    if (q.startsWith("SELECT nome FROM user_admin_profiles")) return [banco.admin[id] ? [banco.admin[id]] : []];
    throw new Error(`SQL inesperado no teste: ${q}`);
  });
});
afterEach(() => jest.restoreAllMocks());

// "navegador" com uma sessão aberta com o usuário dado (como o login a deixou)
async function logadoComo(user) {
  const app = express();
  app.use(session({ secret: "segredo-de-teste", resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.post("/entrar", (req, res) => { req.session.user = user; res.sendStatus(204); });
  app.use(sessaoAtualizada);
  app.get("/eu", (req, res) => res.json({ user: req.session?.user ?? null }));
  const nav = request.agent(app);
  await nav.post("/entrar");
  return nav;
}
const consultasDeConta = () => db.query.mock.calls.filter(([sql]) => sql.startsWith("SELECT type, active FROM users")).length;

test("sessão de dev aberta por e-mail sem o github_id passa a usar a chave do banco", async () => {
  const nav = await logadoComo({ id: 7, type: "dev", email: "ana@exemplo.com", name: "Ana Lima" });
  const { user } = (await nav.get("/eu")).body;
  expect(user.github_id).toBe(5551234);
});

test("nome, foto e nível mudados noutro aparelho aparecem para quem já estava logado", async () => {
  const nav = await logadoComo({ id: 7, type: "dev", github_id: 5551234, name: "Ana", avatar: null, nivel: "iniciante" });
  banco.dev[7] = { ...banco.dev[7], nome: "Ana Maria", avatar_url: "/api/fotos/7?v=2", nivel: "pleno" };
  const { user } = (await nav.get("/eu")).body;
  expect(user).toMatchObject({ name: "Ana Maria Lima", avatar: "/api/fotos/7?v=2", nivel: "pleno", github_login: "ana-dev" });
});

test("empresa: nome e logo vêm do banco", async () => {
  const nav = await logadoComo({ id: 8, type: "empresa", name: "Empresa", avatar: null });
  const { user } = (await nav.get("/eu")).body;
  expect(user).toMatchObject({ name: "Azul Tech", razao_social: "Azul Tecnologia Ltda", avatar: "/api/fotos/8?v=3" });
});

test("admin: nome vem do banco", async () => {
  const nav = await logadoComo({ id: 9, type: "admin", name: "Admin" });
  expect((await nav.get("/eu")).body.user.name).toBe("Carla");
});

test("o que a sessão tem e o banco não (perfil faltando) é mantido", async () => {
  delete banco.empresa[8];
  const nav = await logadoComo({ id: 8, type: "empresa", name: "Azul Tech" });
  expect((await nav.get("/eu")).body.user.name).toBe("Azul Tech");
});

test.each([
  ["suspensa pelo admin", (b) => { b.users[7].active = 0; }],
  ["excluída", (b) => { delete b.users[7]; }],
])("conta %s perde a sessão", async (_caso, mudar) => {
  const nav = await logadoComo({ id: 7, type: "dev", github_id: 5551234 });
  mudar(banco);
  expect((await nav.get("/eu")).body.user).toBeNull();
  expect((await nav.get("/eu")).body.user).toBeNull(); // e não volta
});

test("confere no máximo uma vez a cada 5 minutos por sessão", async () => {
  const nav = await logadoComo({ id: 7, type: "dev" });
  await nav.get("/eu");
  await nav.get("/eu");
  expect(consultasDeConta()).toBe(1);
  agora += INTERVALO_MS;
  await nav.get("/eu");
  expect(consultasDeConta()).toBe(2);
  expect(INTERVALO_MS).toBe(5 * 60 * 1000);
});

test("com o banco fora do ar, segue com a sessão como está (e tenta de novo depois)", async () => {
  const nav = await logadoComo({ id: 7, type: "dev", name: "Ana Lima" });
  db.query.mockRejectedValueOnce(Object.assign(new Error("caiu"), { code: "ECONNRESET" }));
  const res = await nav.get("/eu");
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: 7, name: "Ana Lima" });
  expect((await nav.get("/eu")).body.user.github_id).toBe(5551234);
});

test("server.js confere a sessão logo depois de abri-la, antes de expor o usuário às telas", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const iSessao = src.indexOf("app.use(session(opcoesDaSessao(");
  const iConfere = src.indexOf('app.use(require("./middlewares/sessaoAtualizada").sessaoAtualizada);');
  const iExpoe = src.indexOf("app.use(exposeUser);");
  expect(iSessao).toBeGreaterThan(-1);
  expect(iConfere).toBeGreaterThan(iSessao);
  expect(iExpoe).toBeGreaterThan(iConfere);
});
