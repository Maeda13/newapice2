// tests/empresaPerfilPagina.test.js
// Perfil da empresa (/empresa/perfil, somente leitura) — separado das
// Configurações (/empresa/configuracoes, edição). Cobre: rotas, itens do menu,
// dados das vagas em GET /api/empresa/profile e a estrutura semântica da página.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn().mockResolvedValue({ code: "empresa_free", name: "Free", price_cents: 0, max_active_jobs: 1, benefits: [] }),
  getPlanCodesBulk: jest.fn().mockResolvedValue({}),
}));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const db = require("../database/db");
const controller = require("../controllers/empresaController");

const VIEWS = path.join(__dirname, "..", "views");
const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => jest.clearAllMocks());

describe("rotas e menu", () => {
  test("/empresa/perfil mostra o Perfil e /empresa/configuracoes mostra as Configurações", () => {
    const server = ler("server.js");
    expect(server).toMatch(/app\.get\("\/empresa\/perfil",\s*requireCompany[\s\S]*?res\.render\("empresa-perfil"/);
    expect(server).toMatch(/app\.get\("\/empresa\/configuracoes",\s*requireCompany[\s\S]*?res\.render\("empresa-configuracoes"/);
  });

  const header = (currentPage) => ejs.renderFile(path.join(VIEWS, "partials", "header-company.ejs"),
    { user: { type: "empresa", name: "Tech" }, currentPage }, { views: [VIEWS] });

  test("menu do usuário e drawer: 'Perfil da empresa' e 'Configurações' são links distintos", async () => {
    const html = await header("empresa-dashboard");
    expect(html).toMatch(/<a role="menuitem" href="\/empresa\/perfil">Perfil da empresa<\/a>/);
    expect(html).toMatch(/<a role="menuitem" href="\/empresa\/configuracoes">Configurações<\/a>/);
    expect(html).toMatch(/class="drawer-foot-link">Configurações<\/a>/);
  });

  test("a aba 'Config.' do celular leva às Configurações e só fica ativa nelas", async () => {
    const config = await header("empresa-config");
    const bottom = config.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)[0];
    expect(bottom).toMatch(/<a href="\/empresa\/configuracoes"\s+class="bottom-nav-item is-active"/);

    const perfil = await header("empresa-perfil");
    expect(perfil.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)[0]).not.toMatch(/is-active/);
  });
});

describe("GET /api/empresa/profile — vagas do perfil", () => {
  function instalarFakeDb() {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
      if (s.startsWith("select id, email, created_at from users")) return [[{ id: 5, email: "a@b.c", created_at: "2026-02-13T12:00:00Z" }]];
      if (s.startsWith("select * from user_company_profiles")) return [[{ razao_social: "Tech LTDA", nome_fantasia: "Tech" }]];
      if (s.includes("count(*) as total")) return [[{ total: 3, ativas: 2 }]];
      if (s.includes("from jobs j") && s.includes("total_candidaturas")) {
        return [[
          { id: 1, title: "Estágio Front", level: "estagio", active: 1, area: null, created_at: "2026-03-20T12:00:00Z", total_candidaturas: "200" },
          { id: 2, title: "Vaga de Dados", level: "junior", active: 0, area: "dados", created_at: "2026-02-01T12:00:00Z", total_candidaturas: "0" },
          { id: 3, title: "Sem skills", level: "pleno", active: 1, area: null, created_at: "2026-01-01T12:00:00Z", total_candidaturas: "5" },
        ]];
      }
      if (s.includes("from job_skills js join skills s")) {
        return [[{ job_id: 1, habilidade: "HTML" }, { job_id: 1, habilidade: "Responsividade" }, { job_id: 1, habilidade: "Acessibilidade Web" }]];
      }
      throw new Error("fakeDb: rota não mapeada: " + sql);
    });
  }
  const chamar = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return controller.getProfile({ session: { user: { id: 5 } } }, res).then(() => res);
  };

  test("cada vaga traz área (a escolhida vence a inferida), candidatos inscritos e status", async () => {
    instalarFakeDb();
    const { body } = await chamar();
    const [v1, v2, v3] = body.vagas;
    expect(v1).toEqual(expect.objectContaining({ id: 1, title: "Estágio Front", active: true, area: "front-end", total_candidaturas: 200 }));
    expect(v2).toEqual(expect.objectContaining({ id: 2, active: false, area: "dados", total_candidaturas: 0 }));
    expect(v3.area).toBeNull(); // sem área escolhida e sem skills para inferir
  });

  test("os números do resumo e os campos que já existiam continuam iguais", async () => {
    instalarFakeDb();
    const { body } = await chamar();
    expect(body).toEqual(expect.objectContaining({ totalVagas: 3, vagasAtivas: 2, razao_social: "Tech LTDA", email: "a@b.c" }));
  });
});

describe("página /empresa/perfil — estrutura semântica", () => {
  const render = () => ejs.renderFile(path.join(VIEWS, "empresa-perfil.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-perfil" }, { views: [VIEWS] });
  const fonte = ler("views/empresa-perfil.ejs");

  test("um único h1 (nome da empresa) e as 3 seções do layout, cada uma com seu h2", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    const titulos = [...html.matchAll(/<h2 class="pe-title"[^>]*>\s*(?:<svg[\s\S]*?<\/svg>\s*)?([^<]+?)\s*<\/h2>/g)].map(m => m[1]);
    expect(titulos).toEqual(["Informações", "Sobre empresa", "Vagas"]);
  });

  test("informações em lista de definição, com os 4 campos do layout", async () => {
    const html = await render();
    expect(html).toMatch(/<dl class="pe-dados"/);
    for (const rotulo of ["Endereço", "Setor de atuação", "Modelo de trabalho dominante", "Faixa de maturidade"]) {
      expect(html).toContain(rotulo);
    }
  });

  test("vagas em <ul>/<li>/<article>; cartão com área, publicada em, candidatos inscritos e 'Acessar vaga'", () => {
    expect(fonte).toContain('<ul class="pe-vagas"');
    expect(fonte).toMatch(/<article class="pe-vaga">/);
    for (const texto of ["Área", "Publicada em", "Candidatos inscritos", "Acessar vaga"]) expect(fonte).toContain(texto);
    expect(fonte).toMatch(/href="\/vagas\/\$\{v\.id\}"/);
    expect(fonte).toMatch(/Ativa/);
    expect(fonte).toMatch(/Inativa/);
  });

  test("tudo que vem do banco é escapado; sem onclick; sem <fieldset> nem formulário (é só leitura)", async () => {
    const html = await render();
    expect(fonte).toContain("/js/escape-html.js");
    expect(fonte).toContain("escapeHtml(v.title)");
    expect(fonte).toContain("escapeHtml(data.setor)");
    expect(fonte).not.toMatch(/onclick=/);
    expect(html).not.toMatch(/<form[^>]*id="form-/);
    expect(html).not.toMatch(/<fieldset/);
  });

  test("a descrição é texto (textContent), nunca HTML", () => {
    expect(fonte).toMatch(/const el = \$\("sobre-texto"\);\s*el\.textContent = data\.descricao/);
    expect(fonte).not.toMatch(/el\.innerHTML/);
  });

  test("estados vazios: sem vagas, sem descrição e campos não preenchidos", () => {
    expect(fonte).toContain("Nenhuma vaga publicada ainda");
    expect(fonte).toContain("Nenhuma descrição ainda");
    expect(fonte).toContain("Não informado");
  });
});
