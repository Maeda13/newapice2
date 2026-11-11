// tests/empresaMatchsPagina.test.js
// Página de Matchs da empresa (/empresa/matchs): estatísticas (totais, de
// candidaturas e orgânicos), "Matches" em destaque e "Matches vagas" (por vaga).
//   - GET /api/empresa/matchs/painel
//   - estrutura semântica da página
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn(),
  getPlanCodesBulk: jest.fn(async (ids) => Object.fromEntries(ids.map(id => [id, id === 11 ? "dev_pro" : "dev_free"]))),
}));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const db = require("../database/db");
const controller = require("../controllers/empresaController");

const VIEWS = path.join(__dirname, "..", "views");
const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

// Vagas ativas: 1 (Front: skills 1,2 · Ana se candidatou) e 2 (skill 3).
// Devs: Ana (10), Bruno (11, PRO), Caio (12).
function instalarFakeDb({ semVagas = false, falha = false, devs, devSkills, acoes } = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.startsWith("select id, title, level from jobs where company_id")) {
      if (falha) throw new Error("boom");
      return [semVagas ? [] : [{ id: 1, title: "Estágio Front", level: "estagio" }, { id: 2, title: "Vaga Dados", level: "junior" }]];
    }
    if (s.startsWith("select job_id, skill_id, importance from job_skills")) {
      return [[
        { job_id: 1, skill_id: 1, importance: "obrigatoria" }, { job_id: 1, skill_id: 2, importance: "obrigatoria" },
        { job_id: 2, skill_id: 3, importance: "obrigatoria" },
      ]];
    }
    if (s.includes("from user_dev_profiles where github_id is not null")) {
      return [devs ?? [
        { id: 10, github_id: 100, nome: "Ana",   github_login: "ana",   nivel: "iniciante" },
        { id: 11, github_id: 101, nome: "Bruno", github_login: "bruno", nivel: "iniciante" },
        { id: 12, github_id: 102, nome: "Caio",  github_login: "caio",  nivel: "iniciante" },
      ]];
    }
    if (s.startsWith("select github_id, skill_id, confidence from user_skills")) {
      return [devSkills ?? [
        { github_id: 100, skill_id: 1, confidence: 90 }, { github_id: 100, skill_id: 2, confidence: 90 },  // Ana → vaga 1 (alto)
        { github_id: 101, skill_id: 1, confidence: 90 }, { github_id: 101, skill_id: 3, confidence: 80 },  // Bruno → vagas 1 (médio) e 2
        { github_id: 102, skill_id: 3, confidence: 50 },                                                    // Caio → vaga 2
      ]];
    }
    if (s.startsWith("select dev_github_id, job_id, action from company_match_actions")) {
      return [acoes ?? [{ dev_github_id: 101, job_id: 1, action: "aceito" }]];
    }
    // dados das vagas (cabeçalho de cada grupo)
    if (s.includes("from jobs j") && s.includes("total_candidaturas")) {
      if (semVagas) return [[]];
      return [[
        { id: 1, title: "Estágio Front", active: 1, area: null, created_at: "2026-03-20T12:00:00Z", total_candidaturas: "200" },
        { id: 2, title: "Vaga Dados", active: 1, area: "dados", created_at: "2026-02-01T12:00:00Z", total_candidaturas: "0" },
      ]];
    }
    if (s.includes("from job_skills js join skills s")) {
      return [[{ job_id: 1, habilidade: "HTML" }, { job_id: 1, habilidade: "Responsividade" }, { job_id: 1, habilidade: "Acessibilidade Web" }]];
    }
    // quem se candidatou
    if (s.startsWith("select job_id, dev_github_id from job_applications")) {
      return [[{ job_id: 1, dev_github_id: 100 }]];
    }
    throw new Error("fakeDb: rota não mapeada: " + sql);
  });
}

function chamar() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return controller.getPainelMatchs({ session: { user: { id: 5, type: "empresa" } } }, res).then(() => res);
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/empresa/matchs/painel", () => {
  test("estatísticas: total de matches, os de candidatura (o dev se candidatou) e os orgânicos", async () => {
    instalarFakeDb();
    const { body } = await chamar();
    // pares: Ana×1, Bruno×1, Bruno×2, Caio×2
    expect(body.stats).toEqual({ total: 4, candidaturas: 1, organicos: 3 });
  });

  test("'Matches' em destaque: melhores compatibilidades primeiro, com plano, candidatura e status", async () => {
    instalarFakeDb();
    const { body } = await chamar();

    expect(body.destaque.length).toBeLessThanOrEqual(6);
    const scores = body.destaque.map(m => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const ana = body.destaque.find(m => m.dev === "Ana");
    expect(ana).toEqual(expect.objectContaining({
      dev_id: 10, github: "ana", level: "estagio", isPro: false, candidatou: true,
      job_id: 1, job: "Estágio Front", status: "novo",
    }));
    const bruno = body.destaque.find(m => m.dev === "Bruno" && m.job_id === 1);
    expect(bruno).toEqual(expect.objectContaining({ isPro: true, candidatou: false, status: "aceito" }));
  });

  test("'Matches vagas': um grupo por vaga ativa, com dados da vaga e os devs compatíveis", async () => {
    instalarFakeDb();
    const { body } = await chamar();

    const [v1, v2] = body.vagas;
    expect(v1).toEqual(expect.objectContaining({
      id: 1, title: "Estágio Front", active: true, area: "front-end", total_candidaturas: 200, total_matches: 2,
    }));
    expect(v1.matches.map(m => m.dev)).toEqual(["Ana", "Bruno"]); // maior compatibilidade primeiro
    expect(v2).toEqual(expect.objectContaining({ id: 2, area: "dados", total_candidaturas: 0, total_matches: 2 }));
    expect(v2.matches.map(m => m.dev).sort()).toEqual(["Bruno", "Caio"]);
  });

  test("match recusado pela empresa não aparece (nem entra nas estatísticas)", async () => {
    instalarFakeDb({ acoes: [{ dev_github_id: 100, job_id: 1, action: "recusado" }] });
    const { body } = await chamar();
    expect(body.stats.total).toBe(3);
    expect(body.destaque.some(m => m.dev === "Ana")).toBe(false);
    expect(body.vagas[0].matches.map(m => m.dev)).toEqual(["Bruno"]);
  });

  test("no máximo 12 devs por vaga (total_matches continua com o número real)", async () => {
    const devs = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, github_id: 1000 + i, nome: `Dev${i}`, github_login: `dev${i}`, nivel: "iniciante" }));
    const devSkills = devs.map((d, i) => ({ github_id: d.github_id, skill_id: 1, confidence: 30 + i }));
    instalarFakeDb({ devs, devSkills });
    const { body } = await chamar();
    expect(body.vagas[0].matches).toHaveLength(12);
    expect(body.vagas[0].total_matches).toBe(15);
  });

  test("empresa sem vagas ativas: tudo zerado, sem erro", async () => {
    instalarFakeDb({ semVagas: true });
    const res = await chamar();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ stats: { total: 0, candidaturas: 0, organicos: 0 }, destaque: [], vagas: [] });
  });

  test("falha no banco → 500 com mensagem, sem vazar detalhes", async () => {
    instalarFakeDb({ falha: true });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await chamar();
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/erro interno/i);
  });

  test("a rota existe, protegida, e vem antes de qualquer rota com parâmetro", () => {
    const src = ler("routes/empresa.js");
    expect(src).toMatch(/router\.get\("\/matchs\/painel",\s+isEmpresa,\s+empresaController\.getPainelMatchs\)/);
  });
});

describe("página /empresa/matchs — estrutura semântica", () => {
  const render = () => ejs.renderFile(path.join(VIEWS, "empresa-matchs.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-matchs" }, { views: [VIEWS] });
  const fonte = ler("views/empresa-matchs.ejs");

  test("um único h1 ('Matchs') e o texto de apoio", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toMatch(/<h1[^>]*>\s*Matchs\s*<\/h1>/);
    expect(html).toContain("Encontre os desenvolvedores que mais combinam com suas vagas.");
  });

  test("3 estatísticas em lista, com rótulos do layout", async () => {
    const html = await render();
    const lista = html.match(/<ul class="mt-stats"[\s\S]*?<\/ul>/)[0];
    expect((lista.match(/<li\b/g) || []).length).toBe(3);
    for (const rotulo of ["Matches totais", "Matches de candidaturas", "Matches orgânicos"]) expect(lista).toContain(rotulo);
  });

  test("seções 'Matches' e 'Matches vagas', cada uma com h2 e ligada por aria-labelledby", async () => {
    const html = await render();
    const titulos = [...html.matchAll(/<h2 class="mt-title"[^>]*>\s*(?:<svg[\s\S]*?<\/svg>\s*)?([^<]+?)\s*<\/h2>/g)].map(m => m[1]);
    expect(titulos).toEqual(["Matches", "Matches vagas"]);
    expect(html).toMatch(/<section[^>]*aria-labelledby="title-destaque"/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="title-vagas"/);
  });

  test("estados vazios são irmãos das listas (nunca <li role=status> dentro de role=list)", async () => {
    const html = await render();
    expect(html).toMatch(/<ul[^>]*id="destaque-list"[^>]*>\s*<\/ul>\s*<p[^>]*id="destaque-vazio"[^>]*role="status"/);
    expect(html).toMatch(/<ul[^>]*id="vagas-list"[^>]*>\s*<\/ul>\s*<p[^>]*id="vagas-vazio"[^>]*role="status"/);
    expect(fonte).not.toMatch(/<li[^>]*role="status"/);
  });

  test("cartão: nome (h3), plano, @github, selo Candidato/Orgânico, vaga, compatibilidade e 'Ver perfil'", () => {
    const card = fonte.match(/function renderCard[\s\S]*?\n    }\n/)[0];
    expect(card).toContain("<h3");
    expect(card).toContain("escapeHtml(m.dev)");
    expect(card).toContain("escapeHtml(m.job)");
    expect(card).toMatch(/Candidato/);
    expect(card).toMatch(/Orgânico/);
    expect(card).toMatch(/role="progressbar"/);
    expect(card).toMatch(/aria-valuenow="\$\{m\.score\}"/);
    expect(card).toContain("Ver perfil");
    expect(card).toMatch(/href="\/empresa\/dev\/\$\{m\.dev_id\}"/);
  });

  test("aceitar/recusar continuam existindo, sem onclick inline (delegação por data-acao)", () => {
    expect(fonte).not.toMatch(/onclick=/);
    expect(fonte).toMatch(/data-acao="aceitar"/);
    expect(fonte).toMatch(/data-acao="recusar"/);
    expect(fonte).toMatch(/\/api\/empresa\/matchs\/\$\{/);
    expect(fonte).toContain('action: acao === "aceitar" ? "aceito" : "recusado"');
  });

  test("tudo que vem do banco é escapado", () => {
    expect(fonte).toContain("/js/escape-html.js");
    expect(fonte).toContain("escapeHtml(v.title)");
  });
});
