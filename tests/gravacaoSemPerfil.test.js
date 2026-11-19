// tests/gravacaoSemPerfil.test.js
// Gravações que respondiam "salvo" sem gravar nada.
//
// Foto do dev, perfil e logo da empresa, e a edição pelo admin fazem UPDATE
// no perfil (user_dev_profiles / user_company_profiles). Numa conta sem a linha
// do perfil, o UPDATE não pegava em nada e a resposta era sucesso: a tela
// mostrava o valor novo (até a foto, vinda da sessão) e ele sumia no próximo
// login. Agora: a foto do dev cria o perfil que falta (como a edição do perfil
// já fazia); empresa e admin recebem um erro em vez do falso "salvo". O banco
// é simulado.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/githubAnalyzer", () => ({ analisarGitHub: jest.fn(), matchSkillsFromGitHub: jest.fn().mockResolvedValue() }));
jest.mock("../services/subscriptionService", () => ({
  getUserPlan: jest.fn().mockResolvedValue({ code: "dev_free", name: "Free", price_cents: 0, features: [] }),
}));

const express = require("express");
const request = require("supertest");
const db = require("../database/db");
const profileController = require("../controllers/profileController");
const empresaController = require("../controllers/empresaController");
const adminController = require("../controllers/adminController");

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(32, 7)]);

let consultas, perfilExiste;
beforeEach(() => {
  jest.clearAllMocks();
  consultas = [];
  perfilExiste = false; // a conta não tem a linha do perfil
  db.query.mockImplementation(async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    consultas.push({ sql: q, params });
    if (q.startsWith("INSERT INTO user_photos")) return [{ affectedRows: 1 }];
    if (/^UPDATE user_(dev|company)_profiles SET/.test(q)) return [{ affectedRows: perfilExiste ? 1 : 0 }];
    if (q.startsWith("INSERT INTO user_dev_profiles")) return [{ affectedRows: 1 }];
    if (/^SELECT id FROM users WHERE id = \? AND type = '(dev|empresa)'/.test(q)) return [[{ id: params[0] }]];
    if (q.startsWith("UPDATE users SET active")) return [{ affectedRows: 1 }];
    if (q.startsWith("SELECT id, email, type, created_at FROM users")) return [[{ id: 9, email: "ana@exemplo.com", type: "dev", created_at: null }]];
    if (q.startsWith("SELECT * FROM user_dev_profiles")) return [[{ user_id: 9, nome: "Ana", sobrenome: null, github_login: null, nivel: "iniciante", avatar_url: null }]];
    if (/FROM user_skills|FROM user_skill_evidencias|FROM user_skill_declaracoes/.test(q)) return [[]];
    throw new Error(`SQL inesperado no teste: ${q}`);
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function app(user, montar) {
  const sessao = { user };
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = sessao; next(); });
  montar(a);
  return { app: a, sessao };
}
const gravou = re => consultas.some(c => re.test(c.sql));

describe("foto do dev", () => {
  test("conta sem a linha do perfil: a foto cria o perfil e fica salva", async () => {
    const { app: a } = app({ id: 9, type: "dev", name: "Ana" }, x => x.post("/avatar", profileController.handleAvatarUpload, profileController.saveAvatar));
    const res = await request(a).post("/avatar").attach("avatar", PNG, { filename: "eu.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    const insert = consultas.find(c => c.sql.startsWith("INSERT INTO user_dev_profiles"));
    expect(insert).toBeDefined();
    expect(insert.params).toEqual([9, res.body.avatar]);
  });

  test("com o perfil, só atualiza a foto (nada é criado)", async () => {
    perfilExiste = true;
    const { app: a } = app({ id: 9, type: "dev" }, x => x.post("/avatar", profileController.handleAvatarUpload, profileController.saveAvatar));
    const res = await request(a).post("/avatar").attach("avatar", PNG, { filename: "eu.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(gravou(/^INSERT INTO user_dev_profiles/)).toBe(false);
  });

  test("a tela de perfil mostra a foto salva no banco, não a que só ficou na sessão", async () => {
    const { app: a } = app({ id: 9, type: "dev", avatar: "https://avatars.githubusercontent.com/u/1?v=4" }, x => x.get("/perfil", profileController.getProfile));
    const res = await request(a).get("/perfil");
    expect(res.status).toBe(200);
    expect(res.body.avatar).toBeNull(); // o banco não tem foto: é o que os outros veem
  });
});

describe("empresa sem a linha do perfil", () => {
  test("salvar o perfil responde erro, em vez de um falso 'salvo'", async () => {
    const { app: a, sessao } = app({ id: 8, type: "empresa", name: "Azul" }, x => x.patch("/perfil", empresaController.updateProfile));
    const res = await request(a).patch("/perfil").send({ nome_fantasia: "Azul Tech" });
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual(expect.any(String));
    expect(res.body.success).toBeUndefined();
    expect(sessao.user.name).toBe("Azul"); // o cabeçalho não mostra o que não foi salvo
  });

  test("enviar o logo responde erro, e o cabeçalho não troca a foto", async () => {
    const { app: a, sessao } = app({ id: 8, type: "empresa", avatar: null }, x => x.post("/logo", empresaController.handleLogoUpload, empresaController.saveLogo));
    const res = await request(a).post("/logo").attach("logo", PNG, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(404);
    expect(res.body.logo).toBeUndefined();
    expect(sessao.user.avatar).toBeNull();
  });

  test("com o perfil, salva normalmente", async () => {
    perfilExiste = true;
    const { app: a, sessao } = app({ id: 8, type: "empresa", name: "Azul" }, x => x.patch("/perfil", empresaController.updateProfile));
    const res = await request(a).patch("/perfil").send({ nome_fantasia: "Azul Tech" });
    expect(res.status).toBe(200);
    expect(sessao.user.name).toBe("Azul Tech");
  });
});

describe("admin editando conta sem a linha do perfil", () => {
  const admin = { id: 1, type: "admin" };
  test.each([
    ["dev", "/users/9", "updateUserStatus", { nome: "Ana", active: false }],
    ["empresa", "/empresas/8", "updateEmpresaStatus", { nome_fantasia: "Azul Tech", active: false }],
  ])("%s: responde erro e não grava nada (nem a suspensão pedida junto)", async (_t, rota, handler, body) => {
    const { app: a } = app(admin, x => x.patch(rota.replace(/\d+$/, ":id"), adminController[handler]));
    const res = await request(a).patch(rota).send(body);
    expect(res.status).toBe(404);
    expect(res.body.success).toBeUndefined();
    expect(gravou(/^UPDATE users SET active/)).toBe(false);
  });
});
