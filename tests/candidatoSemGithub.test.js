// tests/candidatoSemGithub.test.js
// Dev sem GitHub visto pela empresa.
//
// Candidaturas, conversas e skills guardam a chave do dev: o github_id, ou o
// id da conta de quem não tem GitHub (getUserId). As telas da empresa ligavam
// essas linhas ao perfil só pelo github_id: quem se candidatou sem GitHub
// sumia da lista de candidatos do painel (ou aparecia sem nome na lista da
// vaga), e o perfil dele aberto pela empresa vinha sem skills.
//
// As condições de JOIN são lidas do próprio código e avaliadas contra perfis
// de exemplo; o banco é simulado.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(), getPlanCodesBulk: jest.fn().mockResolvedValue({}),
  getUserPlan: jest.fn().mockResolvedValue({ code: "empresa_free", name: "Free", price_cents: 0, features: [] }),
}));

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const db = require("../database/db");
const empresaController = require("../controllers/empresaController");

const ler = rel => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// "udp.github_id = ja.dev_github_id OR (...)" → (p, k) => p.github_id === k || (...)
function predicado(condicao, colunaDaChave) {
  const js = condicao
    .replace(/\budp\.github_id IS NULL\b/g, "(p.github_id == null)")
    .replace(/\budp\.(\w+)/g, "p.$1")
    .split(colunaDaChave).join("k")
    .replace(/\bOR\b/g, "||").replace(/\bAND\b/g, "&&")
    .replace(/(?<![=!<>])=(?!=)/g, "===");
  return new Function("p", "k", `return ${js};`);
}
const condicoes = (fonte, coluna) =>
  [...fonte.matchAll(/JOIN user_dev_profiles udp ON (.+)$/gm)].map(m => m[1].trim()).filter(c => c.includes(coluna));

const ANA = { user_id: 7, github_id: 9001, nome: "Ana", sobrenome: "Lima", github_login: "ana-gh", nivel: "junior", avatar_url: null };
const BIA = { user_id: 8, github_id: null, nome: "Bia", sobrenome: "Souza", github_login: null, nivel: "iniciante", avatar_url: null };
const CAIO = { user_id: 42, github_id: 777, nome: "Caio", sobrenome: null, github_login: "caio", nivel: "pleno", avatar_url: null };

describe.each([
  ["candidaturas (empresaController)", "controllers/empresaController.js", "ja.dev_github_id", 2],
  ["conversas (messagesController)", "controllers/messagesController.js", "c.dev_github_id", 1],
])("ligação ao perfil do dev: %s", (_nome, arquivo, coluna, quantas) => {
  const lista = condicoes(ler(arquivo), coluna);

  test("todas as ligações foram encontradas", () => {
    expect(lista).toHaveLength(quantas);
  });

  test("dev com GitHub: liga pelo github_id", () => {
    for (const c of lista) expect(predicado(c, coluna)(ANA, 9001)).toBe(true);
  });

  test("dev sem GitHub: liga pelo id da conta", () => {
    for (const c of lista) expect(predicado(c, coluna)(BIA, 8)).toBe(true);
  });

  test("o id de uma conta COM GitHub não é confundido com o github_id de outro dev", () => {
    // a linha com a chave 42 é do dev cujo github_id é 42, não do Caio (conta 42)
    for (const c of lista) expect(predicado(c, coluna)(CAIO, 42)).toBe(false);
  });
});

describe("telas da empresa", () => {
  const PERFIS = [ANA, BIA];
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  function app(montar) {
    const a = express();
    a.use((req, _res, next) => { req.session = { user: { id: 50, type: "empresa" } }; next(); });
    montar(a);
    return a;
  }

  test("lista de candidatos da vaga: quem se candidatou sem GitHub aparece com nome", async () => {
    const candidaturas = [
      { id: 1, job_id: 3, dev_github_id: 9001, created_at: null, resumo_ia: null },
      { id: 2, job_id: 3, dev_github_id: 8, created_at: null, resumo_ia: null },
    ];
    db.query.mockImplementation(async (sql) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT id, title, level FROM jobs WHERE id = ? AND company_id = ?")) return [[{ id: 3, title: "Dev", level: "junior" }]];
      if (q.includes("FROM job_applications ja")) {
        const liga = predicado(sql.match(/JOIN user_dev_profiles udp ON (.+)$/m)[1].trim(), "ja.dev_github_id");
        return [candidaturas.map(a => {
          const p = PERFIS.find(x => liga(x, a.dev_github_id));
          return { ...a, dev_id: p?.user_id ?? null, dev_nome: p?.nome ?? null, github_login: p?.github_login ?? null, nivel: p?.nivel ?? null, avatar_url: null };
        })];
      }
      throw new Error(`SQL inesperado no teste: ${q}`);
    });
    const res = await request(app(a => a.get("/jobs/:id/candidaturas", empresaController.getJobApplications))).get("/jobs/3/candidaturas");
    expect(res.status).toBe(200);
    expect(res.body.applications.map(a => [a.dev_id, a.dev_nome])).toEqual([[7, "Ana"], [8, "Bia"]]);
  });

  test("perfil do dev sem GitHub aberto pela empresa: vem com as skills dele", async () => {
    const skillsPorChave = { 8: [{ skill_id: 1, name: "React", category: "Frontend", type: "hard", confidence: 70, source: "manual" }] };
    db.query.mockImplementation(async (sql, params = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT user_id AS id, github_id, nome, sobrenome")) return [[{ ...BIA, id: BIA.user_id }]];
      if (q.startsWith("INSERT INTO company_dev_views")) return [{ affectedRows: 1 }];
      if (q.includes("FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.github_id = ?")) return [skillsPorChave[params[0]] ?? []];
      if (q.includes("WHERE us.github_id IN (?)")) {
        return [params[0].flatMap(k => (skillsPorChave[k] ?? []).map(s => ({ github_id: k, skill_id: s.skill_id, confidence: s.confidence, name: s.name })))];
      }
      return [[]]; // vagas, roadmaps, progresso
    });
    const res = await request(app(a => a.get("/dev/:id", empresaController.getDevProfile))).get("/dev/8");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("React");
  });
});
