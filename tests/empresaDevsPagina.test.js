// tests/empresaDevsPagina.test.js
// Página "Desenvolvedores" da empresa (antes "Candidatos"): aba "Dev em Vagas"
// (candidatos agrupados por vaga) e aba "Desenvolvedores Geral".
//   - GET /api/empresa/jobs/candidatos
//   - estrutura semântica da página
//   - item de menu renomeado para "Desenvolvedores"
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn().mockResolvedValue({ code: "empresa_free" }),
  getPlanCodesBulk: jest.fn(async (ids) => Object.fromEntries(ids.map(id => [id, id === 11 ? "dev_pro" : "dev_free"]))),
}));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const db = require("../database/db");
const controller = require("../controllers/empresaController");

const EMPRESA = 5;
const VIEWS = path.join(__dirname, "..", "views");

const JOBS = [
  { id: 1, title: "Estágio Front", level: "estagio", active: 1, area: null, created_at: "2026-03-20T12:00:00Z", total_candidaturas: 3, total_matches: 17 },
  { id: 2, title: "Vaga sem candidatos", level: "junior", active: 0, area: "dados", created_at: "2026-02-01T12:00:00Z", total_candidaturas: 0, total_matches: 0 },
];

function instalarFakeDb({ candidaturas, devSkills, actions = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
    if (s.includes("from jobs j") && s.includes("total_candidaturas")) return [JOBS];
    if (s.includes("from job_skills js join skills s") && s.includes("js.job_id in")) {
      return [[{ job_id: 1, habilidade: "HTML" }, { job_id: 1, habilidade: "Responsividade" }, { job_id: 1, habilidade: "Acessibilidade Web" }]];
    }
    if (s.startsWith("select job_id, skill_id, importance from job_skills")) {
      return [[1, 2, 3].map(skill_id => ({ job_id: 1, skill_id, importance: "obrigatoria" }))];
    }
    if (s.includes("from job_applications ja") && s.includes("join user_dev_profiles")) return [candidaturas];
    if (s.includes("from user_skills us join skills s")) return [devSkills];
    if (s.includes("from company_match_actions")) return [actions];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

const dev = (user, github, nome, nivel = "iniciante", extra = {}) => ({
  job_id: 1, dev_github_id: github, created_at: "2026-04-01T00:00:00Z",
  dev_id: user, nome, sobrenome: null, github_login: nome.toLowerCase(), nivel, ...extra,
});
const sk = (github, skill_id, name, confidence) => ({ github_id: github, skill_id, name, confidence });

function chamar(handler) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return handler({ session: { user: { id: EMPRESA, type: "empresa" } }, params: {}, query: {} }, res).then(() => res);
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/empresa/jobs/candidatos", () => {
  test("agrupa por vaga: dados da vaga (área, datas, totais) e candidatos ordenados por compatibilidade", async () => {
    instalarFakeDb({
      candidaturas: [dev(11, 101, "Bruno"), dev(10, 100, "Ana", "avancado", { sobrenome: "Lima" })],
      devSkills: [
        sk(100, 1, "HTML", 90), sk(100, 2, "CSS", 90), sk(100, 3, "Git", 80), sk(100, 4, "Docker", 70), sk(100, 5, "SQL", 60), sk(100, 6, "Python", 50),
        sk(101, 1, "HTML", 30),
      ],
      actions: [
        { dev_github_id: 100, job_id: 1, action: "aceito" },
        { dev_github_id: 101, job_id: 1, action: "recusado" },
      ],
    });

    const { body } = await chamar(controller.getJobsComCandidatos);

    const [v1, v2] = body;
    expect(v1).toEqual(expect.objectContaining({
      id: 1, title: "Estágio Front", active: true, area: "front-end", level: "estagio",
      total_candidaturas: 3, total_matches: 17,
    }));
    expect(v1.candidatos.map(c => c.name)).toEqual(["Ana Lima", "Bruno"]);
    expect(v1.candidatos[0].score).toBeGreaterThan(v1.candidatos[1].score);
    expect(v2).toEqual(expect.objectContaining({ id: 2, active: false, area: "dados", candidatos: [] }));
  });

  test("candidato: plano, senioridade, status do match e @github", async () => {
    instalarFakeDb({
      candidaturas: [dev(11, 101, "Bruno", "intermediario"), dev(10, 100, "Ana")],
      devSkills: [sk(100, 1, "HTML", 90), sk(101, 1, "HTML", 90)],
      actions: [{ dev_github_id: 100, job_id: 1, action: "aceito" }, { dev_github_id: 101, job_id: 1, action: "recusado" }],
    });
    const { body } = await chamar(controller.getJobsComCandidatos);

    const porNome = Object.fromEntries(body[0].candidatos.map(c => [c.name, c]));
    expect(porNome.Bruno).toEqual(expect.objectContaining({ id: 11, isPro: true, level: "junior", match_status: "recusado", github: "bruno" }));
    expect(porNome.Ana).toEqual(expect.objectContaining({ id: 10, isPro: false, level: "estagio", match_status: "realizado" }));
  });

  test("sem ação da empresa, o match é 'nao_realizado'", async () => {
    instalarFakeDb({ candidaturas: [dev(10, 100, "Ana")], devSkills: [sk(100, 1, "HTML", 90)] });
    const { body } = await chamar(controller.getJobsComCandidatos);
    expect(body[0].candidatos[0].match_status).toBe("nao_realizado");
  });

  test("skills do card: as que a vaga pede vêm primeiro, no máximo 4, com o resto em skills_extra", async () => {
    instalarFakeDb({
      candidaturas: [dev(10, 100, "Ana")],
      devSkills: [
        sk(100, 4, "Docker", 99), sk(100, 5, "SQL", 98),                    // não pedidas, mas com mais confiança
        sk(100, 1, "HTML", 50), sk(100, 2, "CSS", 40), sk(100, 3, "Git", 30), // pedidas pela vaga
        sk(100, 6, "Python", 20),
      ],
    });
    const { body } = await chamar(controller.getJobsComCandidatos);
    const c = body[0].candidatos[0];
    expect(c.skills).toEqual(["HTML", "CSS", "Git", "Docker"]);
    expect(c.skills_extra).toBe(2);
  });

  test("no máximo 12 candidatos por vaga (o total real continua em total_candidaturas)", async () => {
    const muitos = Array.from({ length: 15 }, (_, i) => dev(100 + i, 1000 + i, `Dev${i}`));
    instalarFakeDb({ candidaturas: muitos, devSkills: muitos.map(d => sk(d.dev_github_id, 1, "HTML", 50 + (d.dev_id % 40))) });
    const { body } = await chamar(controller.getJobsComCandidatos);
    expect(body[0].candidatos).toHaveLength(12);
    expect(body[0].total_candidaturas).toBe(3); // valor do banco (mock)
    const scores = body[0].candidatos.map(c => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("empresa sem vagas → lista vazia, sem consultas extras", async () => {
    db.query.mockImplementation(async (sql) => {
      if (/from jobs j/i.test(sql)) return [[]];
      throw new Error("não deveria consultar: " + sql);
    });
    const res = await chamar(controller.getJobsComCandidatos);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("a rota existe e vem antes de /jobs/:id", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", "empresa.js"), "utf8");
    expect(src).toMatch(/router\.get\("\/jobs\/candidatos",\s+isEmpresa,\s+empresaController\.getJobsComCandidatos\)/);
    expect(src.indexOf('"/jobs/candidatos"')).toBeLessThan(src.indexOf('"/jobs/:id"'));
  });
});

describe("página Desenvolvedores — estrutura semântica", () => {
  const render = () => ejs.renderFile(path.join(VIEWS, "empresa-desenvolvedores.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-devs" }, { views: [VIEWS] });

  test("um único h1 'Desenvolvedores', subtítulo e busca com rótulo", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toMatch(/<h1[^>]*>\s*Desenvolvedores\s*<\/h1>/);
    expect(html).toMatch(/Pesquise desenvolvedores, sejam eles candidatados ou não para suas vagas/);
    expect(html).toMatch(/<search\b/);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*aria-label="[^"]+"/);
    expect(html).toMatch(/placeholder="Pesquisar por desenvolvedores"/);
  });

  test("abas acessíveis: Dev em Vagas e Desenvolvedores Geral, cada uma com seu painel", async () => {
    const html = await render();
    expect(html).toMatch(/role="tablist"/);
    const abas = [...html.matchAll(/<button[^>]*role="tab"[^>]*>\s*([^<]+?)\s*<\/button>/g)].map(m => m[1]);
    expect(abas).toEqual(["Dev em Vagas", "Desenvolvedores Geral"]);
    expect((html.match(/role="tabpanel"/g) || []).length).toBe(2);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tab"[^>]*aria-controls="painel-vagas"/);
    expect(html).toMatch(/role="tab"[^>]*aria-controls="painel-geral"/);
  });

  test("filtro é um botão que abre/fecha o painel (aria-expanded)", async () => {
    const html = await render();
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="filtro-painel"/);
    expect(html).toMatch(/id="filtro-painel"[^>]*hidden/);
  });

  test("lê as duas fontes de dados e escapa o que vem do banco", async () => {
    const html = await render();
    expect(html).toContain("/api/empresa/jobs/candidatos");
    expect(html).toContain("/api/empresa/desenvolvedores");
    expect(html).toContain("escape-html.js");
    const fonte = fs.readFileSync(path.join(VIEWS, "empresa-desenvolvedores.ejs"), "utf8");
    expect(fonte).not.toMatch(/onclick=/); // o onclick do tema vem do cabeçalho compartilhado, não da página
    expect(html).toContain("escapeHtml(job.title)");
    expect(html).toContain("escapeHtml(c.name)");
  });

  test("cartão de candidato: ações 'Gerenciar candidatura' e 'Ver perfil'", async () => {
    const html = await render();
    expect(html).toContain("Gerenciar candidatura");
    expect(html).toContain("Ver perfil");
    expect(html).toMatch(/\/empresa\/vagas\/\$\{job\.id\}\/candidaturas/);
  });
});

describe("menu da empresa", () => {
  const header = () => ejs.renderFile(path.join(VIEWS, "partials", "header-company.ejs"),
    { user: { type: "empresa", name: "Tech" }, currentPage: "empresa-devs" }, { views: [VIEWS] });

  test("'Candidatos' virou 'Desenvolvedores' no menu do topo e na barra inferior", async () => {
    const html = await header();
    expect(html).not.toMatch(/>\s*Candidatos\s*</);
    const nav = html.match(/aria-label="Navegação da empresa"[\s\S]*?<\/nav>/)[0];
    expect(nav).toMatch(/>\s*Desenvolvedores\s*</);
    const bottom = html.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)[0];
    // nome completo para leitores de tela; "Devs" só no visual, no celular (não cabe em 1/5 da barra)
    expect(bottom).toMatch(/<span class="bn-full">Desenvolvedores<\/span>/);
    expect(bottom).toMatch(/<span class="bn-short" aria-hidden="true">Devs<\/span>/);
  });
});
