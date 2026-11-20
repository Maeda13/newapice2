// tests/sessao.test.js
// Sessão de login: 7 dias, renovados a cada visita. Antes eram 24 horas contadas
// do login, sem renovação: no dia seguinte a pessoa voltava deslogada, mesmo
// tendo usado o site na véspera, e o que estava fazendo se perdia.
//
// O relógio é simulado (Date.now): o servidor, o session store em memória e o
// "navegador" do supertest (que descarta cookies vencidos) usam o mesmo.
const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const request = require("supertest");

const DIA = 24 * 60 * 60 * 1000;
const ler = rel => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

let agora;
beforeEach(() => {
  agora = Date.parse("2026-11-19T12:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => agora);
});
afterEach(() => jest.restoreAllMocks());

function navegador() {
  const { opcoesDaSessao } = require("../config/sessao");
  const app = express();
  app.use(session(opcoesDaSessao({ secret: "segredo-de-teste", store: new session.MemoryStore(), isProd: false })));
  app.post("/login", (req, res) => { req.session.user = { id: 1 }; res.sendStatus(204); });
  app.get("/pagina", (req, res) => res.json({ logado: Boolean(req.session.user) })); // não muda a sessão
  return request.agent(app);
}

test("quem volta no dia seguinte continua logado", async () => {
  const eu = navegador();
  await eu.post("/login");
  agora += 2 * DIA;
  expect((await eu.get("/pagina")).body.logado).toBe(true);
});

test("cada visita renova o prazo: quem usa o site toda semana não é deslogado", async () => {
  const eu = navegador();
  await eu.post("/login");
  for (let semana = 0; semana < 4; semana++) {
    agora += 6 * DIA;
    expect((await eu.get("/pagina")).body.logado).toBe(true);
  }
});

test("depois de 7 dias sem entrar no site, a sessão vence", async () => {
  const eu = navegador();
  await eu.post("/login");
  agora += 7 * DIA + 60 * 1000;
  expect((await eu.get("/pagina")).body.logado).toBe(false);
});

test("o cookie continua só HTTP, sameSite=lax e seguro em produção", () => {
  const { opcoesDaSessao } = require("../config/sessao");
  const { cookie, resave, saveUninitialized } = opcoesDaSessao({ secret: "x", store: null, isProd: true });
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
  expect({ resave, saveUninitialized }).toEqual({ resave: false, saveUninitialized: false });
});

test("server.js usa essas opções, e o session store guarda a mesma validade", () => {
  const { opcoesDoStore, SESSAO_MS } = require("../config/sessao");
  expect(opcoesDoStore.expiration).toBe(SESSAO_MS);
  const src = ler("server.js");
  expect(src).toMatch(/app\.use\(session\(opcoesDaSessao\(/);
  expect(src).toMatch(/new MySQLStore\(\{ \.\.\.opcoesDoStore \}, db\)/);
});
