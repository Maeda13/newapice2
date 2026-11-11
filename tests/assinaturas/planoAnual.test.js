// Plano anual (services/mpAnnual.js): pagamento ÚNICO no Mercado Pago, à vista
// ou em até 12x no cartão, que libera o plano por 12 meses — sem renovação
// automática. API do MP mockada e banco em memória (helpers/fakeDb.js).
process.env.MP_ACCESS_TOKEN   = "TEST-0000000000000000-101612-abcdef-999";
process.env.MP_PUBLIC_KEY     = "TEST-public-key";
process.env.APP_URL           = "http://localhost:3000";
delete process.env.MP_WEBHOOK_SECRET;
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
    getAccount:         jest.fn(),
    createPayment:      jest.fn(),
    getPayment:         jest.fn(),
    searchPayments:     jest.fn(),
    getPreapproval:     jest.fn(),
    searchAuthorizedPayments: jest.fn(),
  };
});

const { MPConnectionError, MPBadRequestError } = require("mercadopago");
const mp     = require("../../services/mercadoPago");
const annual = require("../../services/mpAnnual");
const { getUserPlanCode } = require("../../services/subscriptionService");
const { getPlan, MAX_PARCELAS_ANUAL } = require("../../config/plans");

const DEV     = { id: 1, type: "dev", email: "dev@teste.com" };
const EMPRESA = { id: 2, type: "empresa", email: "empresa@teste.com" };
const TOKEN   = "cardtoken1234567890abcdef";
const DIA     = 24 * 3600 * 1000;

let db;
let pagamentos; // "API" de pagamentos do MP em memória: id → pagamento
let seq;

const form = (overrides = {}) => ({
  token: TOKEN, payment_method_id: "visa", issuer_id: "25", installments: 12,
  payer: { identification: { type: "CPF", number: "123.456.789-09" } },
  ...overrides,
});

// O MP aprova (ou não) conforme o "status" que o teste escolher.
function mpRespondeCom(status, extra = {}) {
  mp.createPayment.mockImplementation(async body => {
    const agora = new Date(db.state.clock).toISOString();
    const p = {
      id: 7000 + (++seq), status, status_detail: extra.status_detail ?? (status === "approved" ? "accredited" : status),
      transaction_amount: body.transaction_amount, installments: body.installments,
      external_reference: body.external_reference, date_created: new Date().toISOString(),
      date_approved: status === "approved" ? agora : null,
      ...extra,
    };
    pagamentos.set(String(p.id), p);
    return p;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  db = createFakeDb();
  db.state.clock = Date.now(); // as travas do anual comparam com o relógio real
  mockDbHolder.current = db;
  db.state.users.push(DEV, EMPRESA);

  pagamentos = new Map();
  seq = 0;
  mp.getAccount.mockResolvedValue({ id: 999, siteId: "MLB", isTestUser: true });
  mp.getPayment.mockImplementation(async id => {
    if (!pagamentos.has(String(id))) throw Object.assign(new Error("404"), { status: 404 });
    return pagamentos.get(String(id));
  });
  mpRespondeCom("approved");
});
afterEach(() => jest.restoreAllMocks());

describe("pagar o plano anual", () => {
  test("cobra o valor do ano do config/plans.js (nunca do front), em até 12x, com o e-mail do usuário", async () => {
    const a = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form({ installments: 12 }) });

    const [body, chave] = mp.createPayment.mock.calls[0];
    expect(body).toMatchObject({
      transaction_amount: getPlan("dev_pro").annual_price_cents / 100, // 238.8
      installments: 12,
      payment_method_id: "visa",
      issuer_id: 25,
      token: TOKEN,
      external_reference: "anual:1:dev_pro",
      payer: { email: "dev@teste.com", identification: { type: "CPF", number: "12345678909" } },
    });
    expect(body.transaction_amount).toBe(238.8);
    expect(typeof chave).toBe("string"); // chave de idempotência
    expect(a).toMatchObject({ status: "approved", has_access: true, installments: 12, plan: { code: "dev_pro" } });
  });

  test("aprovado → plano liberado por 12 meses; depois disso volta ao gratuito", async () => {
    const a = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    const validade = Date.parse(a.valid_until);
    const esperado = new Date(db.state.clock); esperado.setUTCMonth(esperado.getUTCMonth() + 12);
    expect(Math.abs(validade - esperado.getTime())).toBeLessThan(2000);

    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_pro");
    db.state.clock = validade + 1000;
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_free");
  });

  test("empresa paga o anual do PRO de empresas (R$ 958,80)", async () => {
    await annual.createAnnualPayment({ user: EMPRESA, planCode: "empresa_premium", form: form({ installments: 1 }) });
    expect(mp.createPayment.mock.calls[0][0]).toMatchObject({ transaction_amount: 958.8, installments: 1, external_reference: "anual:2:empresa_premium" });
    expect(await getUserPlanCode(EMPRESA.id, "empresa")).toBe("empresa_premium");
  });

  test.each([
    [{ installments: 0 }, 400],
    [{ installments: MAX_PARCELAS_ANUAL + 1 }, 400],
    [{ installments: "abc" }, 400],
    [{ token: "x" }, 400],
    [{ payment_method_id: "VISA <script>" }, 400],
    [{ issuer_id: "abc" }, 400],
    [{ payer: { identification: { type: "CPF", number: "12" } } }, 400],
  ])("dados inválidos do formulário %j → %i, nada é cobrado", async (over, status) => {
    await expect(annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form(over) }))
      .rejects.toMatchObject({ httpStatus: status });
    expect(mp.createPayment).not.toHaveBeenCalled();
  });

  test.each([
    ["dev_free", DEV, 400],          // plano gratuito
    ["empresa_premium", DEV, 403],   // plano do outro tipo de conta
    ["nao_existe", DEV, 400],
  ])("plano %s → %i", async (planCode, user, status) => {
    await expect(annual.createAnnualPayment({ user, planCode, form: form() })).rejects.toMatchObject({ httpStatus: status });
    expect(mp.createPayment).not.toHaveBeenCalled();
  });

  test("recusado pelo emissor: registra, sem acesso", async () => {
    mpRespondeCom("rejected", { status_detail: "cc_rejected_insufficient_amount" });
    const a = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    expect(a).toMatchObject({ status: "rejected", has_access: false, valid_until: null });
    expect(a.message).toMatch(/limite/);
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_free");
  });

  test("com a assinatura mensal ativa → 409 (cancele a mensal antes)", async () => {
    db.state.subscriptions.push({
      id: 1, user_id: 1, plan_id: "dev_pro", mp_preapproval_id: "pre-1", mp_collector_id: 999, status: "authorized",
      next_payment_date: null, paid_until: null, payment_issue: null, cancelled_at: null,
      created_at: db.state.clock, updated_at: db.state.clock,
    });
    await expect(annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() }))
      .rejects.toMatchObject({ httpStatus: 409, reason: "ja_assinante" });
    expect(mp.createPayment).not.toHaveBeenCalled();
  });

  test("pagamento anterior ainda em análise → 409, sem cobrar de novo", async () => {
    mpRespondeCom("in_process", { status_detail: "pending_review_manual" });
    await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    await expect(annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() }))
      .rejects.toMatchObject({ httpStatus: 409, reason: "em_analise" });
    expect(mp.createPayment).toHaveBeenCalledTimes(1);
  });

  test("ano vigente com mais de 30 dias → 409; nos últimos 30 dias renova sem perder dias", async () => {
    const primeiro = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    await expect(annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() }))
      .rejects.toMatchObject({ httpStatus: 409, reason: "anual_vigente" });

    // 20 dias antes do fim: renova; o novo ano começa quando o atual termina.
    const fimPrimeiro = Date.parse(primeiro.valid_until);
    db.state.clock = fimPrimeiro - 20 * DIA;
    jest.spyOn(Date, "now").mockReturnValue(db.state.clock);
    const segundo = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    const esperado = new Date(fimPrimeiro); esperado.setUTCMonth(esperado.getUTCMonth() + 12);
    expect(Date.parse(segundo.valid_until)).toBe(esperado.getTime());
  });

  test("timeout na criação: procura o pagamento recém-criado antes de dar erro (não cobra duas vezes)", async () => {
    const existente = { id: 9999, status: "approved", status_detail: "accredited", transaction_amount: 238.8, installments: 3,
      external_reference: "anual:1:dev_pro", date_created: new Date().toISOString(), date_approved: new Date(db.state.clock).toISOString() };
    mp.createPayment.mockRejectedValue(new MPConnectionError(new Error("timeout")));
    mp.searchPayments.mockResolvedValue({ results: [existente] });

    const a = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    expect(mp.searchPayments).toHaveBeenCalledWith(expect.objectContaining({ external_reference: "anual:1:dev_pro" }));
    expect(a).toMatchObject({ status: "approved", has_access: true });
  });

  test("erro definitivo do MP → erro amigável, nada gravado", async () => {
    mp.createPayment.mockRejectedValue(new MPBadRequestError({ status: 400, message: "invalid card" }));
    await expect(annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() })).rejects.toMatchObject({ httpStatus: expect.any(Number) });
    expect(db.state.annualPayments).toHaveLength(0);
  });
});

describe("webhook do pagamento anual", () => {
  test("em análise → aprovado pelo webhook libera o plano; repetir não muda a validade", async () => {
    mpRespondeCom("in_process", { status_detail: "pending_review_manual" });
    const a = await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_free");

    const id = a ? [...pagamentos.keys()][0] : null;
    pagamentos.get(id).status = "approved";
    pagamentos.get(id).date_approved = new Date(db.state.clock).toISOString();
    await annual.processNotification({ type: "payment", dataId: id });
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_pro");

    const validade = db.state.annualPayments[0].valid_until;
    await annual.processNotification({ type: "payment", dataId: id });
    expect(db.state.annualPayments).toHaveLength(1);
    expect(db.state.annualPayments[0].valid_until).toBe(validade);
  });

  test("estorno ou chargeback tiram o acesso", async () => {
    await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    const id = [...pagamentos.keys()][0];
    pagamentos.get(id).status = "refunded";
    await annual.processNotification({ type: "payment", dataId: id });
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_free");
  });

  test("pagamento anual que não conhecíamos é adotado pelo external_reference", async () => {
    pagamentos.set("555", { id: 555, status: "approved", transaction_amount: 238.8, installments: 1,
      external_reference: "anual:1:dev_pro", date_approved: new Date(db.state.clock).toISOString() });
    await annual.processNotification({ type: "payment", dataId: "555" });
    expect(db.state.annualPayments).toHaveLength(1);
    expect(await getUserPlanCode(DEV.id, "dev")).toBe("dev_pro");
  });

  test("pagamento avulso que não é do anual nem de assinatura é ignorado", async () => {
    pagamentos.set("777", { id: 777, status: "approved", external_reference: "outra-coisa" });
    expect(await annual.processNotification({ type: "payment", dataId: "777" })).toBeNull();
    expect(db.state.annualPayments).toHaveLength(0);
  });
});

describe("resumo (Minha assinatura)", () => {
  test("inclui o plano anual vigente", async () => {
    await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form({ installments: 6 }) });
    const resumo = await annual.getSummary(DEV.id);
    expect(resumo.annual).toMatchObject({ status: "approved", has_access: true, installments: 6, amount: 238.8, plan: { code: "dev_pro" } });
    expect(resumo.subscription).toBeNull();
  });

  test("sync reconsulta no MP o pagamento ainda em análise", async () => {
    mpRespondeCom("in_process");
    await annual.createAnnualPayment({ user: DEV, planCode: "dev_pro", form: form() });
    const id = [...pagamentos.keys()][0];
    Object.assign(pagamentos.get(id), { status: "approved", date_approved: new Date(db.state.clock).toISOString() });

    const resumo = await annual.getSummary(DEV.id, { sync: true });
    expect(resumo.annual).toMatchObject({ status: "approved", has_access: true });
  });
});
