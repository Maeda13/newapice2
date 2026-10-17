// ============================================
// scripts/mp-sync-plans.js — npm run mp:sync-plans
//
// Cria/atualiza no Mercado Pago (preapproval_plan) os planos pagos de
// config/plans.js e salva o mp_plan_id de cada um na tabela mp_plans,
// por conta do Mercado Pago (teste e produção ficam separados).
//
// Idempotente: rodar de novo não duplica planos. Para cada plano, usa o
// mp_plan_id já salvo para esta conta; se não houver (ou ele tiver sido
// cancelado), procura no MP um plano ativo com o mesmo nome antes de criar
// um novo. Planos existentes só são alterados se valor/nome/back_url mudaram.
//
// Rode de novo sempre que: trocar as credenciais (teste → produção),
// mudar preço/nome em config/plans.js ou mudar APP_BASE_URL/APP_URL.
//
// Opção: --encerrar-assinaturas-de-outra-conta
//   Marca como canceladas (só no banco) as assinaturas abertas que
//   pertencem a OUTRA conta do Mercado Pago — tipicamente as de teste,
//   quando o banco é compartilhado e as credenciais viraram de produção.
// ============================================
require("dotenv").config();
const mpConfig = require("../config/mercadopago");
const mp       = require("../services/mercadoPago");
const { paidPlans, planAmount } = require("../config/plans");

// Carregado só depois de validar as credenciais: abrir o pool já dispara
// as migrações automáticas (database/db.js).
let dbLoaded = false;
function getDb() {
  dbLoaded = true;
  return require("../database/db");
}

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
  const [[saved]] = await getDb().query(
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

  await getDb().query(`
    INSERT INTO mp_plans (plan_code, mp_account_id, mp_plan_id, transaction_amount)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE mp_plan_id = VALUES(mp_plan_id), transaction_amount = VALUES(transaction_amount)
  `, [plan.code, accountId, remote.id, desired.auto_recurring.transaction_amount]);

  return { code: plan.code, mp_plan_id: remote.id, amount: desired.auto_recurring.transaction_amount, action };
}

async function checkForeignSubscriptions(accountId, closeThem) {
  const [rows] = await getDb().query(`
    SELECT COUNT(*) AS n FROM subscriptions
    WHERE status IN ('pending','authorized','paused')
      AND mp_collector_id IS NOT NULL AND mp_collector_id <> ?
  `, [accountId]);
  const n = Number(rows[0]?.n ?? 0);
  if (!n) return;

  if (closeThem) {
    await getDb().query(`
      UPDATE subscriptions
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP()),
          paid_until = LEAST(COALESCE(paid_until, UTC_TIMESTAMP()), UTC_TIMESTAMP())
      WHERE status IN ('pending','authorized','paused')
        AND mp_collector_id IS NOT NULL AND mp_collector_id <> ?
    `, [accountId]);
    console.log(`🧹 ${n} assinatura(s) de outra conta do Mercado Pago marcada(s) como cancelada(s) no banco.`);
  } else {
    console.warn(
      `⚠️  Há ${n} assinatura(s) aberta(s) no banco que pertencem a OUTRA conta do Mercado Pago ` +
      "(provavelmente testes feitos com outras credenciais). Elas continuam dando acesso premium.\n" +
      "   Para encerrá-las: npm run mp:sync-plans -- --encerrar-assinaturas-de-outra-conta"
    );
  }
}

async function main() {
  if (!mpConfig.isConfigured) {
    console.error("❌ Defina MP_ACCESS_TOKEN e MP_PUBLIC_KEY (no .env ou no ambiente) antes de rodar. Veja docs/ASSINATURAS.md.");
    process.exitCode = 1;
    return;
  }
  if (!mpConfig.baseUrl) {
    console.error("❌ Defina APP_BASE_URL (ou APP_URL): ela é usada na back_url dos planos.");
    process.exitCode = 1;
    return;
  }

  await getDb().ready; // garante que a tabela mp_plans já foi criada pelas migrações

  const account = await mp.getAccount();
  console.log(`🔑 Conta do Mercado Pago: ${account.id}${account.isTestUser ? " (usuário de teste)" : ""}${mpConfig.looksLikeTestCredential ? " — credenciais TEST-" : ""}`);
  if (account.siteId && account.siteId !== "MLB") {
    console.warn(`⚠️  A conta é do site ${account.siteId}, não do Brasil (MLB): planos em BRL podem ser recusados.`);
  }
  console.log(`↩️  back_url dos planos: ${mpConfig.backUrl}`);

  const results = [];
  for (const plan of paidPlans()) {
    try {
      results.push(await syncPlan(plan, account.id));
    } catch (err) {
      const hint = /back_url/i.test(err?.message ?? "")
        ? " — o Mercado Pago pode recusar back_url local: use em APP_BASE_URL uma URL pública (ex.: a do Render ou um túnel como ngrok)."
        : "";
      console.error(`❌ ${plan.code}: ${mp.describeError(err)}${hint}`);
      process.exitCode = 1;
    }
  }

  for (const r of results) {
    console.log(`✅ ${r.code.padEnd(16)} R$ ${r.amount.toFixed(2).padStart(6)}  ${r.mp_plan_id}  — ${r.action}`);
  }

  await checkForeignSubscriptions(account.id, process.argv.includes("--encerrar-assinaturas-de-outra-conta"));
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error("❌ Erro ao sincronizar planos:", mp.describeError(err));
      process.exitCode = 1;
    })
    .finally(() => { if (dbLoaded) getDb().end().catch(() => {}); });
}

module.exports = { desiredPlanBody, needsUpdate, syncPlan, main };
