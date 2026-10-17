// Páginas e rotas da assinatura, montadas como em server.js (sem banco real
// nem sessão real), com e sem credenciais do Mercado Pago.
const path    = require("path");
const express = require("express");
const request = require("supertest");
const { createFakeDb } = require("./helpers/fakeDb");

const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

function buildApp({ configured, user, setup }) {
  let app, db, mp;
  jest.isolateModules(() => {
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.MP_WEBHOOK_SECRET;
    if (configured) {
      process.env.MP_ACCESS_TOKEN = "TEST-token-123";
      process.env.MP_PUBLIC_KEY   = "TEST-public-key-abc";
    } else {
      delete process.env.MP_ACCESS_TOKEN;
      delete process.env.MP_PUBLIC_KEY;
    }

    db = createFakeDb();
    db.state.users.push({ id: 1, type: "dev", email: "dev@teste.com" }, { id: 2, type: "empresa", email: "empresa@teste.com" });
    db.state.mpPlans.push(
      { plan_code: "dev_pro", mp_account_id: 999, mp_plan_id: "plan-dev", transaction_amount: 19.9 },
      { plan_code: "empresa_basico", mp_account_id: 999, mp_plan_id: "plan-basico", transaction_amount: 49.9 },
      { plan_code: "empresa_premium", mp_account_id: 999, mp_plan_id: "plan-premium", transaction_amount: 99.9 },
    );
    jest.doMock("../../database/db", () => db);
    jest.doMock("../../services/mercadoPago", () => ({
      ...jest.requireActual("../../services/mercadoPago"),
      getAccount: jest.fn().mockResolvedValue({ id: 999, siteId: "MLB" }),
      getPreapproval: jest.fn(),
      searchAuthorizedPayments: jest.fn().mockResolvedValue({ results: [] }),
    }));
    mp = require("../../services/mercadoPago");
    if (setup) setup({ db, mp });

    const { exposeUser, requireAuth } = require("../../middlewares/auth");
    const controller = require("../../controllers/assinaturasController");
    const { mpCheckoutCsp } = require("../../middlewares/mpCheckoutCsp");

    app = express();
    app.set("views", VIEWS_DIR);
    app.set("view engine", "ejs");
    app.use(express.json());
    app.use((req, _res, next) => { req.session = user ? { user } : {}; next(); });
    app.use(exposeUser);
    app.get("/planos/:id/assinar", mpCheckoutCsp, controller.assinarPage);
    app.get("/assinatura/retorno", controller.retornoPage);
    app.get("/minha-assinatura", requireAuth, mpCheckoutCsp, controller.minhaAssinaturaPage);
    app.use("/api/plans", require("../../routes/plans"));
    app.use("/api/assinaturas", require("../../routes/assinaturas"));
    app.use((err, _req, res, _next) => { res.status(500).send(`ERRO: ${err.message}`); });
  });
  return { app, db, mp };
}

const DEV = { id: 1, type: "dev", email: "dev@teste.com", name: "Dev Teste" };
const EMPRESA = { id: 2, type: "empresa", email: "empresa@teste.com", name: "Empresa X" };

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("sem credenciais do Mercado Pago (degradação)", () => {
  test("o módulo de configuração avisa no console em vez de quebrar", () => {
    buildApp({ configured: false, user: DEV });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Assinaturas desativadas"));
  });

  test("/planos/:id/assinar mostra 'Assinaturas temporariamente indisponíveis' e não carrega o SDK", async () => {
    const { app } = buildApp({ configured: false, user: DEV });
    const res = await request(app).get("/planos/dev_pro/assinar");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Assinaturas temporariamente indisponíveis");
    expect(res.text).toContain("R$ 19,90"); // resumo do plano continua aparecendo
    expect(res.text).not.toContain("sdk.mercadopago.com/js/v2");
    expect(res.text).not.toContain("cardPaymentBrick_container");
  });

  test("POST /api/assinaturas → 503 com mensagem amigável", async () => {
    const { app } = buildApp({ configured: false, user: DEV });
    const res = await request(app).post("/api/assinaturas").send({ plan_id: "dev_pro", card_token_id: "abcdef123456" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporariamente indisponíveis/);
  });

  test("Minha assinatura e /api/plans continuam funcionando", async () => {
    const { app } = buildApp({ configured: false, user: DEV });
    const page = await request(app).get("/minha-assinatura");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Assinaturas temporariamente indisponíveis.");

    const mine = await request(app).get("/api/assinaturas/minha?sync=1");
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ configured: false, subscription: null, payments: [] });

    const plans = await request(app).get("/api/plans");
    expect(plans.status).toBe(200);
    expect(plans.body).toMatchObject({ current_plan_code: "dev_free", checkout_available: false, subscription: null });
  });
});

describe("com credenciais", () => {
  test("checkout: resumo do plano + container do Brick com a public key (nunca o access token)", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    const res = await request(app).get("/planos/dev_pro/assinar");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Assinar o plano PRO");
    expect(res.text).toContain("cobrado automaticamente");
    expect(res.text).toContain("Cancele quando quiser");
    expect(res.text).toContain('data-public-key="TEST-public-key-abc"');
    expect(res.text).toContain('data-amount="19.90"');
    expect(res.text).toContain("https://sdk.mercadopago.com/js/v2");
    expect(res.text).not.toContain("TEST-token-123");
  });

  test("checkout recebe a CSP que libera o Mercado Pago", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    const res = await request(app).get("/planos/dev_pro/assinar");
    const csp = res.headers["content-security-policy"];
    expect(csp).toMatch(/script-src [^;]*https:\/\/sdk\.mercadopago\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.mercadopago\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.mercadopago\.com/);
  });

  test("quem já assina o plano vê o plano atual em vez do formulário", async () => {
    const { app, db } = buildApp({ configured: true, user: DEV });
    db.state.subscriptions.push({
      id: 1, user_id: 1, plan_id: "dev_pro", mp_preapproval_id: "pre-1", mp_collector_id: 999, status: "authorized",
      next_payment_date: "2026-11-16 12:00:00", paid_until: null, payment_issue: null, cancelled_at: null,
      created_at: db.state.clock, updated_at: db.state.clock,
    });
    const res = await request(app).get("/planos/dev_pro/assinar");
    expect(res.text).toContain("Você já assina este plano");
    expect(res.text).toContain("16/11/2026");
    expect(res.text).not.toContain("cardPaymentBrick_container");
  });

  test("empresa com Básico ativo vê o modo 'trocar de plano' no Premium", async () => {
    const { app, db } = buildApp({ configured: true, user: EMPRESA });
    db.state.subscriptions.push({
      id: 1, user_id: 2, plan_id: "empresa_basico", mp_preapproval_id: "pre-1", mp_collector_id: 999, status: "authorized",
      next_payment_date: null, paid_until: null, payment_issue: null, cancelled_at: null,
      created_at: db.state.clock, updated_at: db.state.clock,
    });
    const res = await request(app).get("/planos/empresa_premium/assinar");
    expect(res.text).toContain("Trocar para o plano Premium");
    expect(res.text).toContain('data-mode="change"');
  });

  test("plano de outro tipo, gratuito ou inexistente → volta para /planos", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    for (const id of ["empresa_premium", "dev_free", "nao_existe", "__proto__"]) {
      const res = await request(app).get(`/planos/${id}/assinar`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/planos");
    }
  });

  test("sync não rodado para a conta atual → indisponível", async () => {
    const { app } = buildApp({ configured: true, user: DEV, setup: ({ db }) => { db.state.mpPlans.length = 0; } });
    const res = await request(app).get("/planos/dev_pro/assinar");
    expect(res.text).toContain("Assinaturas temporariamente indisponíveis");
  });
});

describe("login e permissões", () => {
  test("checkout sem login → login com retorno (e aba empresa para plano de empresa)", async () => {
    const { app } = buildApp({ configured: true, user: null });
    const dev = await request(app).get("/planos/dev_pro/assinar");
    expect(dev.status).toBe(302);
    expect(dev.headers.location).toBe("/login?next=%2Fplanos%2Fdev_pro%2Fassinar");

    const empresa = await request(app).get("/planos/empresa_basico/assinar");
    expect(empresa.headers.location).toBe("/login?next=%2Fplanos%2Fempresa_basico%2Fassinar&tipo=empresa");
  });

  test("Minha assinatura e retorno sem login → login com retorno", async () => {
    const { app } = buildApp({ configured: true, user: null });
    expect((await request(app).get("/minha-assinatura")).headers.location).toBe("/login?next=%2Fminha-assinatura");
    expect((await request(app).get("/assinatura/retorno")).headers.location).toBe("/login?next=%2Fassinatura%2Fretorno");
  });

  test.each([
    ["post", "/api/assinaturas"],
    ["get",  "/api/assinaturas/minha"],
    ["put",  "/api/assinaturas/cancelar"],
    ["put",  "/api/assinaturas/cartao"],
    ["put",  "/api/assinaturas/plano"],
  ])("%s %s sem login → 401", async (method, url) => {
    const { app } = buildApp({ configured: true, user: null });
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(401);
  });

  test("admin não assina planos", async () => {
    const { app } = buildApp({ configured: true, user: { id: 9, type: "admin", email: "a@a.com" } });
    expect((await request(app).get("/planos/dev_pro/assinar")).headers.location).toBe("/admin/dashboard");
    expect((await request(app).get("/minha-assinatura")).headers.location).toBe("/admin/dashboard");
  });

  test("o checkout falso (ativar plano sem pagar) não existe mais", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    const res = await request(app).post("/api/plans/subscribe").send({ plan_code: "dev_pro" });
    expect(res.status).toBe(404);
  });
});

describe("página de resultado", () => {
  test("recusada: motivo traduzido do status_detail + tentar novamente", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    const res = await request(app).get("/assinatura/retorno?status=recusada&plano=dev_pro&motivo=cc_rejected_insufficient_amount");
    expect(res.text).toContain("Pagamento recusado");
    expect(res.text).toContain("O cartão não tem limite suficiente.");
    expect(res.text).toContain('href="/planos/dev_pro/assinar"');
  });

  test("motivo desconhecido/injetado na URL nunca é exibido cru", async () => {
    const { app } = buildApp({ configured: true, user: DEV });
    const res = await request(app).get("/assinatura/retorno?status=recusada&plano=dev_pro&motivo=%3Cscript%3Ealert(1)%3C/script%3E");
    expect(res.text).not.toContain("<script>alert(1)");
    expect(res.text).toContain("Não foi possível concluir a assinatura.");
  });

  test("ativa e pendente refletem a assinatura do usuário", async () => {
    const { app, db } = buildApp({ configured: true, user: DEV });
    db.state.subscriptions.push({
      id: 1, user_id: 1, plan_id: "dev_pro", mp_preapproval_id: "pre-1", mp_collector_id: 999, status: "pending",
      next_payment_date: null, paid_until: null, payment_issue: null, cancelled_at: null,
      created_at: db.state.clock, updated_at: db.state.clock,
    });
    const pending = await request(app).get("/assinatura/retorno");
    expect(pending.text).toContain("Confirmando seu pagamento");
    expect(pending.text).toContain("/api/assinaturas/minha?sync=1"); // polling

    db.state.subscriptions[0].status = "authorized";
    db.state.subscriptions[0].next_payment_date = "2026-11-16 12:00:00";
    const active = await request(app).get("/assinatura/retorno");
    expect(active.text).toContain("Assinatura ativa!");
    expect(active.text).toContain("R$ 19,90/mês");
  });
});
