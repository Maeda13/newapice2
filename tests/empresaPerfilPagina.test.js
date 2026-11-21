// tests/empresaPerfilPagina.test.js
// Perfil e Configurações da empresa são uma página só (/empresa/configuracoes): o antigo
// Perfil (/empresa/perfil) redireciona para lá e a seção "Vagas" passou para as Configurações.
// Cobre: rotas, itens do menu, dados das vagas em GET /api/empresa/profile e a seção Vagas.
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
  test("/empresa/perfil e /perfil (empresa) levam às Configurações; não existe mais a página de perfil", () => {
    const server = ler("server.js");
    expect(server).toMatch(/app\.get\("\/empresa\/perfil",\s*requireCompany,\s*\(req, res\) => res\.redirect\(301, "\/empresa\/configuracoes"\)\);/);
    expect(server).toMatch(/app\.get\("\/empresa\/configuracoes",\s*requireCompany[\s\S]*?res\.render\("empresa-configuracoes"/);
    expect(server).toContain('if (req.session.user.type === "empresa") return res.redirect("/empresa/configuracoes");');
    expect(server).not.toContain('res.render("empresa-perfil"');
    expect(fs.existsSync(path.join(VIEWS, "empresa-perfil.ejs"))).toBe(false);
  });

  const header = (currentPage) => ejs.renderFile(path.join(VIEWS, "partials", "header-company.ejs"),
    { user: { type: "empresa", name: "Tech" }, currentPage }, { views: [VIEWS] });

  test("menu do usuário e drawer: só 'Configurações' (sem 'Perfil da empresa')", async () => {
    const html = await header("empresa-dashboard");
    expect(html).not.toContain("Perfil da empresa");
    expect(html).not.toContain("/empresa/perfil");
    expect(html).toMatch(/<a role="menuitem" href="\/empresa\/configuracoes">Configurações<\/a>/);
    expect(html).toMatch(/class="drawer-foot-link">Configurações<\/a>/);
  });

  test("a aba 'Matchs' do celular leva aos Matchs e só fica ativa neles; Configurações saiu da barra", async () => {
    const matchs = await header("empresa-matchs");
    const bottom = matchs.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)[0];
    expect(bottom).toMatch(/<a href="\/empresa\/matchs"\s+class="bottom-nav-item is-active"/);
    expect(bottom).not.toContain("/empresa/configuracoes");

    const config = await header("empresa-config");
    expect(config.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)[0]).not.toMatch(/is-active/);
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

describe("página /empresa/configuracoes — seção Vagas (vinda do antigo Perfil)", () => {
  const render = () => ejs.renderFile(path.join(VIEWS, "empresa-configuracoes.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-config" }, { views: [VIEWS] });
  const fonte = ler("views/empresa-configuracoes.ejs");

  test("a seção Vagas tem h2 próprio, fica entre 'Sobre empresa' e 'Meu plano' e a página segue com um só h1", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toMatch(/<h2 class="pe-title pe-title--plain"|<h2 class="pe-title" id="title-vagas">/);
    expect(html.indexOf('id="title-sobre"')).toBeLessThan(html.indexOf('id="title-vagas"'));
    expect(html.indexOf('id="title-vagas"')).toBeLessThan(html.indexOf('id="title-plano"'));
    expect(html).toContain('<ul class="pe-vagas" id="vagas-list">');
  });

  test("vagas em <ul>/<li>/<article>; cartão com área, publicada em, candidatos inscritos e 'Acessar vaga'", () => {
    expect(fonte).toContain('<ul class="pe-vagas"');
    expect(fonte).toMatch(/<article class="pe-vaga">/);
    for (const texto of ["Área", "Publicada em", "Candidatos inscritos", "Acessar vaga"]) expect(fonte).toContain(texto);
    expect(fonte).toMatch(/href="\/vagas\/\$\{v\.id\}"/);
    expect(fonte).toMatch(/Ativa/);
    expect(fonte).toMatch(/Inativa/);
  });

  test("o texto das vagas vem escapado e sem onclick; a lista é carregada junto com o perfil", () => {
    expect(fonte).toContain("/js/escape-html.js");
    expect(fonte).toContain("escapeHtml(v.title)");
    expect(fonte).not.toMatch(/onclick=/);
    expect(fonte).toContain("renderVagas(data.vagas);");
  });

  test("estado vazio: sem vagas publicadas", () => {
    expect(fonte).toContain("Nenhuma vaga publicada ainda");
  });
});
