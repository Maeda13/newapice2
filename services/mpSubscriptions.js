// ============================================
// services/mpSubscriptions.js
// Ciclo de vida da assinatura recorrente no Mercado Pago (preapproval):
// criar, cancelar, trocar cartão, trocar de plano e manter as tabelas
// subscriptions / subscription_payments em dia — tanto pelo webhook
// quanto por reconciliação sob demanda (GET /api/assinaturas/minha).
//
// Regras:
//   - preço e plano vêm SEMPRE de config/plans.js pelo código do plano;
//   - dados de status vêm SEMPRE da API do Mercado Pago, nunca do corpo
//     do webhook nem do front;
//   - toda escrita é upsert por ID do Mercado Pago (idempotente).
//
// Datas DATETIME são gravadas em UTC ("YYYY-MM-DD HH:MM:SS") e lidas com
// DATE_FORMAT(...'Z'): o servidor pode rodar em fusos diferentes (Render em
// UTC, máquina local em horário de Brasília) e o valor gravado não pode
// depender disso.
// ============================================
const db       = require("../database/db");
const mp       = require("./mercadoPago");
const mpConfig = require("../config/mercadopago");
const { getPlan, isPaidPlan } = require("../config/plans");
const { MP_ACCESS_CONDITION, PAYMENT_GRACE_DAYS, getManualPaidPlan } = require("./subscriptionService");
const { classifyMpError, reasonMessage, subscriptionStatusLabel, paymentStatusLabel } = require("./mpMessages");

class SubscriptionError extends Error {
  constructor(httpStatus, message, extra = {}) {
    super(message);
    this.name = "SubscriptionError";
    this.httpStatus = httpStatus;
    Object.assign(this, extra);
  }
}

const OPEN_STATUSES = ["pending", "authorized", "paused"]; // ainda não cancelada no MP
const LIVE_STATUSES = ["authorized", "paused"];            // cobrando (ou pausada)

// ── Datas ─────────────────────────────────────────────────
function toUtcDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

const SUBSCRIPTION_COLUMNS = `
  id, user_id, plan_id, mp_preapproval_id, mp_collector_id, status, payment_issue,
  DATE_FORMAT(next_payment_date, '%Y-%m-%dT%H:%i:%sZ') AS next_payment_date,
  DATE_FORMAT(paid_until,        '%Y-%m-%dT%H:%i:%sZ') AS paid_until,
  DATE_FORMAT(cancelled_at,      '%Y-%m-%dT%H:%i:%sZ') AS cancelled_at,
  UNIX_TIMESTAMP(created_at) AS created_ts,
  ${MP_ACCESS_CONDITION} AS has_access
`;

// Ordem de "qual assinatura mostrar": ativa > pausada > pendente >
// cancelada que ainda dá acesso > cancelada.
const CURRENT_ORDER = `
  CASE
    WHEN status = 'authorized' THEN 0
    WHEN status = 'paused'     THEN 1
    WHEN status = 'pending'    THEN 2
    WHEN ${MP_ACCESS_CONDITION} THEN 3
    ELSE 4
  END, created_at DESC, id DESC
`;

// ── Status do Mercado Pago → ENUM da tabela ───────────────
function normalizeStatus(mpStatus) {
  if (mpStatus === "canceled") return "cancelled";
  if (OPEN_STATUSES.includes(mpStatus) || mpStatus === "cancelled") return mpStatus;
  // Qualquer outro status (ex.: "finished") significa que o MP não cobra
  // mais — tratamos como cancelada, mantendo o acesso até paid_until.
  console.warn(`[assinaturas] Status de assinatura desconhecido do Mercado Pago: "${mpStatus}" — tratado como cancelada.`);
  return "cancelled";
}

// external_reference = "userId:planCode" (definido por nós na criação)
function parseExternalReference(ref) {
  const match = /^(\d+):([a-z_]+)$/.exec(String(ref ?? ""));
  return match ? { userId: Number(match[1]), planCode: match[2] } : null;
}

// ── Consultas ─────────────────────────────────────────────
async function findByPreapprovalId(preapprovalId) {
  const [rows] = await db.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE mp_preapproval_id = ?`,
    [String(preapprovalId)]
  );
  return rows[0] ?? null;
}

async function findById(id) {
  const [rows] = await db.query(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

async function findCurrent(userId) {
  const [rows] = await db.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? ORDER BY ${CURRENT_ORDER} LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Assinatura "viva" (autorizada ou pausada) do usuário, se houver. */
async function findLive(userId) {
  const current = await findCurrent(userId);
  return current && LIVE_STATUSES.includes(current.status) ? current : null;
}

async function listPayments(userId, limit = 24) {
  const [rows] = await db.query(`
    SELECT p.mp_payment_id, p.status, p.status_detail, p.amount, s.plan_id,
           DATE_FORMAT(p.paid_at,    '%Y-%m-%dT%H:%i:%sZ') AS paid_at,
           DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at
    FROM subscription_payments p
    JOIN subscriptions s ON s.id = p.subscription_id
    WHERE s.user_id = ?
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
  `, [userId, limit]);
  return rows;
}

// ── mp_plan_id por conta do Mercado Pago ──────────────────
/**
 * mp_plan_id do plano para a conta atual — só se o valor sincronizado
 * bater com o de config/plans.js (o valor cobrado é o do plano no MP;
 * se o preço mudou aqui e o sync não rodou, não vendemos por outro valor).
 */
async function getMpPlanId(planCode) {
  const account = await mp.getAccount();
  const [rows] = await db.query(
    "SELECT mp_plan_id, transaction_amount FROM mp_plans WHERE plan_code = ? AND mp_account_id = ?",
    [planCode, account.id]
  );
  const row = rows[0];
  const plan = getPlan(planCode);
  if (!row || !plan) return null;
  if (Math.round(Number(row.transaction_amount) * 100) !== plan.price_cents) return null;
  return row.mp_plan_id;
}

const warnedUnsyncedPlans = new Set();

/**
 * O checkout deste plano pode ser exibido? Usado pelas páginas antes de
 * montar o Brick, para não pedir o cartão de algo que vai falhar.
 */
async function checkoutAvailability(planCode) {
  if (!mpConfig.isConfigured) return { available: false, reason: "not_configured" };
  try {
    const mpPlanId = await getMpPlanId(planCode);
    if (!mpPlanId) {
      if (!warnedUnsyncedPlans.has(planCode)) {
        warnedUnsyncedPlans.add(planCode);
        console.warn(`[assinaturas] Plano "${planCode}" sem mp_plan_id (ou com valor desatualizado) para a conta atual do Mercado Pago — veja a linha [mercadopago] da subida do servidor ou rode "npm run mp:sync-plans".`);
      }
      return { available: false, reason: "plan_not_synced" };
    }
    return { available: true };
  } catch (err) {
    console.error("[assinaturas] Não foi possível consultar a conta do Mercado Pago:", mp.describeError(err));
    return { available: false, reason: "mp_unreachable" };
  }
}

// ── Escritas idempotentes ─────────────────────────────────
/**
 * Grava/atualiza a assinatura a partir da preapproval buscada na API.
 * Dono e plano vêm do que já está no banco ou, para uma preapproval que
 * ainda não conhecemos, do external_reference "userId:planCode" que nós
 * mesmos definimos na criação.
 */
async function upsertFromPreapproval(preapproval, hint = {}) {
  if (!preapproval?.id) return null;
  const existing = await findByPreapprovalId(preapproval.id);

  let userId   = existing?.user_id ?? hint.userId ?? null;
  let planCode = existing?.plan_id ?? hint.planCode ?? null;

  if (!userId || !planCode) {
    const ref = parseExternalReference(preapproval.external_reference);
    if (!ref) return null; // não foi criada por este sistema
    const [[owner]] = await db.query("SELECT id, type FROM users WHERE id = ?", [ref.userId]);
    const plan = getPlan(ref.planCode);
    if (!owner || !plan || plan.type !== owner.type) {
      console.warn(`[assinaturas] Preapproval ${preapproval.id} com external_reference inválido ("${preapproval.external_reference}") — ignorada.`);
      return null;
    }
    userId   = ref.userId;
    planCode = ref.planCode;
  }

  const status = normalizeStatus(preapproval.status);
  await db.query(`
    INSERT INTO subscriptions
      (user_id, plan_id, mp_preapproval_id, mp_collector_id, status, next_payment_date, cancelled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status            = VALUES(status),
      next_payment_date = VALUES(next_payment_date),
      mp_collector_id   = COALESCE(VALUES(mp_collector_id), mp_collector_id),
      cancelled_at      = IF(VALUES(status) = 'cancelled', COALESCE(cancelled_at, VALUES(cancelled_at)), NULL)
  `, [
    userId,
    planCode,
    String(preapproval.id),
    preapproval.collector_id ?? null,
    status,
    toUtcDateTime(preapproval.next_payment_date),
    status === "cancelled" ? toUtcDateTime(preapproval.last_modified ?? new Date()) : null,
  ]);

  return findByPreapprovalId(preapproval.id);
}

async function upsertPayment(subscriptionId, payment) {
  await db.query(`
    INSERT INTO subscription_payments
      (subscription_id, mp_payment_id, status, status_detail, amount, paid_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status        = VALUES(status),
      status_detail = VALUES(status_detail),
      amount        = VALUES(amount),
      paid_at       = VALUES(paid_at)
  `, [
    subscriptionId,
    String(payment.id),
    payment.status ?? "unknown",
    payment.status_detail ?? null,
    payment.transaction_amount ?? null,
    payment.status === "approved" ? toUtcDateTime(payment.date_approved ?? payment.date_created) : null,
    toUtcDateTime(payment.date_created) ?? toUtcDateTime(new Date()),
  ]);
}

/**
 * Recalcula, a partir dos pagamentos gravados, o fim do período pago
 * (último pagamento aprovado + 1 mês) e o "problema de cobrança" (a
 * tentativa mais recente foi recusada). Independe da ordem em que os
 * webhooks chegam.
 */
async function recomputeDerived(subscriptionId) {
  await db.query(`
    UPDATE subscriptions s
    SET paid_until = (
          SELECT DATE_ADD(MAX(p.paid_at), INTERVAL 1 MONTH)
          FROM subscription_payments p
          WHERE p.subscription_id = s.id AND p.status = 'approved'
        ),
        payment_issue = (
          SELECT IF(p.status = 'rejected', COALESCE(p.status_detail, 'cc_rejected_other_reason'), NULL)
          FROM subscription_payments p
          WHERE p.subscription_id = s.id
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 1
        )
    WHERE s.id = ?
  `, [subscriptionId]);
}

// ── Sincronização a partir da API do Mercado Pago ────────
async function syncPreapproval(preapprovalId, hint) {
  const preapproval = await mp.getPreapproval(preapprovalId);
  return upsertFromPreapproval(preapproval, hint);
}

/** ID da assinatura a que um pagamento pertence (pagamentos gerados por preapproval). */
function preapprovalIdFromPayment(payment) {
  return payment?.point_of_interaction?.transaction_data?.subscription_id
      ?? payment?.metadata?.preapproval_id
      ?? null;
}

async function syncPayment(paymentId, hint = {}) {
  const payment = await mp.getPayment(paymentId);
  const preapprovalId = hint.preapprovalId ?? preapprovalIdFromPayment(payment);
  if (!preapprovalId) return null; // pagamento avulso, não é de assinatura

  const subscription = (await findByPreapprovalId(preapprovalId)) ?? (await syncPreapproval(preapprovalId));
  if (!subscription) return null;

  await upsertPayment(subscription.id, payment);
  await recomputeDerived(subscription.id);
  return findById(subscription.id);
}

async function syncAuthorizedPayment(authorizedPaymentId) {
  const invoice = await mp.getAuthorizedPayment(authorizedPaymentId);
  if (!invoice?.preapproval_id) return null;

  // Atualiza status/próxima cobrança da assinatura e, se a fatura já
  // gerou um pagamento, o pagamento em si (com status_detail e data).
  const subscription = await syncPreapproval(invoice.preapproval_id);
  if (!subscription) return null;
  if (invoice.payment?.id) {
    return syncPayment(invoice.payment.id, { preapprovalId: invoice.preapproval_id });
  }
  return subscription;
}

/** Reconciliação completa de uma assinatura (status + todas as cobranças). */
async function reconcileSubscription(subscription) {
  const fresh = await syncPreapproval(subscription.mp_preapproval_id);
  if (!fresh) return null;

  const search = await mp.searchAuthorizedPayments({ preapproval_id: subscription.mp_preapproval_id, limit: 50 });
  const invoicesWithPayment = (search?.results ?? []).filter(inv => inv?.payment?.id);

  if (invoicesWithPayment.length) {
    const [stored] = await db.query(
      "SELECT mp_payment_id, status FROM subscription_payments WHERE subscription_id = ?",
      [fresh.id]
    );
    const storedStatus = new Map(stored.map(p => [String(p.mp_payment_id), p.status]));
    for (const inv of invoicesWithPayment) {
      // Só busca o pagamento completo quando é novo ou mudou de status.
      if (storedStatus.get(String(inv.payment.id)) === inv.payment.status) continue;
      await upsertPayment(fresh.id, await mp.getPayment(inv.payment.id));
    }
  }

  await recomputeDerived(fresh.id);
  return findById(fresh.id);
}

// ── Cancelamento no Mercado Pago ──────────────────────────
async function cancelAtMercadoPago(subscription) {
  try {
    await mp.updatePreapproval(subscription.mp_preapproval_id, { status: "cancelled" });
  } catch (err) {
    // Já cancelada do lado do MP (ex.: webhook ainda não chegou)? Então
    // só falta refletir aqui; qualquer outro erro sobe.
    const remote = await mp.getPreapproval(subscription.mp_preapproval_id).catch(() => null);
    if (!remote || normalizeStatus(remote.status) !== "cancelled") throw err;
  }
  await db.query(`
    UPDATE subscriptions
    SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?)
    WHERE id = ?
  `, [toUtcDateTime(new Date()), subscription.id]);
}

/**
 * Garante no máximo UMA assinatura aberta por usuário: se houver mais
 * (troca de plano cujo cancelamento falhou, corrida entre abas...), as
 * mais antigas são canceladas no Mercado Pago para não cobrar em dobro.
 */
async function enforceSingleOpen(userId) {
  const [rows] = await db.query(`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE user_id = ? AND status IN ('pending','authorized','paused')
    ORDER BY created_at DESC, id DESC
  `, [userId]);
  for (const extra of rows.slice(1)) {
    try {
      await cancelAtMercadoPago(extra);
      console.warn(`[assinaturas] Usuário ${userId} tinha mais de uma assinatura aberta — preapproval ${extra.mp_preapproval_id} cancelada.`);
    } catch (err) {
      console.error(`[assinaturas] Falha ao cancelar assinatura duplicada ${extra.mp_preapproval_id} do usuário ${userId}:`, mp.describeError(err));
    }
  }
}

// ── Reconciliação sob demanda (com limite de frequência) ──
const lastSyncByUser = new Map();
const SYNC_MIN_INTERVAL_MS = 10 * 1000;

async function syncUserSubscriptions(userId, { force = false } = {}) {
  if (!mpConfig.isConfigured) return;
  const now = Date.now();
  if (!force && now - (lastSyncByUser.get(userId) ?? 0) < SYNC_MIN_INTERVAL_MS) return;
  if (lastSyncByUser.size > 5000) lastSyncByUser.clear();
  lastSyncByUser.set(userId, now);

  const [rows] = await db.query(`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE user_id = ?
      AND (status IN ('pending','authorized','paused') OR updated_at > (NOW() - INTERVAL 2 DAY))
    ORDER BY created_at DESC, id DESC
    LIMIT 3
  `, [userId]);

  for (const row of rows) {
    try {
      await reconcileSubscription(row);
    } catch (err) {
      console.error(`[assinaturas] Falha ao sincronizar preapproval ${row.mp_preapproval_id}:`, mp.describeError(err));
    }
  }
  await enforceSingleOpen(userId);
}

// ── Formato público (API / páginas) ───────────────────────
function publicPlan(plan) {
  return plan && {
    code: plan.code, name: plan.name, type: plan.type,
    price_cents: plan.price_cents, benefits: plan.benefits ?? [],
  };
}

// Até quando o acesso continua se a cobrança seguir recusada (ver
// PAYMENT_GRACE_DAYS em subscriptionService).
function graceUntil(row) {
  const base = row.paid_until ? Date.parse(row.paid_until) : Number(row.created_ts) * 1000;
  return Number.isFinite(base) ? new Date(base + PAYMENT_GRACE_DAYS * 24 * 3600 * 1000).toISOString() : null;
}

function toPublicSubscription(row) {
  if (!row) return null;
  const plan = getPlan(row.plan_id);
  return {
    plan:              publicPlan(plan) ?? { code: row.plan_id, name: row.plan_id },
    status:            row.status,
    status_label:      subscriptionStatusLabel(row.status),
    has_access:        Boolean(row.has_access),
    next_payment_date: row.status === "authorized" ? row.next_payment_date : null,
    paid_until:        row.paid_until,
    cancelled_at:      row.cancelled_at,
    payment_issue:     row.status === "authorized" && row.payment_issue
      ? { code: row.payment_issue, message: reasonMessage(row.payment_issue), grace_until: graceUntil(row) }
      : null,
    created_at:        row.created_ts ? new Date(Number(row.created_ts) * 1000).toISOString() : null,
  };
}

function toPublicPayment(row) {
  const plan = getPlan(row.plan_id);
  return {
    id:            String(row.mp_payment_id),
    status:        row.status,
    status_label:  paymentStatusLabel(row.status),
    status_detail: row.status_detail,
    message:       row.status === "rejected" ? reasonMessage(row.status_detail) : null,
    amount:        row.amount != null ? Number(row.amount) : null,
    plan_name:     plan?.name ?? row.plan_id,
    paid_at:       row.paid_at,
    created_at:    row.created_at,
  };
}

async function getSummary(userId, { sync = false } = {}) {
  if (sync) {
    await syncUserSubscriptions(userId).catch(err => {
      console.error(`[assinaturas] Falha na sincronização do usuário ${userId}:`, mp.describeError(err));
    });
  }
  const current    = await findCurrent(userId);
  const payments   = current ? await listPayments(userId) : [];
  const manualPlan = await getManualPaidPlan(userId);
  return {
    configured:   mpConfig.isConfigured,
    subscription: toPublicSubscription(current),
    // Plano pago liberado pelo admin (sem cobrança): a tela explica de onde
    // vem o acesso quando não há assinatura para gerenciar ou cancelar.
    manual_plan:  publicPlan(manualPlan),
    payments:     payments.map(toPublicPayment),
  };
}

// ── Operações do usuário ──────────────────────────────────
function assertConfigured() {
  if (!mpConfig.isConfigured) {
    throw new SubscriptionError(503, "Assinaturas temporariamente indisponíveis. Tente novamente mais tarde.", { reason: "indisponivel" });
  }
}

function assertPlanForUser(planCode, user) {
  const plan = getPlan(planCode);
  if (!plan || !isPaidPlan(plan)) throw new SubscriptionError(400, "Plano inválido.");
  if (plan.type !== user.type) throw new SubscriptionError(403, "Este plano não está disponível para o seu tipo de conta.");
  return plan;
}

function assertCardToken(cardTokenId) {
  // Token gerado pelo Brick: alfanumérico. Nunca recebemos dados do cartão em si.
  if (typeof cardTokenId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(cardTokenId)) {
    throw new SubscriptionError(400, "Dados do cartão inválidos. Preencha o cartão novamente.", { reason: "token_invalido" });
  }
}

async function getPayerEmail(userId) {
  // Só em teste: o pagador precisa ser um usuário de teste do Mercado
  // Pago, então permite forçar o e-mail sem criar outra conta no Ápice.
  const testEmail = (process.env.MP_TEST_PAYER_EMAIL || "").trim();
  if (testEmail && process.env.NODE_ENV !== "production") return testEmail;

  const [[row]] = await db.query("SELECT email FROM users WHERE id = ?", [userId]);
  if (!row?.email) throw new SubscriptionError(400, "Sua conta não tem e-mail cadastrado.");
  return row.email;
}

// Lock por usuário (MySQL GET_LOCK): duas abas/cliques simultâneos não
// podem criar duas assinaturas. Funciona entre instâncias do servidor.
// O nome do lock vale para o servidor MySQL inteiro (não só para o banco),
// por isso leva o nome do banco; limite do MySQL: 64 caracteres.
async function withUserLock(userId, fn) {
  const lockName = `apice_assinatura_${String(process.env.DB_NAME || "").slice(0, 32)}_${userId}`;
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query("SELECT GET_LOCK(?, 15) AS got", [lockName]);
    if (!row || Number(row.got) !== 1) {
      throw new SubscriptionError(409, "Já existe uma operação de assinatura em andamento. Aguarde alguns segundos e tente de novo.");
    }
    return await fn();
  } finally {
    await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    conn.release();
  }
}

function logMpFailure(action, userId, err) {
  const { configProblem } = classifyMpError(err);
  const hint = configProblem
    ? " — verifique as credenciais: com credenciais de uma conta de TESTE, só usuários de teste do Mercado Pago" +
      " conseguem assinar; para cobrar de verdade, use as credenciais de produção da conta real (docs/ASSINATURAS.md)."
    : "";
  console.error(`[assinaturas] ${action} (usuário ${userId}) falhou: ${mp.describeError(err)}${hint}`);
}

/** Cria a preapproval no MP; em timeout/5xx procura a recém-criada antes de desistir. */
async function createPreapprovalSafely({ userId, plan, cardTokenId }) {
  const mpPlanId = await getMpPlanId(plan.code);
  if (!mpPlanId) {
    console.error(`[assinaturas] Plano "${plan.code}" sem mp_plan_id (ou com valor desatualizado) para a conta atual — veja a linha [mercadopago] da subida do servidor ou rode "npm run mp:sync-plans".`);
    throw new SubscriptionError(503, "Assinaturas temporariamente indisponíveis. Tente novamente mais tarde.", { reason: "indisponivel" });
  }

  const payerEmail = await getPayerEmail(userId);
  const externalReference = `${userId}:${plan.code}`;
  const startedAt = Date.now();

  try {
    return await mp.createPreapproval({
      preapproval_plan_id: mpPlanId,
      payer_email:         payerEmail,
      card_token_id:       cardTokenId,
      external_reference:  externalReference,
      status:              "authorized",
    });
  } catch (err) {
    if (mp.isAmbiguousError(err)) {
      const found = await findRecentPreapproval({ payerEmail, mpPlanId, externalReference, since: startedAt - 60 * 1000 });
      if (found) return found;
    }
    logMpFailure(`Criação da assinatura do plano ${plan.code}`, userId, err);
    const { reason, message, httpStatus } = classifyMpError(err);
    throw new SubscriptionError(httpStatus, message, { reason });
  }
}

async function findRecentPreapproval({ payerEmail, mpPlanId, externalReference, since }) {
  try {
    const result = await mp.searchPreapprovals({ payer_email: payerEmail, preapproval_plan_id: mpPlanId, limit: 10 });
    return (result?.results ?? []).find(p =>
      String(p.external_reference) === externalReference &&
      new Date(p.date_created).getTime() >= since &&
      normalizeStatus(p.status) !== "cancelled"
    ) ?? null;
  } catch (err) {
    console.error("[assinaturas] Falha ao procurar assinatura recém-criada:", mp.describeError(err));
    return null;
  }
}

/** POST /api/assinaturas */
async function createSubscription({ user, planCode, cardTokenId }) {
  assertConfigured();
  const plan = assertPlanForUser(planCode, user);
  assertCardToken(cardTokenId);

  return withUserLock(user.id, async () => {
    const current = await findCurrent(user.id);
    if (current && LIVE_STATUSES.includes(current.status)) {
      throw new SubscriptionError(409, "Você já tem uma assinatura ativa. Para mudar de plano, use \"Trocar de plano\" em Minha assinatura.", { reason: "ja_assinante" });
    }
    if (current?.status === "pending") {
      // Tentativa anterior que ficou pendente: cancela antes de criar outra.
      await cancelAtMercadoPago(current).catch(err => logMpFailure("Cancelamento de assinatura pendente", user.id, err));
    }

    const preapproval = await createPreapprovalSafely({ userId: user.id, plan, cardTokenId });
    const row = await upsertFromPreapproval(preapproval, { userId: user.id, planCode: plan.code });
    console.log(`[assinaturas] Usuário ${user.id} assinou ${plan.code} (preapproval ${preapproval.id}, status ${preapproval.status}).`);
    return toPublicSubscription(row);
  });
}

/** PUT /api/assinaturas/cancelar */
async function cancelSubscription({ user }) {
  assertConfigured();
  return withUserLock(user.id, async () => {
    const current = await findCurrent(user.id);
    if (!current || !OPEN_STATUSES.includes(current.status)) {
      throw new SubscriptionError(404, "Você não tem uma assinatura ativa para cancelar.");
    }

    // Traz as cobranças mais recentes antes, para o acesso continuar até o
    // fim do período realmente pago mesmo que algum webhook não tenha chegado.
    await reconcileSubscription(current).catch(err => logMpFailure("Sincronização antes do cancelamento", user.id, err));

    try {
      await cancelAtMercadoPago(current);
    } catch (err) {
      logMpFailure("Cancelamento da assinatura", user.id, err);
      throw new SubscriptionError(502, "Não foi possível cancelar agora no Mercado Pago. Tente novamente em alguns minutos.");
    }
    console.log(`[assinaturas] Usuário ${user.id} cancelou a assinatura ${current.plan_id} (preapproval ${current.mp_preapproval_id}).`);
    return toPublicSubscription(await findById(current.id));
  });
}

/** PUT /api/assinaturas/cartao */
async function updateCard({ user, cardTokenId }) {
  assertConfigured();
  assertCardToken(cardTokenId);
  return withUserLock(user.id, async () => {
    const current = await findLive(user.id);
    if (!current) throw new SubscriptionError(404, "Você não tem uma assinatura ativa.");

    try {
      await mp.updatePreapproval(current.mp_preapproval_id, { card_token_id: cardTokenId });
    } catch (err) {
      logMpFailure("Troca de cartão", user.id, err);
      const { reason, message, httpStatus } = classifyMpError(err);
      throw new SubscriptionError(httpStatus, message, { reason });
    }
    console.log(`[assinaturas] Usuário ${user.id} trocou o cartão da preapproval ${current.mp_preapproval_id}.`);
    return toPublicSubscription(await findById(current.id));
  });
}

/**
 * PUT /api/assinaturas/plano
 * O Mercado Pago não permite mover uma preapproval para outro plano
 * (o PUT não aceita preapproval_plan_id). A troca então cria uma nova
 * assinatura no plano escolhido (cobrada agora, com o cartão informado) e
 * cancela a atual — que continua dando acesso até o fim do período já
 * pago ("melhor plano vale", ver subscriptionService).
 */
async function changePlan({ user, planCode, cardTokenId }) {
  assertConfigured();
  const plan = assertPlanForUser(planCode, user);
  assertCardToken(cardTokenId);

  return withUserLock(user.id, async () => {
    const current = await findLive(user.id);
    if (!current) throw new SubscriptionError(404, "Você não tem uma assinatura ativa para trocar. Assine um plano em Planos.");
    if (current.plan_id === plan.code) throw new SubscriptionError(409, "Você já assina este plano.");

    const preapproval = await createPreapprovalSafely({ userId: user.id, plan, cardTokenId });
    const row = await upsertFromPreapproval(preapproval, { userId: user.id, planCode: plan.code });

    try {
      await cancelAtMercadoPago(current);
    } catch (err) {
      // Não desfaz a nova assinatura: enforceSingleOpen() tenta de novo na
      // próxima sincronização. Fica registrado para acompanhamento.
      logMpFailure(`Cancelamento da assinatura antiga ${current.mp_preapproval_id} na troca de plano`, user.id, err);
    }
    console.log(`[assinaturas] Usuário ${user.id} trocou de ${current.plan_id} para ${plan.code} (nova preapproval ${preapproval.id}).`);
    return toPublicSubscription(row);
  });
}

// ── Webhook ───────────────────────────────────────────────
/**
 * Processa uma notificação já validada. Usa só o tipo e o ID: o recurso
 * é sempre buscado na API do Mercado Pago.
 */
async function processNotification({ type, dataId }) {
  if (!mpConfig.isConfigured || !dataId) return null;
  switch (type) {
    case "subscription_preapproval":        return syncPreapproval(dataId);
    case "subscription_authorized_payment": return syncAuthorizedPayment(dataId);
    case "payment":                         return syncPayment(dataId);
    default:                                return null; // ex.: subscription_preapproval_plan — nada a fazer
  }
}

module.exports = {
  SubscriptionError,
  checkoutAvailability, getMpPlanId,
  getSummary, findCurrent, findLive, toPublicSubscription,
  createSubscription, cancelSubscription, updateCard, changePlan,
  processNotification, syncUserSubscriptions, syncPreapproval,
  // exportados para testes
  parseExternalReference, normalizeStatus, toUtcDateTime, preapprovalIdFromPayment,
};
