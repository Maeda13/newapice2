// Banco em memória que entende as queries de services/mpSubscriptions.js e
// services/subscriptionService.js — o suficiente para testar a lógica de
// assinatura sem MySQL. Query não reconhecida lança erro (para nenhuma
// query nova passar sem teste).
// Com SQL_DUMP_FILE definido, grava cada query distinta (com parâmetros de
// exemplo) para ser validada com EXPLAIN contra o schema real do MySQL.
const fs = require("fs");
function recordQuery(sql, params) {
  const file = process.env.SQL_DUMP_FILE;
  if (!file) return;
  fs.appendFileSync(file, JSON.stringify({ sql, params }) + "\n");
}

function createFakeDb() {
  const state = {
    users: [],
    manualPlans: [],      // user_subscriptions
    subscriptions: [],
    payments: [],
    mpPlans: [],
    nextSubId: 1,
    nextPayId: 1,
    clock: Date.parse("2026-10-16T12:00:00Z"),
    locks: new Set(),
  };

  const norm = sql => sql.replace(/\s+/g, " ").trim();
  const toMs = utc => (utc ? Date.parse(utc.replace(" ", "T") + "Z") : null);
  const iso = utc => (utc ? utc.replace(" ", "T") + "Z" : null);
  // Espelha MP_ACCESS_CONDITION (services/subscriptionService.js), com a
  // carência de 10 dias quando a última cobrança foi recusada.
  const GRACE_MS = 10 * 24 * 3600 * 1000;
  const hasAccess = s =>
    (s.status === "authorized" &&
      (s.payment_issue == null || (toMs(s.paid_until) ?? s.created_at) > state.clock - GRACE_MS)) ||
    (["paused", "cancelled"].includes(s.status) && s.paid_until != null && toMs(s.paid_until) > state.clock);

  function project(s) {
    return {
      id: s.id, user_id: s.user_id, plan_id: s.plan_id, mp_preapproval_id: s.mp_preapproval_id,
      mp_collector_id: s.mp_collector_id, status: s.status, payment_issue: s.payment_issue,
      next_payment_date: iso(s.next_payment_date), paid_until: iso(s.paid_until), cancelled_at: iso(s.cancelled_at),
      created_ts: Math.floor(s.created_at / 1000), has_access: hasAccess(s) ? 1 : 0,
    };
  }

  const byCreatedDesc = (a, b) => b.created_at - a.created_at || b.id - a.id;
  function currentRank(s) {
    if (s.status === "authorized") return 0;
    if (s.status === "paused") return 1;
    if (s.status === "pending") return 2;
    if (hasAccess(s)) return 3;
    return 4;
  }

  function addMonth(utc) {
    const d = new Date(toMs(utc));
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  async function query(sqlRaw, params = []) {
    const sql = norm(sqlRaw);
    recordQuery(sql, params);

    // ── subscriptionService ──
    if (sql.startsWith("SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active' UNION ALL")) {
      const [userId] = params;
      const manual = state.manualPlans.filter(m => m.user_id === userId && m.status === "active").map(m => ({ plan_code: m.plan_code }));
      const paid = state.subscriptions.filter(s => s.user_id === userId && hasAccess(s)).map(s => ({ plan_code: s.plan_id }));
      return [[...manual, ...paid]];
    }
    if (sql === "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'") {
      const [userId] = params;
      return [state.manualPlans.filter(m => m.user_id === userId && m.status === "active").map(m => ({ plan_code: m.plan_code }))];
    }
    if (sql.startsWith("SELECT user_id, plan_code FROM user_subscriptions WHERE user_id IN (?) AND status = 'active' UNION ALL")) {
      const [ids] = params;
      const manual = state.manualPlans.filter(m => ids.includes(m.user_id) && m.status === "active").map(m => ({ user_id: m.user_id, plan_code: m.plan_code }));
      const paid = state.subscriptions.filter(s => ids.includes(s.user_id) && hasAccess(s)).map(s => ({ user_id: s.user_id, plan_code: s.plan_id }));
      return [[...manual, ...paid]];
    }

    // ── users / mp_plans ──
    if (sql === "SELECT id, type FROM users WHERE id = ?") {
      const u = state.users.find(x => x.id === params[0]);
      return [u ? [{ id: u.id, type: u.type }] : []];
    }
    if (sql === "SELECT email FROM users WHERE id = ?") {
      const u = state.users.find(x => x.id === params[0]);
      return [u ? [{ email: u.email }] : []];
    }
    if (sql === "SELECT mp_plan_id, transaction_amount FROM mp_plans WHERE plan_code = ? AND mp_account_id = ?") {
      const row = state.mpPlans.find(p => p.plan_code === params[0] && p.mp_account_id === params[1]);
      return [row ? [{ mp_plan_id: row.mp_plan_id, transaction_amount: row.transaction_amount.toFixed(2) }] : []];
    }

    // ── subscriptions: leituras ──
    if (/FROM subscriptions WHERE mp_preapproval_id = \?$/.test(sql)) {
      return [state.subscriptions.filter(s => s.mp_preapproval_id === params[0]).map(project)];
    }
    if (/FROM subscriptions WHERE id = \?$/.test(sql)) {
      return [state.subscriptions.filter(s => s.id === params[0]).map(project)];
    }
    if (/FROM subscriptions WHERE user_id = \? ORDER BY CASE/.test(sql)) {
      const rows = state.subscriptions.filter(s => s.user_id === params[0])
        .sort((a, b) => currentRank(a) - currentRank(b) || byCreatedDesc(a, b));
      return [rows.slice(0, 1).map(project)];
    }
    if (/FROM subscriptions WHERE user_id = \? AND status IN \('pending','authorized','paused'\) ORDER BY created_at DESC, id DESC$/.test(sql)) {
      return [state.subscriptions.filter(s => s.user_id === params[0] && ["pending", "authorized", "paused"].includes(s.status))
        .sort(byCreatedDesc).map(project)];
    }
    if (/FROM subscriptions WHERE user_id = \? AND \(status IN \('pending','authorized','paused'\) OR updated_at >/.test(sql)) {
      const twoDays = 2 * 24 * 3600 * 1000;
      return [state.subscriptions.filter(s => s.user_id === params[0] &&
        (["pending", "authorized", "paused"].includes(s.status) || s.updated_at > state.clock - twoDays))
        .sort(byCreatedDesc).slice(0, 3).map(project)];
    }

    // ── subscriptions: escritas ──
    if (sql.startsWith("INSERT INTO subscriptions")) {
      const [userId, planId, preId, collectorId, status, nextPaymentDate, cancelledAt] = params;
      const existing = state.subscriptions.find(s => s.mp_preapproval_id === preId);
      if (existing) {
        existing.status = status;
        existing.next_payment_date = nextPaymentDate;
        existing.mp_collector_id = collectorId ?? existing.mp_collector_id;
        existing.cancelled_at = status === "cancelled" ? (existing.cancelled_at ?? cancelledAt) : null;
        existing.updated_at = state.clock;
      } else {
        state.subscriptions.push({
          id: state.nextSubId++, user_id: userId, plan_id: planId, mp_preapproval_id: preId,
          mp_collector_id: collectorId, status, next_payment_date: nextPaymentDate, paid_until: null,
          payment_issue: null, cancelled_at: cancelledAt, created_at: state.clock + state.nextSubId, updated_at: state.clock,
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql === "UPDATE subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?") {
      const s = state.subscriptions.find(x => x.id === params[1]);
      if (s) { s.status = "cancelled"; s.cancelled_at = s.cancelled_at ?? params[0]; s.updated_at = state.clock; }
      return [{ affectedRows: s ? 1 : 0 }];
    }
    if (sql.startsWith("UPDATE subscriptions s SET paid_until = (")) {
      const s = state.subscriptions.find(x => x.id === params[0]);
      const pays = state.payments.filter(p => p.subscription_id === s.id);
      const approved = pays.filter(p => p.status === "approved" && p.paid_at).map(p => p.paid_at).sort();
      s.paid_until = approved.length ? addMonth(approved[approved.length - 1]) : null;
      const latest = [...pays].sort((a, b) => toMs(b.created_at) - toMs(a.created_at) || b.id - a.id)[0];
      s.payment_issue = latest && latest.status === "rejected" ? (latest.status_detail ?? "cc_rejected_other_reason") : null;
      return [{ affectedRows: 1 }];
    }

    // ── subscription_payments ──
    if (sql.startsWith("INSERT INTO subscription_payments")) {
      const [subId, payId, status, statusDetail, amount, paidAt, createdAt] = params;
      const existing = state.payments.find(p => p.mp_payment_id === payId);
      if (existing) Object.assign(existing, { status, status_detail: statusDetail, amount, paid_at: paidAt });
      else state.payments.push({ id: state.nextPayId++, subscription_id: subId, mp_payment_id: payId, status, status_detail: statusDetail, amount, paid_at: paidAt, created_at: createdAt });
      return [{ affectedRows: 1 }];
    }
    if (sql === "SELECT mp_payment_id, status FROM subscription_payments WHERE subscription_id = ?") {
      return [state.payments.filter(p => p.subscription_id === params[0]).map(p => ({ mp_payment_id: p.mp_payment_id, status: p.status }))];
    }
    if (sql.startsWith("SELECT p.mp_payment_id, p.status, p.status_detail, p.amount, s.plan_id")) {
      const [userId, limit] = params;
      const subIds = new Set(state.subscriptions.filter(s => s.user_id === userId).map(s => s.id));
      const rows = state.payments.filter(p => subIds.has(p.subscription_id))
        .sort((a, b) => toMs(b.created_at) - toMs(a.created_at) || b.id - a.id)
        .slice(0, limit)
        .map(p => ({
          mp_payment_id: p.mp_payment_id, status: p.status, status_detail: p.status_detail,
          amount: p.amount != null ? Number(p.amount).toFixed(2) : null,
          plan_id: state.subscriptions.find(s => s.id === p.subscription_id).plan_id,
          paid_at: iso(p.paid_at), created_at: iso(p.created_at),
        }));
      return [rows];
    }

    throw new Error(`fakeDb: query não suportada: ${sql.slice(0, 160)}`);
  }

  async function getConnection() {
    return {
      async query(sqlRaw, params = []) {
        const sql = norm(sqlRaw);
        if (sql === "SELECT GET_LOCK(?, 15) AS got") {
          if (state.locks.has(params[0])) return [[{ got: 0 }]];
          state.locks.add(params[0]);
          return [[{ got: 1 }]];
        }
        if (sql === "SELECT RELEASE_LOCK(?)") { state.locks.delete(params[0]); return [[{}]]; }
        return query(sqlRaw, params);
      },
      release() {},
    };
  }

  return { query, getConnection, state };
}

module.exports = { createFakeDb };
