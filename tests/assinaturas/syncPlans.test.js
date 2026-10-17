// npm run mp:sync-plans — scripts/mp-sync-plans.js
// Cria/atualiza os preapproval_plan sem duplicar e salva o mp_plan_id por conta.
process.env.MP_ACCESS_TOKEN = "TEST-token";
process.env.MP_PUBLIC_KEY   = "TEST-public";
process.env.APP_URL         = "http://localhost:3000";
delete process.env.APP_BASE_URL;

const mockMpPlans = [];
jest.mock("../../database/db", () => ({
  query: jest.fn(async (sql, params) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT mp_plan_id FROM mp_plans")) {
      const row = mockMpPlans.find(p => p.plan_code === params[0] && p.mp_account_id === params[1]);
      return [row ? [{ mp_plan_id: row.mp_plan_id }] : []];
    }
    if (s.startsWith("INSERT INTO mp_plans")) {
      const [plan_code, mp_account_id, mp_plan_id, transaction_amount] = params;
      const row = mockMpPlans.find(p => p.plan_code === plan_code && p.mp_account_id === mp_account_id);
      if (row) Object.assign(row, { mp_plan_id, transaction_amount });
      else mockMpPlans.push({ plan_code, mp_account_id, mp_plan_id, transaction_amount });
      return [{}];
    }
    throw new Error(`query inesperada: ${s}`);
  }),
}));
jest.mock("../../services/mercadoPago", () => ({
  ...jest.requireActual("../../services/mercadoPago"),
  getPlan:     jest.fn(),
  createPlan:  jest.fn(),
  updatePlan:  jest.fn(),
  searchPlans: jest.fn(),
}));

const { MPNotFoundError } = require("mercadopago");
const mp = require("../../services/mercadoPago");
const { desiredPlanBody, needsUpdate, syncPlan } = require("../../scripts/mp-sync-plans");
const { getPlan } = require("../../config/plans");

const ACCOUNT = 4242;
const PRO = getPlan("dev_pro");

beforeEach(() => {
  jest.clearAllMocks();
  mockMpPlans.length = 0;
  mp.searchPlans.mockResolvedValue({ results: [] });
  mp.createPlan.mockImplementation(async body => ({ id: "novo-plano", status: "active", ...body }));
  mp.updatePlan.mockImplementation(async (id, body) => ({ id, status: "active", ...body }));
});

test("corpo do plano: mensal, BRL, valor de config/plans.js, back_url /assinatura/retorno, só crédito", () => {
  expect(desiredPlanBody(PRO)).toEqual({
    reason: "Ápice — Plano PRO (desenvolvedores)",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 19.9, currency_id: "BRL" },
    back_url: "http://localhost:3000/assinatura/retorno",
    payment_methods_allowed: { payment_types: [{ id: "credit_card" }] },
  });
});

test("primeira execução cria o plano e salva o mp_plan_id para a conta", async () => {
  const r = await syncPlan(PRO, ACCOUNT);
  expect(mp.createPlan).toHaveBeenCalledWith(desiredPlanBody(PRO));
  expect(r).toMatchObject({ code: "dev_pro", mp_plan_id: "novo-plano", action: "criado" });
  expect(mockMpPlans).toEqual([{ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "novo-plano", transaction_amount: 19.9 }]);
});

test("rodar de novo sem mudanças não cria nem altera nada", async () => {
  mockMpPlans.push({ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "plano-1", transaction_amount: 19.9 });
  mp.getPlan.mockResolvedValue({ id: "plano-1", status: "active", ...desiredPlanBody(PRO) });

  const r = await syncPlan(PRO, ACCOUNT);
  expect(r.action).toBe("já estava em dia");
  expect(mp.createPlan).not.toHaveBeenCalled();
  expect(mp.updatePlan).not.toHaveBeenCalled();
});

test("preço/back_url diferentes → atualiza o mesmo plano (não cria outro)", async () => {
  mockMpPlans.push({ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "plano-1", transaction_amount: 9.9 });
  const remote = { id: "plano-1", status: "active", ...desiredPlanBody(PRO) };
  remote.auto_recurring = { ...remote.auto_recurring, transaction_amount: 9.9 };
  remote.back_url = "https://antigo.example.com/assinatura/retorno";
  mp.getPlan.mockResolvedValue(remote);

  const r = await syncPlan(PRO, ACCOUNT);
  expect(mp.updatePlan).toHaveBeenCalledWith("plano-1", desiredPlanBody(PRO));
  expect(mp.createPlan).not.toHaveBeenCalled();
  expect(r.action).toMatch(/^atualizado \(valor 9.9 → 19.9/);
  expect(mockMpPlans[0].transaction_amount).toBe(19.9);
});

test("sem mapeamento no banco, adota plano ativo com o mesmo nome em vez de duplicar", async () => {
  mp.searchPlans.mockResolvedValue({ results: [
    { id: "outro", status: "active", reason: "Outro plano qualquer" },
    { id: "existente", status: "active", ...desiredPlanBody(PRO) },
  ] });

  const r = await syncPlan(PRO, ACCOUNT);
  expect(mp.createPlan).not.toHaveBeenCalled();
  expect(r).toMatchObject({ mp_plan_id: "existente", action: "já estava em dia" });
});

test("mp_plan_id salvo que sumiu/foi cancelado no MP → cria um novo", async () => {
  mockMpPlans.push({ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "apagado", transaction_amount: 19.9 });
  mp.getPlan.mockRejectedValue(new MPNotFoundError({ status: 404, message: "not found" }));

  const r = await syncPlan(PRO, ACCOUNT);
  expect(r.action).toBe("criado");
  expect(mockMpPlans[0].mp_plan_id).toBe("novo-plano");
});

test("planos de contas diferentes do MP (teste × produção) ficam separados", async () => {
  await syncPlan(PRO, 1);
  mp.createPlan.mockImplementationOnce(async body => ({ id: "plano-prod", status: "active", ...body }));
  await syncPlan(PRO, 2);
  expect(mockMpPlans.map(p => [p.mp_account_id, p.mp_plan_id])).toEqual([[1, "novo-plano"], [2, "plano-prod"]]);
});

test("needsUpdate compara só o que importa", () => {
  const desired = desiredPlanBody(PRO);
  expect(needsUpdate({ ...desired, id: "x", status: "active", init_point: "..." }, desired)).toBe(false);
  expect(needsUpdate({ ...desired, reason: "Outro" }, desired)).toBe(true);
});
