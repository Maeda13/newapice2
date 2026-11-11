// tests/empresaDashboard.test.js
// Novo dashboard da empresa (GET /api/empresa/dashboard): além do que já
// devolvia, entrega área e nº de matches por vaga, conversas abertas, matches
// de alta compatibilidade, "Matches Destaque" e "Devs visualizados
// recentemente" (registrados quando a empresa abre o perfil de um dev).
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn().mockResolvedValue({ code: "dev_free" }),
  getPlanCodesBulk: jest.fn(async (ids) => Object.fromEntries(ids.map(id => [id, id === 11 ? "dev_pro" : "dev_free"]))),
}));

const db = require("../database/db");
const controller = require("../controllers/empresaController");

const EMPRESA = 5;

const JOBS = [
  { id: 1, title: "Estágio Front", level: "estagio", description: "", active: 1, created_at: "2026-03-20T00:00:00Z",
    total_skills: 2, total_candidatos: 0, avg_progress: null, total_candidaturas: 200, total_matches: 17 },
  { id: 2, title: "Vaga sem skills", level: "junior", description: "", active: 0, created_at: "2026-02-01T00:00:00Z",
    total_skills: 0, total_candidatos: 0, avg_progress: null, total_candidaturas: 0, total_matches: 0 },
];

function instalarFakeDb({ falhaMatchs = false, falhaViews = false, recentes = [], areaExplicita = null } = {}) {
  const jobs = JOBS.map((j, i) => (i === 0 && areaExplicita ? { ...j, area: areaExplicita } : j));
  db.query.mockImplementation(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.startsWith("select * from user_company_profiles")) return [[{ nome_fantasia: "Tech", razao_social: "Tech LTDA" }]];
    if (s.includes("group by j.id")) return [jobs];
    if (s.includes("from job_skills js join skills s") && s.includes("js.job_id in")) {
      return [[{ job_id: 1, habilidade: "HTML" }, { job_id: 1, habilidade: "Responsividade" }, { job_id: 1, habilidade: "Acessibilidade Web" }]];
    }
    if (s.includes("from conversations")) return [[{ total: 35 }]];

    // matches (mesmas consultas de GET /api/empresa/matchs)
    if (s.startsWith("select id, title, level from jobs where company_id")) {
      if (falhaMatchs) throw new Error("boom");
      return [[{ id: 1, title: "Estágio Front", level: "estagio" }]];
    }
    if (s.startsWith("select job_id, skill_id, importance from job_skills")) {
      return [[{ job_id: 1, skill_id: 1, importance: "obrigatoria" }, { job_id: 1, skill_id: 2, importance: "obrigatoria" }]];
    }
    if (s.includes("from user_dev_profiles where github_id is not null")) {
      return [[
        { id: 10, github_id: 100, nome: "Ana",   github_login: "ana",   nivel: "iniciante" },
        { id: 11, github_id: 101, nome: "Bruno", github_login: "bruno", nivel: "iniciante" },
        { id: 12, github_id: 102, nome: "Caio",  github_login: "caio",  nivel: "iniciante" },
      ]];
    }
    if (s.startsWith("select github_id, skill_id, confidence from user_skills")) {
      return [[
        { github_id: 100, skill_id: 1, confidence: 90 }, { github_id: 100, skill_id: 2, confidence: 90 }, // Ana: alto
        { github_id: 101, skill_id: 1, confidence: 90 },                                                   // Bruno: médio
        { github_id: 102, skill_id: 1, confidence: 5 },                                                    // Caio: baixo
      ]];
    }
    if (s.startsWith("select dev_github_id, job_id, action from company_match_actions")) return [[]];

    // devs visualizados recentemente
    if (s.includes("from company_dev_views")) {
      if (falhaViews) { const e = new Error("no table"); e.code = "ER_NO_SUCH_TABLE"; throw e; }
      return [recentes];
    }
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

function chamar(handler, extra = {}) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  const req = { session: { user: { id: EMPRESA, type: "empresa" } }, params: {}, ...extra };
  return handler(req, res).then(() => res);
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/empresa/dashboard — novo layout", () => {
  test("cada vaga traz a área inferida pelas skills e o nº de matches; vaga sem skills fica sem área", async () => {
    instalarFakeDb();
    const { body } = await chamar(controller.getDashboard);

    const [v1, v2] = body.jobs;
    expect(v1.area).toBe("front-end");
    expect(v1.total_matches).toBe(17);
    expect(v1.total_candidaturas).toBe(200);
    expect(v2.area).toBeNull();
  });

  test("a área escolhida no formulário da vaga vence a inferida pelas skills", async () => {
    instalarFakeDb({ areaExplicita: "dados" });
    const { body } = await chamar(controller.getDashboard);
    expect(body.jobs[0].area).toBe("dados"); // skills inferiam "front-end"
  });

  test("stats: vagas disponíveis, conversas abertas e matches de alta compatibilidade (>= 70%)", async () => {
    instalarFakeDb();
    const { body } = await chamar(controller.getDashboard);

    expect(body.stats.vagasAtivas).toBe(1);
    expect(body.stats.conversasAbertas).toBe(35);
    expect(body.stats.matchesAltos).toBe(1); // só a Ana passa de 70%
  });

  test("Matches Destaque: melhores matches primeiro, no máximo um por dev, até 5", async () => {
    instalarFakeDb();
    const { body } = await chamar(controller.getDashboard);

    const nomes = body.matchesDestaque.map(m => m.dev);
    expect(nomes[0]).toBe("Ana");
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(body.matchesDestaque.length).toBeLessThanOrEqual(5);
    const scores = body.matchesDestaque.map(m => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(body.matchesDestaque[0]).toEqual(expect.objectContaining({ dev_id: 10, job: "Estágio Front", job_id: 1 }));
  });

  test("devs visualizados recentemente: nome, nível, PRO e data, na ordem devolvida pelo banco", async () => {
    instalarFakeDb({ recentes: [
      { id: 11, nome: "Bruno", sobrenome: "Silva", github_login: "bruno", nivel: "intermediario", avatar_url: null, viewed_at: "2026-04-01T10:00:00Z" },
      { id: 10, nome: "Ana", sobrenome: null, github_login: "ana", nivel: "iniciante", avatar_url: "/u/a.png", viewed_at: "2026-03-30T10:00:00Z" },
    ] });
    const { body } = await chamar(controller.getDashboard);

    expect(body.devsRecentes).toEqual([
      expect.objectContaining({ id: 11, name: "Bruno Silva", level: "junior", isPro: true, github: "bruno" }),
      expect.objectContaining({ id: 10, name: "Ana", level: "estagio", isPro: false, avatar_url: "/u/a.png" }),
    ]);
  });

  test("falha nos blocos novos (matches/visualizações) não derruba o dashboard", async () => {
    instalarFakeDb({ falhaMatchs: true, falhaViews: true });
    const res = await chamar(controller.getDashboard);

    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.matchesDestaque).toEqual([]);
    expect(res.body.devsRecentes).toEqual([]);
    expect(res.body.stats.matchesAltos).toBe(0);
  });
});

describe("GET /api/empresa/dev/:id — registra a visualização", () => {
  function instalarFakeDbPerfil({ falhaInsert = false } = {}) {
    db.query.mockImplementation(async (sql, params = []) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
      if (s.includes("from user_dev_profiles where user_id")) {
        return [[{ id: 10, github_id: 100, nome: "Ana", sobrenome: null, github_login: "ana", nivel: "iniciante", avatar_url: null }]];
      }
      if (s.includes("from user_skills us")) return [[]];
      if (s.startsWith("select id, title, level from jobs")) return [[]];
      if (s.includes("from user_roadmap_progress")) return [[]];
      if (s.startsWith("insert into company_dev_views")) {
        if (falhaInsert) throw new Error("boom");
        return [{ affectedRows: 1 }];
      }
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
  }

  test("grava (empresa, dev) em company_dev_views com upsert", async () => {
    instalarFakeDbPerfil();
    const res = await chamar(controller.getDevProfile, { params: { id: "10" } });

    expect(res.statusCode).toBe(200);
    const insert = db.query.mock.calls.find(([sql]) => /insert into company_dev_views/i.test(sql));
    expect(insert).toBeDefined();
    expect(insert[0]).toMatch(/on duplicate key update/i);
    expect(insert[1]).toEqual([EMPRESA, 10]);
  });

  test("falha ao registrar não impede de mostrar o perfil", async () => {
    instalarFakeDbPerfil({ falhaInsert: true });
    const res = await chamar(controller.getDevProfile, { params: { id: "10" } });

    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe("Ana");
  });
});
