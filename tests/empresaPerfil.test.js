// tests/empresaPerfil.test.js
// Configurações da empresa (/empresa/configuracoes): campos novos (e-mail de exibição,
// endereço, modelo de trabalho, faixa de maturidade), validação no servidor,
// plano de upgrade vindo de config/plans.js e a estrutura semântica da página.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn(),
  getPlanCodesBulk: jest.fn().mockResolvedValue({}),
}));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const db = require("../database/db");
const { getUserPlan } = require("../services/subscriptionService");
const { PLANS } = require("../config/plans");
const controller = require("../controllers/empresaController");

const VIEWS = path.join(__dirname, "..", "views");
const EMPRESA = 5;

function chamar(handler, { body = {}, params = {} } = {}) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  const req = { session: { user: { id: EMPRESA, type: "empresa", name: "Tech" } }, body, params };
  return handler(req, res).then(() => ({ res, req }));
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/empresa/profile", () => {
  function instalarFakeDb(perfil = {}) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
      if (s.startsWith("select id, email, created_at from users")) return [[{ id: EMPRESA, email: "a@b.c", created_at: "2026-02-13T12:00:00Z" }]];
      if (s.startsWith("select * from user_company_profiles")) return [[{ razao_social: "Tech LTDA", nome_fantasia: "Tech", cnpj: "12345678000190", ...perfil }]];
      if (s.includes("count(*) as total")) return [[{ total: 4, ativas: 3 }]];
      if (s.includes("from jobs j") && s.includes("total_candidaturas")) return [[]]; // vagas do perfil
      throw new Error("fakeDb: rota não mapeada: " + sql);
    });
  }

  test("devolve os campos novos (vazios quando ainda não preenchidos)", async () => {
    getUserPlan.mockResolvedValue(PLANS.empresa_free);
    instalarFakeDb();
    const { res } = await chamar(controller.getProfile);
    expect(res.body).toEqual(expect.objectContaining({ email_exibicao: "", endereco: "", modelo_trabalho: "", maturidade: "" }));
  });

  test("devolve os campos novos já salvos", async () => {
    getUserPlan.mockResolvedValue(PLANS.empresa_free);
    instalarFakeDb({ email_exibicao: "rh@tech.com", endereco: "Rua A, 10", modelo_trabalho: "hibrido", maturidade: "consolidada" });
    const { res } = await chamar(controller.getProfile);
    expect(res.body).toEqual(expect.objectContaining({
      email_exibicao: "rh@tech.com", endereco: "Rua A, 10", modelo_trabalho: "hibrido", maturidade: "consolidada",
    }));
  });

  test("plano gratuito: traz o plano pago de upgrade (nome, preço e benefícios) da configuração", async () => {
    getUserPlan.mockResolvedValue(PLANS.empresa_free);
    instalarFakeDb();
    const { res } = await chamar(controller.getProfile);
    const pago = Object.values(PLANS).find(p => p.type === "empresa" && p.price_cents > 0);
    expect(res.body.plan.upgrade).toEqual(expect.objectContaining({
      code: pago.code, name: pago.name, price_cents: pago.price_cents, benefits: pago.benefits,
    }));
  });

  test("plano pago: não oferece upgrade", async () => {
    getUserPlan.mockResolvedValue(PLANS.empresa_premium);
    instalarFakeDb();
    const { res } = await chamar(controller.getProfile);
    expect(res.body.plan.upgrade).toBeNull();
  });
});

describe("PATCH /api/empresa/profile", () => {
  beforeEach(() => db.query.mockResolvedValue([{ affectedRows: 1 }]));
  const update = () => db.query.mock.calls.find(([s]) => /update user_company_profiles set/i.test(s));

  test("grava os campos novos", async () => {
    const { res } = await chamar(controller.updateProfile, { body: {
      email_exibicao: " rh@tech.com ", endereco: " Rua A, 10 ", modelo_trabalho: "remoto", maturidade: "startup",
    } });
    expect(res.statusCode).toBe(200);
    const [sql, params] = update();
    for (const c of ["email_exibicao = ?", "endereco = ?", "modelo_trabalho = ?", "maturidade = ?"]) expect(sql).toContain(c);
    expect(params).toEqual(expect.arrayContaining(["rh@tech.com", "Rua A, 10", "remoto", "startup"]));
  });

  test("campo vazio limpa (grava null) e só atualiza o que foi enviado", async () => {
    await chamar(controller.updateProfile, { body: { endereco: "" } });
    const [sql, params] = update();
    expect(sql).toMatch(/endereco = \?/);
    expect(sql).not.toMatch(/maturidade/);
    expect(params[0]).toBeNull();
  });

  test.each([
    [{ modelo_trabalho: "na-lua" }, /modelo de trabalho/i],
    [{ maturidade: "gigante" }, /maturidade/i],
    [{ email_exibicao: "nao-e-email" }, /e-mail/i],
    [{ endereco: "x".repeat(256) }, /endereço/i],
  ])("rejeita %j com 400 e não grava", async (body, mensagem) => {
    const { res } = await chamar(controller.updateProfile, { body });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(mensagem);
    expect(update()).toBeUndefined();
  });

  test("salvar só a descrição ('Sobre empresa') não mexe nos outros campos", async () => {
    await chamar(controller.updateProfile, { body: { descricao: "Somos uma empresa" } });
    const [sql] = update();
    expect(sql).toMatch(/descricao = \?/);
    expect(sql).not.toMatch(/nome_fantasia|setor|endereco/);
  });
});

describe("GET /api/empresas/:id (perfil público)", () => {
  test("inclui os campos novos (aditivo; o formato antigo continua igual)", async () => {
    db.query.mockImplementation(async (sql) => {
      if (/from user_company_profiles/i.test(sql)) {
        expect(sql).toMatch(/email_exibicao/);
        return [[{ nome_fantasia: "Tech", razao_social: "Tech LTDA", setor: "Tecnologia", tamanho: null, site: null, descricao: "x", cidade: null, estado: null,
          email_exibicao: "rh@tech.com", endereco: "Rua A", modelo_trabalho: "hibrido", maturidade: "startup" }]];
      }
      if (/from jobs/i.test(sql)) return [[]];
      throw new Error("rota não mapeada: " + sql);
    });
    const { res } = await chamar(controller.getPublicProfile, { params: { id: "9" } });
    expect(res.body).toEqual(expect.objectContaining({
      name: "Tech", setor: "Tecnologia", email_exibicao: "rh@tech.com", endereco: "Rua A", modelo_trabalho: "hibrido", maturidade: "startup",
    }));
  });
});

describe("banco: colunas novas (migração aditiva)", () => {
  test("db.js cria as 4 colunas com addColumn", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "database", "db.js"), "utf8");
    for (const col of ["email_exibicao", "endereco", "modelo_trabalho", "maturidade"]) {
      expect(src).toMatch(new RegExp(`addColumn\\("user_company_profiles", "${col}"`));
    }
  });
});

describe("página /empresa/configuracoes — estrutura semântica", () => {
  const render = () => ejs.renderFile(path.join(VIEWS, "empresa-configuracoes.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-config" }, { views: [VIEWS] });
  const fonte = fs.readFileSync(path.join(VIEWS, "empresa-configuracoes.ejs"), "utf8").replace(/\r\n/g, "\n");

  test("um único h1; seções na ordem do layout, cada uma com seu h2", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    const titulos = [...html.matchAll(/<h2 class="pe-title[^"]*"[^>]*>\s*(?:<svg[\s\S]*?<\/svg>\s*)?([^<]+?)\s*(?:<span|<\/h2>)/g)].map(m => m[1]);
    expect(titulos).toEqual(["Informações pessoais", "Sobre empresa", "Meu plano", "Informações da conta"]);
  });

  test("campos do formulário principal, todos com <label for>", async () => {
    const html = await render();
    for (const id of ["f-razao", "f-fantasia", "f-email", "f-endereco", "f-setor", "f-modelo", "f-maturidade"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    }
    expect(html).toMatch(/<label[^>]*for="f-descricao"/);
  });

  test("dois formulários independentes, cada um com seu botão de salvar", async () => {
    const html = await render();
    expect(html).toContain('id="form-info"');
    expect(html).toContain('id="form-sobre"');
    expect((html.match(/Salvar alterações/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("campos fora do layout (site, porte, cidade, UF) ficam recolhidos em 'Mais detalhes'", async () => {
    const html = await render();
    const detalhes = html.match(/<details class="pe-more"[\s\S]*?<\/details>/)[0];
    for (const id of ["f-site", "f-tamanho", "f-cidade", "f-estado"]) expect(detalhes).toContain(`id="${id}"`);
    expect(detalhes).not.toMatch(/<details[^>]*\sopen/);
  });

  test("HTML semântico: sem <fieldset> embrulhando campo único, logout em <form> POST, dot de alterações com role", async () => {
    const html = await render();
    expect(html).not.toMatch(/<fieldset class="field"/);
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/auth\/logout"/);
    expect(html).toMatch(/<span class="unsaved-dot"[^>]*role="status"[^>]*aria-label="[^"]+"/);
    expect(html).not.toMatch(/<a\s+[^>]*href="\/auth\/logout"/);
  });

  test("script: escapa o que vem do banco, sem onclick inline, link de gerenciar assinatura e upgrade", () => {
    expect(fonte).toContain("/js/escape-html.js");
    expect(fonte).toContain("escapeHtml(data.setor)");
    expect(fonte).toContain("escapeHtml(data.email)");
    expect(fonte).not.toMatch(/onclick=/);
    expect(fonte).toContain('href="/minha-assinatura"');
    expect(fonte).toContain('href="/planos"');
  });

  test("texto da sessão não promete encerrar 'em todos os dispositivos' (o logout só encerra esta sessão)", async () => {
    const html = await render();
    expect(html).toMatch(/Encerrar sessão/);
    expect(html).not.toMatch(/todos os dispositivos/);
  });
});
