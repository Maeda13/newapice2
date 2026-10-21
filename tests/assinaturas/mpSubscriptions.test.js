// Assinatura recorrente (Mercado Pago) — regras do serviço
// services/mpSubscriptions.js, com a API do MP mockada e um banco em
// memória (helpers/fakeDb.js) que entende as mesmas queries.
process.env.MP_ACCESS_TOKEN   = "TEST-0000000000000000-101612-abcdef-999";
process.env.MP_PUBLIC_KEY     = "TEST-public-key";
process.env.MP_WEBHOOK_SECRET = "segredo-webhook";
process.env.APP_URL           = "http://localhost:3000";
delete process.env.MP_TEST_PAYER_EMAIL;

const { createFakeDb } = require("./helpers/fakeDb");

const mockDbHolder = { current: null };
jest.mock("../../database/db", () => ({
  query:         (...args) => mockDbHolder.current.query(...args),
  getConnection: (...args) => mockDbHolder.current.getConnection(...args),
}));
jest.mock("../../services/mercadoPago", () => {
  const actual = jest.requireActual("../../services/mercadoPago");
  return {
    ...actual,
    getAccount:               jest.fn(),
    createPreapproval:        jest.fn(),
    getPreapproval:           jest.fn(),
    updatePreapproval:        jest.fn(),
    searchPreapprovals:       jest.fn(),
    getAuthorizedPayment:     jest.fn(),
    searchAuthorizedPayments: jest.fn(),
    getPayment:               jest.fn(),
  };
});

const { MPBadRequestError, MPConnectionError } = require("mercadopago");
const mp   = require("../../services/mercadoPago");
const subs = require("../../services/mpSubscriptions");
const { getUserPlanCode } = require("../../services/subscriptionService");

const ACCOUNT_ID = 999;
const DEV     = { id: 1, type: "dev", email: "dev@teste.com" };
const EMPRESA = { id: 2, type: "empresa", email: "empresa@teste.com" };
const TOKEN   = "cardtoken1234567890abcdef";

let db;
let preapprovals; // "API" do MP em memória: id → preapproval

function remotePreapproval(overrides) {
  return {
    id: "pre-1", status: "authorized", collector_id: ACCOUNT_ID,
    external_reference: "1:dev_pro", next_payment_date: "2026-11-16T12:00:00.000-03:00",
    // relógio real: findRecentPreapproval compara com Date.now()
    date_created: new Date().toISOString(), last_modified: new Date(db.state.clock).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  db = createFakeDb();
  mockDbHolder.current = db;
  db.state.users.push(DEV, EMPRESA);
  db.state.mpPlans.push(
    { plan_code: "dev_pro",         mp_account_id: ACCOUNT_ID, mp_plan_id: "plan-dev",     transaction_amount: 19.9 },
    { plan_code: "empresa_basico",  mp_account_id: ACCOUNT_ID, mp_plan_id: "plan-basico",  transaction_amount: 49.9 },
    { plan_code: "empresa_premium", mp_account_id: ACCOUNT_ID, mp_plan_id: "plan-premium", transaction_amount: 99.9 },
  );

  preapprovals = new Map();
  let seq = 0;
  mp.getAccount.mockResolvedValue({ id: ACCOUNT_ID, siteId: "MLB", isTestUser: true });
  mp.createPreapproval.mockImplementation(async body => {
    const plan = { "plan-dev": "dev_pro", "plan-basico": "empresa_basico", "plan-premium": "empresa_premium" }[body.preapproval_plan_id];
    const pre = remotePreapproval({ id: `pre-${++seq}`, external_reference: body.external_reference, preapproval_plan_id: body.preapproval_plan_id, plan });
    preapprovals.set(pre.id, pre);
    return pre;
  });
  mp.getPreapproval.mockImplementation(async id => {
    if (!preapprovals.has(id)) throw new Error(`404 ${id}`);
    return preapprovals.get(id);
  });
  mp.updatePreapproval.mockImplementation(async (id, body) => {
    const pre = preapprovals.get(id);
    if (body.status) pre.status = body.status;
    return pre;
  });
  mp.searchAuthorizedPayments.mockResolvedValue({ results: [] });
  mp.searchPreapprovals.mockResolvedValue({ results: [] });
});

afterEach(() => jest.restoreAllMocks());

describe("criar assinatura (POST /api/assinaturas)", () => {
  test("cria a preapproval com o plano do banco, e-mail do usuário e external_reference — sem valor vindo do front", async () => {
    const sub = await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });

    expect(mp.createPreapproval).toHaveBeenCalledWith({
      preapproval_plan_id: "plan-dev",
      payer_email:         "dev@teste.com",
      card_token_id:       TOKEN,
      external_reference:  "1:dev_pro",
      status:              "authorized",
    });
    expect(sub).toMatchObject({ status: "authorized", has_access: true, plan: { code: "dev_pro", price_cents: 1990 } });
    expect(sub).not.toHaveProperty("mp_preapproval_id");
    expect(db.state.subscriptions).toHaveLength(1);
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_pro");
  });

  test.each([
    ["empresa_basico", 403], // plano de empresa para conta dev
    ["dev_free",       400], // plano gratuito não se assina
    ["constructor",    400], // código inexistente (e herdado de Object)
  ])("plano %s → %i", async (planCode, status) => {
    await expect(subs.createSubscription({ user: DEV, planCode, cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: status });
    expect(mp.createPreapproval).not.toHaveBeenCalled();
  });

  test("token de cartão ausente/estranho → 400 sem chamar o Mercado Pago", async () => {
    for (const cardTokenId of [undefined, "", "abc", "<script>", 123]) {
      await expect(subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId }))
        .rejects.toMatchObject({ httpStatus: 400 });
    }
    expect(mp.createPreapproval).not.toHaveBeenCalled();
  });

  test("impede duas assinaturas ativas para o mesmo usuário (409)", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    await expect(subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 409, reason: "ja_assinante" });
    expect(mp.createPreapproval).toHaveBeenCalledTimes(1);
  });

  test("assinatura pendente anterior é cancelada no MP antes de criar outra", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    db.state.subscriptions[0].status = "pending";

    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    expect(mp.updatePreapproval).toHaveBeenCalledWith("pre-1", { status: "cancelled" });
    expect(db.state.subscriptions.map(s => s.status)).toEqual(["cancelled", "authorized"]);
  });

  test("cartão recusado na validação → 402 com motivo amigável e nada gravado", async () => {
    mp.createPreapproval.mockRejectedValueOnce(new MPBadRequestError({ status: 400, message: "CC_VAL_433 Credit card validation has failed" }));

    await expect(subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 402, reason: "cartao_recusado" });
    expect(db.state.subscriptions).toHaveLength(0);
  });

  test("timeout/erro de rede: procura a assinatura recém-criada antes de dar erro (não duplica cobrança)", async () => {
    const created = remotePreapproval({ id: "pre-orfa", external_reference: "1:dev_pro" });
    preapprovals.set(created.id, created);
    mp.createPreapproval.mockRejectedValueOnce(new MPConnectionError(new Error("socket hang up")));
    mp.searchPreapprovals.mockResolvedValueOnce({ results: [created] });

    const sub = await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    expect(sub.status).toBe("authorized");
    expect(mp.searchPreapprovals).toHaveBeenCalledWith(expect.objectContaining({ payer_email: "dev@teste.com", preapproval_plan_id: "plan-dev" }));
    expect(db.state.subscriptions[0].mp_preapproval_id).toBe("pre-orfa");
  });

  test("valor do plano no MP desatualizado em relação a config/plans.js → indisponível (não cobra outro valor)", async () => {
    db.state.mpPlans.find(p => p.plan_code === "dev_pro").transaction_amount = 9.9;
    await expect(subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 503 });
    expect(mp.createPreapproval).not.toHaveBeenCalled();
    expect(await subs.checkoutAvailability("dev_pro")).toEqual({ available: false, reason: "plan_not_synced" });
  });

  test("plano sem mp_plan_id para a conta atual (sync não rodou) → indisponível", async () => {
    mp.getAccount.mockResolvedValue({ id: 123456, siteId: "MLB" });
    expect(await subs.checkoutAvailability("dev_pro")).toEqual({ available: false, reason: "plan_not_synced" });
    await expect(subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 503 });
  });

  test("duas requisições simultâneas do mesmo usuário: só uma cria a assinatura", async () => {
    const results = await Promise.allSettled([
      subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }),
      subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected").reason.httpStatus).toBe(409);
    expect(mp.createPreapproval).toHaveBeenCalledTimes(1);
  });
});

describe("cancelar (PUT /api/assinaturas/cancelar)", () => {
  test("cancela no MP e mantém o acesso até o fim do período pago", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    // primeira cobrança aprovada, ainda sem webhook: a reconciliação traz
    mp.searchAuthorizedPayments.mockResolvedValue({ results: [{ id: 77, preapproval_id: "pre-1", payment: { id: 5001, status: "approved" } }] });
    mp.getPayment.mockResolvedValue({
      id: 5001, status: "approved", status_detail: "accredited", transaction_amount: 19.9,
      date_created: "2026-10-16T09:00:00.000-03:00", date_approved: "2026-10-16T09:00:05.000-03:00",
    });

    const sub = await subs.cancelSubscription({ user: DEV });

    expect(mp.updatePreapproval).toHaveBeenCalledWith("pre-1", { status: "cancelled" });
    expect(sub).toMatchObject({ status: "cancelled", has_access: true, paid_until: "2026-11-16T12:00:05Z" });
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_pro");

    db.state.clock = Date.parse("2026-11-20T00:00:00Z"); // passou o período pago
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_free");
  });

  test("sem assinatura → 404", async () => {
    await expect(subs.cancelSubscription({ user: DEV })).rejects.toMatchObject({ httpStatus: 404 });
  });

  test("se o MP já tinha cancelado (webhook atrasado), só reflete no banco", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    preapprovals.get("pre-1").status = "cancelled";
    mp.updatePreapproval.mockRejectedValueOnce(new MPBadRequestError({ status: 400, message: "already cancelled" }));
    mp.getPreapproval.mockImplementation(async id => preapprovals.get(id));

    // o PUT falha, mas a consulta mostra que já está cancelada no MP → ok
    await expect(subs.cancelSubscription({ user: DEV })).resolves.toMatchObject({ status: "cancelled" });
  });

  test("falha no MP → 502 e a assinatura continua ativa no banco", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    mp.updatePreapproval.mockRejectedValue(new MPConnectionError(new Error("timeout")));

    await expect(subs.cancelSubscription({ user: DEV })).rejects.toMatchObject({ httpStatus: 502 });
    expect(db.state.subscriptions[0].status).toBe("authorized");
  });
});

describe("trocar cartão e trocar de plano", () => {
  test("trocar cartão envia só o novo token para a preapproval do usuário", async () => {
    await subs.createSubscription({ user: DEV, planCode: "dev_pro", cardTokenId: TOKEN });
    await subs.updateCard({ user: DEV, cardTokenId: "novotoken1234567890" });
    expect(mp.updatePreapproval).toHaveBeenCalledWith("pre-1", { card_token_id: "novotoken1234567890" });
  });

  test("trocar cartão sem assinatura ativa → 404", async () => {
    await expect(subs.updateCard({ user: DEV, cardTokenId: TOKEN })).rejects.toMatchObject({ httpStatus: 404 });
  });

  test("upgrade Básico → Premium: cria a nova assinatura e cancela a antiga", async () => {
    await subs.createSubscription({ user: EMPRESA, planCode: "empresa_basico", cardTokenId: TOKEN });
    const sub = await subs.changePlan({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN });

    expect(mp.createPreapproval).toHaveBeenLastCalledWith(expect.objectContaining({
      preapproval_plan_id: "plan-premium", external_reference: "2:empresa_premium",
    }));
    expect(mp.updatePreapproval).toHaveBeenCalledWith("pre-1", { status: "cancelled" });
    expect(sub.plan.code).toBe("empresa_premium");
    expect(await getUserPlanCode(EMPRESA.id, "empresa")).toBe("empresa_premium");
  });

  test("downgrade Premium → Básico: o Premium já pago continua valendo até o fim do período", async () => {
    await subs.createSubscription({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN });
    db.state.subscriptions[0].paid_until = "2026-11-16 12:00:00";

    await subs.changePlan({ user: EMPRESA, planCode: "empresa_basico", cardTokenId: TOKEN });
    expect(await getUserPlanCode(EMPRESA.id, "empresa")).toBe("empresa_premium");

    db.state.clock = Date.parse("2026-11-17T00:00:00Z");
    expect(await getUserPlanCode(EMPRESA.id, "empresa")).toBe("empresa_basico");
  });

  test("trocar para o mesmo plano → 409; sem assinatura → 404", async () => {
    await expect(subs.changePlan({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 404 });
    await subs.createSubscription({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN });
    await expect(subs.changePlan({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN }))
      .rejects.toMatchObject({ httpStatus: 409 });
  });

  test("se cancelar a antiga falhar na troca, a próxima sincronização cancela a duplicada", async () => {
    await subs.createSubscription({ user: EMPRESA, planCode: "empresa_basico", cardTokenId: TOKEN });
    mp.updatePreapproval.mockRejectedValueOnce(new MPConnectionError(new Error("timeout")));
    mp.getPreapproval.mockImplementation(async id => preapprovals.get(id));

    await subs.changePlan({ user: EMPRESA, planCode: "empresa_premium", cardTokenId: TOKEN });
    expect(db.state.subscriptions.filter(s => s.status === "authorized")).toHaveLength(2);

    await subs.syncUserSubscriptions(EMPRESA.id, { force: true });
    const open = db.state.subscriptions.filter(s => s.status === "authorized");
    expect(open).toHaveLength(1);
    expect(open[0].plan_id).toBe("empresa_premium");
  });
});

describe("webhook — processNotification (sempre busca na API, idempotente)", () => {
  const payment = overrides => ({
    id: 9001, status: "approved", status_detail: "accredited", transaction_amount: 19.9,
    date_created: "2026-10-16T10:00:00.000Z", date_approved: "2026-10-16T10:00:03.000Z",
    point_of_interaction: { type: "SUBSCRIPTIONS", transaction_data: { subscription_id: "pre-ext" } },
    ...overrides,
  });

  test("subscription_preapproval desconhecida com nosso external_reference é adotada; repetir não duplica", async () => {
    preapprovals.set("pre-ext", remotePreapproval({ id: "pre-ext", external_reference: "1:dev_pro" }));

    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-ext" });
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-ext" });

    expect(mp.getPreapproval).toHaveBeenCalledWith("pre-ext");
    expect(db.state.subscriptions).toHaveLength(1);
    expect(db.state.subscriptions[0]).toMatchObject({ user_id: 1, plan_id: "dev_pro", status: "authorized", mp_collector_id: ACCOUNT_ID });
  });

  test("status vindo do MP é aplicado (pausada/cancelada)", async () => {
    preapprovals.set("pre-ext", remotePreapproval({ id: "pre-ext" }));
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-ext" });

    preapprovals.get("pre-ext").status = "paused";
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-ext" });
    expect(db.state.subscriptions[0].status).toBe("paused");

    preapprovals.get("pre-ext").status = "cancelled";
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-ext" });
    expect(db.state.subscriptions[0].status).toBe("cancelled");
    expect(db.state.subscriptions[0].cancelled_at).not.toBeNull();
  });

  test("external_reference de outro sistema / usuário de outro tipo é ignorado", async () => {
    preapprovals.set("pre-x", remotePreapproval({ id: "pre-x", external_reference: "pedido-123" }));
    preapprovals.set("pre-y", remotePreapproval({ id: "pre-y", external_reference: "1:empresa_premium" })); // user 1 é dev
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-x" });
    await subs.processNotification({ type: "subscription_preapproval", dataId: "pre-y" });
    expect(db.state.subscriptions).toHaveLength(0);
  });

  test("payment: grava a cobrança, calcula o fim do período pago e marca/desmarca 'problema de cobrança'", async () => {
    preapprovals.set("pre-ext", remotePreapproval({ id: "pre-ext" }));
    mp.getPayment.mockResolvedValueOnce(payment());
    await subs.processNotification({ type: "payment", dataId: "9001" });

    let sub = db.state.subscriptions[0];
    expect(db.state.payments).toHaveLength(1);
    expect(sub.paid_until).toBe("2026-11-16 10:00:03");
    expect(sub.payment_issue).toBeNull();

    // renovação recusada → problema (o MP fará novas tentativas)
    mp.getPayment.mockResolvedValueOnce(payment({
      id: 9002, status: "rejected", status_detail: "cc_rejected_insufficient_amount",
      date_created: "2026-11-16T10:00:00.000Z", date_approved: null,
    }));
    await subs.processNotification({ type: "payment", dataId: "9002" });
    sub = db.state.subscriptions[0];
    expect(sub.payment_issue).toBe("cc_rejected_insufficient_amount");

    const summary = await subs.getSummary(DEV.id);
    expect(summary.subscription.payment_issue).toEqual({
      code: "cc_rejected_insufficient_amount", message: "O cartão não tem limite suficiente.",
      grace_until: "2026-11-26T10:00:03.000Z", // fim do período pago + 10 dias de novas tentativas
    });
    expect(summary.subscription.has_access).toBe(true);
    expect(summary.payments[0]).toMatchObject({ id: "9002", status_label: "Recusado", message: "O cartão não tem limite suficiente." });

    // nova tentativa aprovada → problema some e o período avança
    mp.getPayment.mockResolvedValueOnce(payment({
      id: 9003, date_created: "2026-11-18T10:00:00.000Z", date_approved: "2026-11-18T10:00:01.000Z",
    }));
    await subs.processNotification({ type: "payment", dataId: "9003" });
    sub = db.state.subscriptions[0];
    expect(sub.payment_issue).toBeNull();
    expect(sub.paid_until).toBe("2026-12-18 10:00:01");

    // mesma notificação de novo: nada duplica
    mp.getPayment.mockResolvedValueOnce(payment({
      id: 9003, date_created: "2026-11-18T10:00:00.000Z", date_approved: "2026-11-18T10:00:01.000Z",
    }));
    await subs.processNotification({ type: "payment", dataId: "9003" });
    expect(db.state.payments).toHaveLength(3);
  });

  test("subscription_authorized_payment: busca a fatura, a assinatura e o pagamento", async () => {
    preapprovals.set("pre-ext", remotePreapproval({ id: "pre-ext" }));
    mp.getAuthorizedPayment.mockResolvedValue({ id: 6114264375, preapproval_id: "pre-ext", payment: { id: 9100, status: "approved" } });
    mp.getPayment.mockResolvedValue(payment({ id: 9100, point_of_interaction: undefined }));

    await subs.processNotification({ type: "subscription_authorized_payment", dataId: "6114264375" });

    expect(mp.getAuthorizedPayment).toHaveBeenCalledWith("6114264375");
    expect(mp.getPayment).toHaveBeenCalledWith(9100);
    expect(db.state.payments[0]).toMatchObject({ mp_payment_id: "9100", status: "approved" });
  });

  test("pagamento que não é de assinatura é ignorado", async () => {
    mp.getPayment.mockResolvedValue(payment({ point_of_interaction: { type: "CHECKOUT" }, metadata: {} }));
    await subs.processNotification({ type: "payment", dataId: "1" });
    expect(db.state.subscriptions).toHaveLength(0);
    expect(db.state.payments).toHaveLength(0);
  });

  test("tópicos sem ação (ex.: subscription_preapproval_plan) não chamam a API", async () => {
    await subs.processNotification({ type: "subscription_preapproval_plan", dataId: "abc" });
    expect(mp.getPreapproval).not.toHaveBeenCalled();
    expect(mp.getPayment).not.toHaveBeenCalled();
  });
});

describe("utilitários", () => {
  test("datas do MP (com fuso) viram DATETIME UTC", () => {
    expect(subs.toUtcDateTime("2026-10-16T13:07:14.260-04:00")).toBe("2026-10-16 17:07:14");
    expect(subs.toUtcDateTime(null)).toBeNull();
    expect(subs.toUtcDateTime("lixo")).toBeNull();
  });

  test("external_reference só aceita userId:planCode", () => {
    expect(subs.parseExternalReference("42:dev_pro")).toEqual({ userId: 42, planCode: "dev_pro" });
    expect(subs.parseExternalReference("42:dev_pro; DROP")).toBeNull();
    expect(subs.parseExternalReference(undefined)).toBeNull();
  });

  test("status desconhecido do MP vira cancelada (para de dar acesso após o período pago)", () => {
    expect(subs.normalizeStatus("authorized")).toBe("authorized");
    expect(subs.normalizeStatus("canceled")).toBe("cancelled");
    expect(subs.normalizeStatus("finished")).toBe("cancelled");
  });
});
