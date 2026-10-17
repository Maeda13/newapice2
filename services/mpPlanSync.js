// ============================================
// services/mpPlanSync.js
// Sincroniza os planos pagos de config/plans.js com os preapproval_plan
// do Mercado Pago e salva o mp_plan_id de cada um na tabela mp_plans, por
// conta do MP (credenciais de teste e de produção geram planos diferentes).
//
// Idempotente: para cada plano usa o mp_plan_id já salvo para a conta; se
// não houver (ou ele tiver sido cancelado), adota um plano ativo com o
// mesmo nome antes de criar um novo; planos existentes só são alterados se
// valor/nome/back_url mudaram.
//
// Roda sozinho na inicialização do servidor (syncPlansOnStartup) — assim
// produção precisa só das variáveis de ambiente — e também pelo comando
// `npm run mp:sync-plans` (scripts/mp-sync-plans.js).
// ============================================
const db       = require("../database/db");
const mpConfig = require("../config/mercadopago");
const mp       = require("./mercadoPago");
const { paidPlans, planAmount } = require("../config/plans");

function desiredPlanBody(plan) {
  return {
    reason: `Ápice — Plano ${plan.name} (${plan.type === "empresa" ? "empresas" : "desenvolvedores"})`,
    auto_recurring: {
      frequency:          1,
      frequency_type:     "months",
      transaction_amount: planAmount(plan),
      currency_id:        "BRL",
    },
    back_url: mpConfig.backUrl,
    payment_methods_allowed: { payment_types: [{ id: "credit_card" }] },
  };
}

function needsUpdate(remote, desired) {
  return remote.reason !== desired.reason
    || Number(remote.auto_recurring?.transaction_amount) !== desired.auto_recurring.transaction_amount
    || remote.auto_recurring?.currency_id !== desired.auto_recurring.currency_id
    || Number(remote.auto_recurring?.frequency) !== desired.auto_recurring.frequency
    || remote.auto_recurring?.frequency_type !== desired.auto_recurring.frequency_type
    || remote.back_url !== desired.back_url;
}

const isUsable = remote => remote && remote.id && remote.status !== "cancelled" && remote.status !== "inactive";

async function findRemotePlan(plan, accountId, desired) {
  const [[saved]] = await db.query(
    "SELECT mp_plan_id FROM mp_plans WHERE plan_code = ? AND mp_account_id = ?",
    [plan.code, accountId]
  );
  if (saved) {
    try {
      const remote = await mp.getPlan(saved.mp_plan_id);
      if (isUsable(remote)) return remote;
    } catch (err) {
      if (!mp.isNotFoundError(err)) throw err;
    }
  }

  // Sem mapeamento válido (banco limpo, outra máquina...): adota um plano
  // ativo com o mesmo nome, em vez de criar um duplicado.
  const found = await mp.searchPlans({ status: "active", limit: 100 });
  return (found?.results ?? []).find(p => isUsable(p) && p.reason === desired.reason) ?? null;
}

async function syncPlan(plan, accountId) {
  const desired = desiredPlanBody(plan);
  let remote = await findRemotePlan(plan, accountId, desired);
  let action;

  if (!remote) {
    remote = await mp.createPlan(desired);
    action = "criado";
  } else if (needsUpdate(remote, desired)) {
    const previousAmount = Number(remote.auto_recurring?.transaction_amount);
    remote = { ...remote, ...(await mp.updatePlan(remote.id, desired)) };
    action = "atualizado";
    if (previousAmount !== desired.auto_recurring.transaction_amount) {
      action += ` (valor ${previousAmount} → ${desired.auto_recurring.transaction_amount}; confira no painel do MP se as assinaturas existentes acompanharam)`;
    }
  } else {
    action = "já estava em dia";
  }

  await db.query(`
    INSERT INTO mp_plans (plan_code, mp_account_id, mp_plan_id, transaction_amount)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE mp_plan_id = VALUES(mp_plan_id), transaction_amount = VALUES(transaction_amount)
  `, [plan.code, accountId, remote.id, desired.auto_recurring.transaction_amount]);

  return { code: plan.code, mp_plan_id: remote.id, amount: desired.auto_recurring.transaction_amount, action };
}

function errorHint(err) {
  return /back_url/i.test(err?.message ?? "")
    ? " — o Mercado Pago pode recusar back_url local: use em APP_BASE_URL uma URL pública (ex.: a do Render ou um túnel como ngrok)."
    : "";
}

/** Sincroniza todos os planos pagos; erro em um plano não impede os outros. */
async function syncAllPlans() {
  const account = await mp.getAccount();
  const results = [];
  const errors  = [];
  for (const plan of paidPlans()) {
    try {
      results.push(await syncPlan(plan, account.id));
    } catch (err) {
      errors.push({ code: plan.code, message: `${mp.describeError(err)}${errorHint(err)}` });
    }
  }
  return { account, results, errors };
}

// Lock nomeado no MySQL: duas instâncias subindo juntas não criam o mesmo
// plano duas vezes. Quem não pega o lock simplesmente pula a sincronização.
async function withSyncLock(fn) {
  const lockName = `apice_mp_sync_${String(process.env.DB_NAME || "").slice(0, 40)}`;
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query("SELECT GET_LOCK(?, 0) AS got", [lockName]);
    if (!row || Number(row.got) !== 1) return null;
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/** Chamado pelo server.js depois das migrações; nunca derruba o servidor. */
async function syncPlansOnStartup() {
  if (!mpConfig.isConfigured || !mpConfig.baseUrl) return;
  try {
    const outcome = await withSyncLock(syncAllPlans);
    if (!outcome) return; // outra instância está sincronizando
    if (outcome.results.length) {
      console.log(`[mercadopago] Planos sincronizados (conta ${outcome.account.id}): ` +
        outcome.results.map(r => `${r.code} ${r.action}`).join(", "));
    }
    for (const e of outcome.errors) {
      console.error(`[mercadopago] Falha ao sincronizar o plano ${e.code}: ${e.message}`);
    }
  } catch (err) {
    console.error(
      "[mercadopago] Não foi possível sincronizar os planos na inicialização:",
      mp.describeError(err),
      "— o checkout usa os planos já salvos; rode npm run mp:sync-plans para ver detalhes."
    );
  }
}

module.exports = { desiredPlanBody, needsUpdate, syncPlan, syncAllPlans, syncPlansOnStartup };
