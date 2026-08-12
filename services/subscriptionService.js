// ============================================
// services/subscriptionService.js
// Única fonte de verdade sobre "quem pode o quê" — controllers
// nunca leem user_subscriptions direto, sempre passam por aqui.
// ============================================
const db = require("../database/db");
const { DEFAULT_PLAN_BY_TYPE, getPlan } = require("../config/plans");

async function getUserPlanCode(userId, type) {
  const [rows] = await db.query(
    "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'",
    [userId]
  );
  return rows[0]?.plan_code ?? DEFAULT_PLAN_BY_TYPE[type];
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

  const [rows] = await db.query(
    "SELECT user_id, plan_code FROM user_subscriptions WHERE user_id IN (?) AND status = 'active'",
    [userIds]
  );
  for (const r of rows) map[r.user_id] = r.plan_code;
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

/** Define o plano do usuário manualmente — usado pelo admin até o checkout real existir. */
async function setUserPlan(userId, planCode) {
  if (!getPlan(planCode)) throw new Error("Plano inválido.");
  await db.query(`
    INSERT INTO user_subscriptions (user_id, plan_code, status)
    VALUES (?, ?, 'active')
    ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code), status = 'active'
  `, [userId, planCode]);
}

module.exports = {
  getUserPlan, getUserPlanCode, getPlanCodesBulk,
  hasFeature, canCreateJob, setUserPlan,
};
