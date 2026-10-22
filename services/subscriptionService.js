// ============================================
// services/subscriptionService.js
// Única fonte de verdade sobre "quem pode o quê" — controllers
// nunca leem user_subscriptions/subscriptions direto, sempre passam por aqui.
//
// O plano efetivo do usuário é o MELHOR (mais caro) entre:
//   1. a assinatura paga no Mercado Pago (tabela subscriptions), que dá
//      acesso enquanto status = 'authorized' — e, se cancelada/pausada,
//      até o fim do período já pago (paid_until). Com a última cobrança
//      recusada (payment_issue), o acesso continua só durante a janela de
//      novas tentativas do MP (PAYMENT_GRACE_DAYS após o fim do período
//      pago): sem isso, uma assinatura que o MP não cancela sozinho daria
//      premium para sempre sem pagamento;
//   2. o plano "manual" definido pelo admin (tabela user_subscriptions);
//   3. o plano gratuito do tipo de conta, se nenhum dos dois existir.
// "Melhor plano vale" também resolve a troca de plano: quem desce de
// Premium para Básico continua Premium até o fim do período já pago.
// ============================================
const db = require("../database/db");
const { DEFAULT_PLAN_BY_TYPE, getPlan, isPaidPlan } = require("../config/plans");

// O Mercado Pago faz até 4 novas tentativas em ~10 dias após uma recusa.
const PAYMENT_GRACE_DAYS = 10;

// paid_until é gravado em UTC — por isso UTC_TIMESTAMP() e não NOW().
const MP_ACCESS_CONDITION = `(
  (status = 'authorized' AND (payment_issue IS NULL
     OR COALESCE(paid_until, created_at) > (UTC_TIMESTAMP() - INTERVAL ${PAYMENT_GRACE_DAYS} DAY)))
  OR (status IN ('paused','cancelled') AND paid_until > UTC_TIMESTAMP())
)`;

function bestPlanCode(codes, type) {
  let best = null;
  for (const code of codes) {
    const plan = getPlan(code);
    if (!plan || plan.type !== type) continue;
    if (!best || plan.price_cents > best.price_cents) best = plan;
  }
  return best?.code ?? DEFAULT_PLAN_BY_TYPE[type];
}

async function getUserPlanCode(userId, type) {
  const [rows] = await db.query(`
    SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
    UNION ALL
    SELECT plan_id FROM subscriptions WHERE user_id = ? AND ${MP_ACCESS_CONDITION}
  `, [userId, userId]);
  return bestPlanCode(rows.map(r => r.plan_code), type);
}

async function getUserPlan(userId, type) {
  const code = await getUserPlanCode(userId, type);
  return getPlan(code) ?? getPlan(DEFAULT_PLAN_BY_TYPE[type]);
}

/** Versão em lote de getUserPlanCode, para listas (evita N+1). */
async function getPlanCodesBulk(userIds, type) {
  const map = {};
  for (const id of userIds) map[id] = DEFAULT_PLAN_BY_TYPE[type];
  if (!userIds.length) return map;

  const [rows] = await db.query(`
    SELECT user_id, plan_code FROM user_subscriptions WHERE user_id IN (?) AND status = 'active'
    UNION ALL
    SELECT user_id, plan_id FROM subscriptions WHERE user_id IN (?) AND ${MP_ACCESS_CONDITION}
  `, [userIds, userIds]);

  const codesByUser = {};
  for (const r of rows) (codesByUser[r.user_id] ??= []).push(r.plan_code);
  for (const [userId, codes] of Object.entries(codesByUser)) map[userId] = bestPlanCode(codes, type);
  return map;
}

async function hasFeature(userId, featureKey) {
  const plan = await getUserPlan(userId, "dev");
  return Boolean(plan?.features?.[featureKey]);
}

async function canCreateJob(companyId) {
  const plan = await getUserPlan(companyId, "empresa");
  if (plan.max_active_jobs == null) return true; // ilimitado

  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM jobs WHERE company_id = ? AND active = 1",
    [companyId]
  );
  return total < plan.max_active_jobs;
}

/**
 * Define o plano "manual" do usuário — usado só pelo admin (Admin →
 * Usuários / Empresas). Não mexe na assinatura paga:
 * se o usuário paga um plano melhor, é ele que continua valendo.
 */
async function setUserPlan(userId, planCode) {
  if (!getPlan(planCode)) throw new Error("Plano inválido.");
  await db.query(`
    INSERT INTO user_subscriptions (user_id, plan_code, status)
    VALUES (?, ?, 'active')
    ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code), status = 'active'
  `, [userId, planCode]);
}

/**
 * Plano pago liberado pelo admin, sem cobrança — ou null se o plano manual
 * for o gratuito (ou não existir). A tela Minha assinatura usa isso para
 * explicar de onde vem o plano de quem não tem assinatura para cancelar.
 */
async function getManualPaidPlan(userId) {
  const [rows] = await db.query(
    "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'",
    [userId]
  );
  const plan = rows.length ? getPlan(rows[0].plan_code) : null;
  return isPaidPlan(plan) ? plan : null;
}

module.exports = {
  getUserPlan, getUserPlanCode, getPlanCodesBulk,
  hasFeature, canCreateJob, setUserPlan, getManualPaidPlan,
  MP_ACCESS_CONDITION, PAYMENT_GRACE_DAYS,
};
