// Sincronização dos planos com o Mercado Pago (services/mpPlanSync.js), usada
// na subida do servidor e por `npm run mp:sync-plans`. Cria/atualiza os
// preapproval_plan sem duplicar e salva o mp_plan_id por conta.
process.env.MP_ACCESS_TOKEN = "TEST-token";
process.env.MP_PUBLIC_KEY   = "TEST-public";
process.env.APP_URL         = "http://localhost:3000";
delete process.env.APP_BASE_URL;

const mockMpPlans = [];
const mockLocks = new Set();
jest.mock("../../database/db", () => {
  async function query(sql, params) {
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
    if (s === "SELECT plan_code, mp_plan_id FROM mp_plans WHERE mp_account_id = ?") {
      return [mockMpPlans.filter(p => p.mp_account_id === params[0]).map(p => ({ plan_code: p.plan_code, mp_plan_id: p.mp_plan_id }))];
    }
    if (s === "DELETE FROM mp_plans WHERE plan_code = ? AND mp_account_id = ?") {
      const i = mockMpPlans.findIndex(p => p.plan_code === params[0] && p.mp_account_id === params[1]);
      if (i >= 0) mockMpPlans.splice(i, 1);
      return [{ affectedRows: i >= 0 ? 1 : 0 }];
    }
    if (s === "SELECT GET_LOCK(?, 0) AS got") {
      if (mockLocks.has(params[0])) return [[{ got: 0 }]];
      mockLocks.add(params[0]);
      return [[{ got: 1 }]];
    }
    if (s === "SELECT RELEASE_LOCK(?)") { mockLocks.delete(params[0]); return [[{}]]; }
    throw new Error(`query inesperada: ${s}`);
  }
  return { query, getConnection: async () => ({ query, release() {} }) };
});
jest.mock("../../services/mercadoPago", () => ({
  ...jest.requireActual("../../services/mercadoPago"),
  getAccount:  jest.fn(),
  getPlan:     jest.fn(),
  createPlan:  jest.fn(),
  updatePlan:  jest.fn(),
  searchPlans: jest.fn(),
}));

const { MPNotFoundError, MPBadRequestError } = require("mercadopago");
const mp = require("../../services/mercadoPago");
const { desiredPlanBody, needsUpdate, syncPlan, syncAllPlans, syncPlansOnStartup, retireRemovedPlans } = require("../../services/mpPlanSync");
const { getPlan } = require("../../config/plans");

const ACCOUNT = 4242;
const PRO = getPlan("dev_pro");
// Valor mensal do PRO como o Mercado Pago espera (de config/plans.js).
const PRO_VALOR = PRO.price_cents / 100;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockMpPlans.length = 0;
  mockLocks.clear();
  mp.getAccount.mockResolvedValue({ id: ACCOUNT, siteId: "MLB" });
  mp.searchPlans.mockResolvedValue({ results: [] });
  let seq = 0;
  mp.createPlan.mockImplementation(async body => ({ id: `novo-plano-${++seq}`, status: "active", ...body }));
  mp.updatePlan.mockImplementation(async (id, body) => ({ id, status: "active", ...body }));
});
afterEach(() => jest.restoreAllMocks());

test("corpo do plano: mensal, BRL, valor de config/plans.js, só crédito", () => {
  expect(desiredPlanBody(PRO)).toEqual({
    reason: "Ápice — Plano PRO (desenvolvedores)",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: PRO_VALOR, currency_id: "BRL" },
    // site em localhost: o MP recusa back_url local, então vai uma URL pública válida
    back_url: "https://www.mercadopago.com.br",
    payment_methods_allowed: { payment_types: [{ id: "credit_card" }] },
  });
});

test.each([
  ["https://newapice22.onrender.com",  "https://newapice22.onrender.com/assinatura/retorno", false],
  ["https://newapice22.onrender.com/", "https://newapice22.onrender.com/assinatura/retorno", false],
  ["http://localhost:3000",            "https://www.mercadopago.com.br", true],
  ["http://127.0.0.1:3000",            "https://www.mercadopago.com.br", true],
])("APP_BASE_URL %s → back_url %s", (base, expected, isLocal) => {
  jest.isolateModules(() => {
    process.env.APP_BASE_URL = base;
    const cfg = require("../../config/mercadopago");
    expect(cfg.backUrl).toBe(expected);
    expect(cfg.backUrlIsLocal).toBe(isLocal);
  });
  delete process.env.APP_BASE_URL;
});

test("primeira execução cria o plano e salva o mp_plan_id para a conta", async () => {
  const r = await syncPlan(PRO, ACCOUNT);
  expect(mp.createPlan).toHaveBeenCalledWith(desiredPlanBody(PRO));
  expect(r).toMatchObject({ code: "dev_pro", mp_plan_id: "novo-plano-1", action: "criado" });
  expect(mockMpPlans).toEqual([{ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "novo-plano-1", transaction_amount: PRO_VALOR }]);
});

test("rodar de novo sem mudanças não cria nem altera nada", async () => {
  mockMpPlans.push({ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "plano-1", transaction_amount: PRO_VALOR });
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
  expect(r.action).toMatch(new RegExp(`^atualizado \\(valor 9.9 → ${PRO_VALOR}`));
  expect(mockMpPlans[0].transaction_amount).toBe(PRO_VALOR);
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
  expect(mockMpPlans[0].mp_plan_id).toBe("novo-plano-1");
});

test("planos de contas diferentes do MP (teste × produção) ficam separados", async () => {
  await syncPlan(PRO, 1);
  await syncPlan(PRO, 2);
  expect(mockMpPlans.map(p => [p.mp_account_id, p.mp_plan_id])).toEqual([[1, "novo-plano-1"], [2, "novo-plano-2"]]);
});

test("needsUpdate compara só o que importa", () => {
  const desired = desiredPlanBody(PRO);
  expect(needsUpdate({ ...desired, id: "x", status: "active", init_point: "..." }, desired)).toBe(false);
  expect(needsUpdate({ ...desired, reason: "Outro" }, desired)).toBe(true);
});

test("syncAllPlans sincroniza os 2 planos pagos e um erro não impede o outro", async () => {
  mp.createPlan.mockImplementation(async body => {
    if (body.reason.includes("desenvolvedores")) throw new MPBadRequestError({ status: 400, message: "Invalid value for back url, must be a valid URL" });
    return { id: `id-${body.reason}`, status: "active", ...body };
  });

  const { account, results, errors } = await syncAllPlans();
  expect(account.id).toBe(ACCOUNT);
  expect(results.map(r => r.code)).toEqual(["empresa_premium"]);
  expect(errors).toEqual([{ code: "dev_pro", message: expect.stringMatching(/Invalid value for back url.*só aceita back_url pública/) }]);
});

describe("planos removidos de config/plans.js (ex.: o Básico de empresas)", () => {
  test("são desativados no Mercado Pago e o mapeamento é apagado", async () => {
    mockMpPlans.push({ plan_code: "empresa_basico", mp_account_id: ACCOUNT, mp_plan_id: "plano-basico", transaction_amount: 49.9 });
    const { results, errors } = await retireRemovedPlans(ACCOUNT);
    expect(mp.updatePlan).toHaveBeenCalledWith("plano-basico", { status: "cancelled" });
    expect(results).toEqual([{ code: "empresa_basico", mp_plan_id: "plano-basico", action: expect.stringMatching(/^desativado/) }]);
    expect(errors).toEqual([]);
    expect(mockMpPlans).toEqual([]);
  });

  test("planos que continuam no config não são tocados", async () => {
    mockMpPlans.push({ plan_code: "dev_pro", mp_account_id: ACCOUNT, mp_plan_id: "plano-dev", transaction_amount: PRO_VALOR });
    const { results } = await retireRemovedPlans(ACCOUNT);
    expect(results).toEqual([]);
    expect(mp.updatePlan).not.toHaveBeenCalled();
    expect(mockMpPlans).toHaveLength(1);
  });

  test("plano que já não existe no MP (404): só apaga o mapeamento", async () => {
    mockMpPlans.push({ plan_code: "empresa_basico", mp_account_id: ACCOUNT, mp_plan_id: "sumiu", transaction_amount: 49.9 });
    mp.updatePlan.mockRejectedValueOnce(new MPNotFoundError({ status: 404, message: "not found" }));
    const { results, errors } = await retireRemovedPlans(ACCOUNT);
    expect(results).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(mockMpPlans).toEqual([]);
  });

  test("falha ao desativar: mantém o mapeamento (tenta de novo na próxima subida) e avisa", async () => {
    mockMpPlans.push({ plan_code: "empresa_basico", mp_account_id: ACCOUNT, mp_plan_id: "plano-basico", transaction_amount: 49.9 });
    mp.updatePlan.mockRejectedValueOnce(new MPBadRequestError({ status: 400, message: "invalid status" }));
    const { results, errors } = await retireRemovedPlans(ACCOUNT);
    expect(results).toEqual([]);
    expect(errors).toEqual([{ code: "empresa_basico", message: expect.stringMatching(/não foi possível desativar.*painel do Mercado Pago/) }]);
    expect(mockMpPlans).toHaveLength(1);
  });

  test("planos de outra conta do MP não são afetados", async () => {
    mockMpPlans.push({ plan_code: "empresa_basico", mp_account_id: 9999, mp_plan_id: "outra-conta", transaction_amount: 49.9 });
    const { results } = await retireRemovedPlans(ACCOUNT);
    expect(results).toEqual([]);
    expect(mockMpPlans).toHaveLength(1);
  });
});

describe("na subida do servidor", () => {
  test("sincroniza e registra um resumo no log", async () => {
    await syncPlansOnStartup();
    expect(mp.createPlan).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Planos sincronizados \(conta 4242\): dev_pro criado, empresa_premium criado/));
    expect(mockLocks.size).toBe(0); // lock liberado
  });

  test("nas subidas seguintes, com tudo em dia, registra uma linha curta", async () => {
    for (const code of ["dev_pro", "empresa_premium"]) {
      const plan = getPlan(code);
      mockMpPlans.push({ plan_code: code, mp_account_id: ACCOUNT, mp_plan_id: `id-${code}`, transaction_amount: plan.price_cents / 100 });
    }
    mp.getPlan.mockImplementation(async id => {
      const code = id.replace("id-", "");
      return { id, status: "active", ...desiredPlanBody(getPlan(code)) };
    });

    await syncPlansOnStartup();
    expect(mp.createPlan).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("[mercadopago] Assinaturas prontas: 2 planos em dia (conta 4242).");
  });

  test("conta de TESTE: avisa na subida que só pagadores de teste conseguem assinar", async () => {
    mp.getAccount.mockResolvedValue({ id: ACCOUNT, siteId: "MLB", isTestUser: true });
    await syncPlansOnStartup();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("(conta de TESTE 4242)"));
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/só usuários de teste do Mercado Pago conseguem assinar.*credenciais de produção da sua conta real/));
  });

  test("conta real: nenhum aviso de conta de teste", async () => {
    await syncPlansOnStartup();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("conta de TESTE"));
  });

  test("se outra instância já está sincronizando (lock ocupado), não faz nada", async () => {
    mockLocks.add("apice_mp_sync_" + String(process.env.DB_NAME || "").slice(0, 40));
    await syncPlansOnStartup();
    expect(mp.getAccount).not.toHaveBeenCalled();
    expect(mp.createPlan).not.toHaveBeenCalled();
  });

  test("falha geral (ex.: MP fora do ar) só gera log — nunca derruba o servidor", async () => {
    mp.getAccount.mockRejectedValue(new Error("ECONNRESET"));
    await expect(syncPlansOnStartup()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Não foi possível sincronizar os planos"),
      expect.stringContaining("ECONNRESET"),
      expect.any(String)
    );
    expect(mockLocks.size).toBe(0);
  });
});
