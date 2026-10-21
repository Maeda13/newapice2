// Acesso premium calculado a partir da assinatura (services/subscriptionService.js)
// e o middleware requirePlan(...) (middlewares/requirePlan.js).
const { createFakeDb } = require("./helpers/fakeDb");

const mockDbHolder = { current: null };
jest.mock("../../database/db", () => ({
  query: (...args) => mockDbHolder.current.query(...args),
}));

const express = require("express");
const request = require("supertest");
const { getUserPlanCode, getPlanCodesBulk } = require("../../services/subscriptionService");
const { requirePlan } = require("../../middlewares/requirePlan");

let db;
function addSub(fields) {
  db.state.subscriptions.push({
    id: db.state.nextSubId++, user_id: 1, plan_id: "dev_pro", mp_preapproval_id: `pre-${db.state.nextSubId}`,
    mp_collector_id: 1, status: "authorized", next_payment_date: null, paid_until: null, payment_issue: null,
    cancelled_at: null, created_at: db.state.clock, updated_at: db.state.clock, ...fields,
  });
}

beforeEach(() => {
  db = createFakeDb();
  mockDbHolder.current = db;
});

describe("plano efetivo do usuário", () => {
  test("sem nada → gratuito do tipo da conta", async () => {
    expect(await getUserPlanCode(1, "dev")).toBe("dev_free");
    expect(await getUserPlanCode(2, "empresa")).toBe("empresa_free");
  });

  test.each([
    ["authorized", null, "dev_pro"],
    ["authorized", "2026-01-01 00:00:00", "dev_pro"], // problema de cobrança/retentativas: segue ativa
    ["pending",    null, "dev_free"],
    ["cancelled",  "2026-11-01 00:00:00", "dev_pro"],  // cancelada, mas dentro do período pago
    ["cancelled",  "2026-10-01 00:00:00", "dev_free"], // período pago acabou
    ["cancelled",  null, "dev_free"],
    ["paused",     "2026-11-01 00:00:00", "dev_pro"],
    ["paused",     null, "dev_free"],
  ])("assinatura %s com paid_until %s → %s", async (status, paidUntil, expected) => {
    addSub({ status, paid_until: paidUntil });
    expect(await getUserPlanCode(1, "dev")).toBe(expected);
  });

  test.each([
    // [paid_until, criada há N dias, esperado]
    ["2026-10-10 00:00:00", 40, "dev_pro"],  // recusada, mas dentro dos 10 dias de novas tentativas
    ["2026-09-30 00:00:00", 60, "dev_free"], // recusada e passou a carência: sem acesso mesmo 'authorized'
    [null,                   3, "dev_pro"],  // primeira cobrança recusada, assinatura recém-criada
    [null,                  30, "dev_free"], // nunca pagou e passou a carência
  ])("authorized com cobrança recusada (paid_until %s, criada há %i dias) → %s", async (paidUntil, ageDays, expected) => {
    addSub({
      status: "authorized", paid_until: paidUntil, payment_issue: "cc_rejected_insufficient_amount",
      created_at: db.state.clock - ageDays * 24 * 3600 * 1000,
    });
    expect(await getUserPlanCode(1, "dev")).toBe(expected);
  });

  test("plano manual do admin continua valendo; com assinatura paga, vale o melhor", async () => {
    db.state.manualPlans.push({ user_id: 2, plan_code: "empresa_premium", status: "active" });
    addSub({ user_id: 2, plan_id: "empresa_basico", status: "authorized" });
    expect(await getUserPlanCode(2, "empresa")).toBe("empresa_premium");
  });

  test("plano de outro tipo de conta é ignorado", async () => {
    addSub({ user_id: 1, plan_id: "empresa_premium", status: "authorized" });
    expect(await getUserPlanCode(1, "dev")).toBe("dev_free");
  });

  test("versão em lote considera assinatura paga e plano manual", async () => {
    addSub({ user_id: 1, status: "authorized" });
    db.state.manualPlans.push({ user_id: 3, plan_code: "dev_pro", status: "active" });
    expect(await getPlanCodesBulk([1, 2, 3], "dev")).toEqual({ 1: "dev_pro", 2: "dev_free", 3: "dev_pro" });
  });
});

describe("requirePlan(...)", () => {
  function buildApp(user) {
    const app = express();
    app.use((req, _res, next) => { req.session = { user }; next(); });
    app.get("/api/premium", requirePlan("empresa_premium"), (req, res) => res.json({ ok: true, plan: req.userPlan.code }));
    app.get("/api/custom", requirePlan(["empresa_basico", "empresa_premium"], { message: "Só para planos pagos." }), (_req, res) => res.json({ ok: true }));
    app.get("/pagina-premium", requirePlan("empresa_premium"), (_req, res) => res.send("ok"));
    return app;
  }

  test("API sem login → 401", async () => {
    const res = await request(buildApp(null)).get("/api/premium");
    expect(res.status).toBe(401);
  });

  test("página sem login → login com ?next=", async () => {
    const res = await request(buildApp(null)).get("/pagina-premium");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?next=%2Fpagina-premium");
  });

  test("plano insuficiente → 402 (API) / redireciona para /planos (página)", async () => {
    const app = buildApp({ id: 2, type: "empresa" });
    const api = await request(app).get("/api/premium");
    expect(api.status).toBe(402);
    expect(api.body).toEqual({ error: "Recurso exclusivo do plano Premium.", required_plans: ["empresa_premium"] });

    const page = await request(app).get("/pagina-premium");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/planos");
  });

  test("com o plano certo (via assinatura paga) → passa e expõe req.userPlan", async () => {
    addSub({ user_id: 2, plan_id: "empresa_premium", status: "authorized" });
    const res = await request(buildApp({ id: 2, type: "empresa" })).get("/api/premium");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plan: "empresa_premium" });
  });

  test("aceita lista de planos e mensagem própria", async () => {
    const app = buildApp({ id: 2, type: "empresa" });
    expect((await request(app).get("/api/custom")).body.error).toBe("Só para planos pagos.");
    addSub({ user_id: 2, plan_id: "empresa_basico", status: "authorized" });
    expect((await request(app).get("/api/custom")).status).toBe(200);
  });
});
