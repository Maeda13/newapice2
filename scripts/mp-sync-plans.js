// ============================================
// scripts/mp-sync-plans.js — npm run mp:sync-plans
//
// Cria/atualiza no Mercado Pago (preapproval_plan) os planos pagos de
// config/plans.js e salva o mp_plan_id de cada um na tabela mp_plans, por
// conta do Mercado Pago (teste e produção ficam separados). A lógica está
// em services/mpPlanSync.js — o servidor também roda essa sincronização ao
// iniciar, então este comando serve para rodar à mão e ver o resultado.
//
// Idempotente: rodar de novo não duplica planos.
//
// Opção: --encerrar-assinaturas-de-outra-conta
//   Marca como canceladas (só no banco) as assinaturas abertas que
//   pertencem a OUTRA conta do Mercado Pago — tipicamente as de teste,
//   quando o mesmo banco foi usado com credenciais de teste e de produção.
// ============================================
require("dotenv").config();
const mpConfig = require("../config/mercadopago");

// Carregados só depois de validar as credenciais: abrir o pool já dispara
// as migrações automáticas (database/db.js).
let dbLoaded = false;
function getDb() {
  dbLoaded = true;
  return require("../database/db");
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
  const { syncAllPlans } = require("../services/mpPlanSync");

  const { account, results, errors } = await syncAllPlans();
  console.log(`🔑 Conta do Mercado Pago: ${account.id}${account.isTestUser ? " (usuário de teste)" : ""}${mpConfig.looksLikeTestCredential ? " — credenciais TEST-" : ""}`);
  if (account.siteId && account.siteId !== "MLB") {
    console.warn(`⚠️  A conta é do site ${account.siteId}, não do Brasil (MLB): planos em BRL podem ser recusados.`);
  }
  console.log(`↩️  back_url dos planos: ${mpConfig.backUrl}` +
    (mpConfig.backUrlIsLocal ? " (o site está em localhost, que o MP não aceita como back_url; isso não afeta o checkout do Ápice)" : ""));

  for (const r of results) {
    console.log(`✅ ${r.code.padEnd(16)} R$ ${r.amount.toFixed(2).padStart(6)}  ${r.mp_plan_id}  — ${r.action}`);
  }
  for (const e of errors) {
    console.error(`❌ ${e.code}: ${e.message}`);
  }
  if (errors.length) process.exitCode = 1;

  await checkForeignSubscriptions(account.id, process.argv.includes("--encerrar-assinaturas-de-outra-conta"));
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error("❌ Erro ao sincronizar planos:", require("../services/mercadoPago").describeError(err));
      process.exitCode = 1;
    })
    .finally(() => { if (dbLoaded) getDb().end().catch(() => {}); });
}
