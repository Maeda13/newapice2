// ============================================
// services/mpAnnual.js
// Plano anual: um PAGAMENTO ÚNICO no Mercado Pago (API de pagamentos, não
// de assinaturas) — à vista ou em até MAX_PARCELAS_ANUAL vezes no cartão —
// que libera o plano por MESES_PLANO_ANUAL meses a partir da aprovação.
// Não renova sozinho: o Mercado Pago não parcela assinaturas recorrentes,
// então no fim do período o usuário paga um novo ano.
//
// Mesmas regras do mensal (services/mpSubscriptions.js):
//   - valor e plano vêm SEMPRE de config/plans.js pelo código do plano;
//   - status vem SEMPRE da API do Mercado Pago (resposta da criação,
//     webhook "payment" ou reconsulta), nunca do front;
//   - toda escrita é upsert pelo ID do pagamento (idempotente).
//
// Parcelamento sem juros para o cliente: depende da configuração
// "parcelamento sem juros" da conta no painel do Mercado Pago; aqui só
// limitamos o número de parcelas.
// ============================================
const crypto   = require("crypto");
const db       = require("../database/db");
const mp       = require("./mercadoPago");
const mpConfig = require("../config/mercadopago");
const {
  getPlan, hasAnnualOption, annualAmount, MAX_PARCELAS_ANUAL, MESES_PLANO_ANUAL,
} = require("../config/plans");
const { ANNUAL_ACCESS_CONDITION } = require("./subscriptionService");
const { classifyMpError, reasonMessage, paymentStatusLabel } = require("./mpMessages");
const subs = require("./mpSubscriptions");

const { SubscriptionError } = subs;

// Renovação antecipada: liberada só nos últimos dias do ano pago (o novo ano
// começa quando o atual termina — ver validUntilFor).
const DIAS_RENOVACAO_ANTECIPADA = 30;
// Pagamento em análise (in_process/pending) bloqueia uma nova tentativa por
// este tempo, para não cobrar duas vezes enquanto o MP decide.
const HORAS_BLOQUEIO_EM_ANALISE = 48;

const OPEN_PAYMENT_STATUSES = ["pending", "in_process", "authorized"];

// ── Referência externa ────────────────────────────────────
// "anual:userId:planCode" — distingue o pagamento anual de qualquer outro
// pagamento avulso da conta.
function annualReference(userId, planCode) {
  return `anual:${userId}:${planCode}`;
}

function parseAnnualReference(ref) {
  const match = /^anual:(\d+):([a-z_]+)$/.exec(String(ref ?? ""));
  return match ? { userId: Number(match[1]), planCode: match[2] } : null;
}

// ── Datas (UTC, como em mpSubscriptions) ──────────────────
function addMonthsUtc(ms, months) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

const ANNUAL_COLUMNS = `
  id, user_id, plan_id, mp_payment_id, status, status_detail, amount, installments,
  DATE_FORMAT(paid_at,     '%Y-%m-%dT%H:%i:%sZ') AS paid_at,
  DATE_FORMAT(valid_until, '%Y-%m-%dT%H:%i:%sZ') AS valid_until,
  UNIX_TIMESTAMP(created_at) AS created_ts,
  (${ANNUAL_ACCESS_CONDITION}) AS has_access
`;

// ── Consultas ─────────────────────────────────────────────
async function findAnnualByPaymentId(paymentId) {
  const [rows] = await db.query(
    `SELECT ${ANNUAL_COLUMNS} FROM annual_payments WHERE mp_payment_id = ?`,
    [String(paymentId)]
  );
  return rows[0] ?? null;
}

/**
 * Pagamento anual mais relevante do usuário: o vigente (o que termina por
 * último); senão o em análise mais recente; senão o último registrado.
 */
async function findCurrentAnnual(userId) {
  const [rows] = await db.query(`
    SELECT ${ANNUAL_COLUMNS} FROM annual_payments WHERE user_id = ?
    ORDER BY (${ANNUAL_ACCESS_CONDITION}) DESC, valid_until DESC, created_at DESC, id DESC
    LIMIT 1
  `, [userId]);
  return rows[0] ?? null;
}

/**
 * Até quando vai o novo ano: 12 meses depois da aprovação — ou, se o
 * usuário ainda tem um ano do mesmo plano em vigor (renovação antecipada),
 * 12 meses depois do fim dele, para não perder dias já pagos.
 */
async function validUntilFor({ userId, planCode, mpPaymentId, approvedAtMs }) {
  const [[row]] = await db.query(`
    SELECT DATE_FORMAT(MAX(valid_until), '%Y-%m-%dT%H:%i:%sZ') AS ate
    FROM annual_payments
    WHERE user_id = ? AND plan_id = ? AND mp_payment_id <> ? AND ${ANNUAL_ACCESS_CONDITION}
  `, [userId, planCode, String(mpPaymentId)]);
  const vigenteAte = row?.ate ? Date.parse(row.ate) : 0;
  return addMonthsUtc(Math.max(approvedAtMs, vigenteAte), MESES_PLANO_ANUAL);
}

// ── Escrita idempotente ───────────────────────────────────
/**
 * Grava/atualiza o pagamento anual a partir do pagamento buscado na API.
 * Dono e plano vêm do que já está no banco ou do external_reference que
 * nós mesmos definimos na criação. valid_until é calculado uma única vez,
 * na primeira vez que o pagamento aparece aprovado.
 */
async function upsertAnnualPayment(payment, hint = {}) {
  if (!payment?.id) return null;
  const existing = await findAnnualByPaymentId(payment.id);
  const owner = existing
    ? { userId: existing.user_id, planCode: existing.plan_id }
    : (hint.userId ? hint : parseAnnualReference(payment.external_reference));
  if (!owner) return null;

  const plan = getPlan(owner.planCode);
  if (!hasAnnualOption(plan)) {
    console.warn(`[plano-anual] Pagamento ${payment.id} com plano sem opção anual ("${owner.planCode}") — ignorado.`);
    return null;
  }

  const status = String(payment.status ?? "pending");
  const approvedAtMs = payment.date_approved ? Date.parse(payment.date_approved) : Date.now();
  let validUntil = existing?.valid_until ? Date.parse(existing.valid_until) : null;
  if (!validUntil && status === "approved") {
    validUntil = await validUntilFor({
      userId: owner.userId, planCode: plan.code, mpPaymentId: payment.id, approvedAtMs,
    });
  }

  await db.query(`
    INSERT INTO annual_payments
      (user_id, plan_id, mp_payment_id, status, status_detail, amount, installments, paid_at, valid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status), status_detail = VALUES(status_detail), amount = VALUES(amount),
      installments = VALUES(installments), paid_at = VALUES(paid_at),
      valid_until = COALESCE(valid_until, VALUES(valid_until))
  `, [
    owner.userId, plan.code, String(payment.id), status, payment.status_detail ?? null,
    payment.transaction_amount ?? null, payment.installments ?? null,
    status === "approved" ? subs.toUtcDateTime(approvedAtMs) : null,
    validUntil ? subs.toUtcDateTime(validUntil) : null,
  ]);

  const row = await findAnnualByPaymentId(payment.id);
  if (!existing || existing.status !== status) {
    console.log(`[plano-anual] Pagamento ${payment.id} do usuário ${owner.userId} (${plan.code}): ${existing?.status ?? "novo"} → ${status}.`);
  }
  return row;
}

/** Reconsulta no MP o pagamento anual ainda em análise do usuário (se houver). */
async function refreshOpenAnnual(userId) {
  if (!mpConfig.isConfigured) return null;
  const current = await findCurrentAnnual(userId);
  if (!current || !OPEN_PAYMENT_STATUSES.includes(current.status)) return current;
  return upsertAnnualPayment(await mp.getPayment(current.mp_payment_id));
}

// ── Formato público (API / páginas) ───────────────────────
function toPublicAnnual(row) {
  if (!row) return null;
  const plan = getPlan(row.plan_id);
  return {
    plan:          subs.publicPlan(plan) ?? { code: row.plan_id, name: row.plan_id },
    status:        row.status,
    status_label:  paymentStatusLabel(row.status),
    status_detail: row.status_detail ?? null,
    message:       row.status === "rejected" ? reasonMessage(row.status_detail) : null,
    amount:        row.amount != null ? Number(row.amount) : null,
    installments:  row.installments != null ? Number(row.installments) : null,
    paid_at:       row.paid_at,
    valid_until:   row.valid_until,
    has_access:    Boolean(row.has_access),
    created_at:    row.created_ts ? new Date(Number(row.created_ts) * 1000).toISOString() : null,
  };
}

// ── Validação do que vem do Brick ─────────────────────────
// O Brick devolve o token do cartão e o que o Mercado Pago precisa para um
// pagamento avulso (bandeira, emissor, parcelas e o documento do titular).
// Nunca recebemos o número do cartão.
function parsePaymentForm(form = {}) {
  subs.assertCardToken(form.token);

  const paymentMethodId = String(form.payment_method_id ?? "");
  if (!/^[a-z0-9_]{2,30}$/.test(paymentMethodId)) {
    throw new SubscriptionError(400, "Bandeira do cartão inválida. Preencha o cartão novamente.", { reason: "token_invalido" });
  }

  const installments = Number(form.installments);
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_PARCELAS_ANUAL) {
    throw new SubscriptionError(400, `Escolha de 1 a ${MAX_PARCELAS_ANUAL} parcelas.`);
  }

  const issuerId = form.issuer_id != null && String(form.issuer_id) !== "" ? String(form.issuer_id) : null;
  if (issuerId && !/^\d{1,12}$/.test(issuerId)) {
    throw new SubscriptionError(400, "Emissor do cartão inválido. Preencha o cartão novamente.", { reason: "token_invalido" });
  }

  const ident = form.payer?.identification;
  let identification = null;
  if (ident && (ident.type || ident.number)) {
    const type = String(ident.type ?? "").toUpperCase();
    const number = String(ident.number ?? "").replace(/\D/g, "");
    if (!/^[A-Z]{2,10}$/.test(type) || !/^\d{5,20}$/.test(number)) {
      throw new SubscriptionError(400, "Documento do titular do cartão inválido.", { reason: "token_invalido" });
    }
    identification = { type, number };
  }

  return { token: form.token, paymentMethodId, installments, issuerId, identification };
}

// URL do webhook só quando o site é público (o MP recusa localhost); sem
// ela, vale a URL de notificações configurada no painel da conta.
function notificationUrl() {
  return mpConfig.baseUrl && !mpConfig.backUrlIsLocal ? `${mpConfig.baseUrl}/webhooks/mercadopago` : undefined;
}

/** Procura o pagamento recém-criado (timeout/5xx na criação: o MP pode ter cobrado). */
async function findRecentAnnualPayment({ externalReference, since }) {
  try {
    const result = await mp.searchPayments({
      external_reference: externalReference, sort: "date_created", criteria: "desc", limit: 10,
    });
    return (result?.results ?? []).find(p =>
      String(p.external_reference) === externalReference && new Date(p.date_created).getTime() >= since
    ) ?? null;
  } catch (err) {
    console.error("[plano-anual] Falha ao procurar pagamento recém-criado:", mp.describeError(err));
    return null;
  }
}

/** POST /api/assinaturas/anual */
async function createAnnualPayment({ user, planCode, form }) {
  subs.assertConfigured();
  const plan = subs.assertPlanForUser(planCode, user);
  if (!hasAnnualOption(plan)) throw new SubscriptionError(400, "Este plano não tem a opção anual.");
  const pagamento = parsePaymentForm(form);

  return subs.withUserLock(user.id, async () => {
    if (await subs.findLive(user.id)) {
      throw new SubscriptionError(409,
        "Você tem a assinatura mensal ativa. Para mudar para o plano anual, cancele a mensal em Minha assinatura — o acesso dela continua até o fim do mês já pago.",
        { reason: "ja_assinante" });
    }

    const atual = await findCurrentAnnual(user.id);
    if (atual && OPEN_PAYMENT_STATUSES.includes(atual.status)
        && Date.now() - Number(atual.created_ts) * 1000 < HORAS_BLOQUEIO_EM_ANALISE * 3600 * 1000) {
      throw new SubscriptionError(409,
        "Seu pagamento anual anterior ainda está em análise no Mercado Pago. Aguarde o resultado antes de tentar de novo.",
        { reason: "em_analise" });
    }
    if (atual?.has_access && atual.valid_until
        && Date.parse(atual.valid_until) - Date.now() > DIAS_RENOVACAO_ANTECIPADA * 24 * 3600 * 1000) {
      const ate = new Date(atual.valid_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      throw new SubscriptionError(409,
        `Seu plano anual vale até ${ate}. A renovação fica disponível nos ${DIAS_RENOVACAO_ANTECIPADA} dias antes do vencimento.`,
        { reason: "anual_vigente" });
    }

    const payerEmail = await subs.getPayerEmail(user.id);
    const externalReference = annualReference(user.id, plan.code);
    const body = {
      transaction_amount: annualAmount(plan),
      token:              pagamento.token,
      installments:       pagamento.installments,
      payment_method_id:  pagamento.paymentMethodId,
      ...(pagamento.issuerId ? { issuer_id: Number(pagamento.issuerId) } : {}),
      description:        `Ápice — Plano ${plan.name} anual (${plan.type === "empresa" ? "empresas" : "desenvolvedores"})`,
      statement_descriptor: "APICE",
      external_reference: externalReference,
      payer: {
        email: payerEmail,
        ...(pagamento.identification ? { identification: pagamento.identification } : {}),
      },
      metadata: { tipo: "plano_anual", user_id: user.id, plan_code: plan.code },
      ...(notificationUrl() ? { notification_url: notificationUrl() } : {}),
    };

    const startedAt = Date.now();
    let payment;
    try {
      payment = await mp.createPayment(body, crypto.randomUUID());
    } catch (err) {
      if (mp.isAmbiguousError(err)) {
        payment = await findRecentAnnualPayment({ externalReference, since: startedAt - 60 * 1000 });
      }
      if (!payment) {
        subs.logMpFailure(`Pagamento anual do plano ${plan.code}`, user.id, err);
        const { reason, message, httpStatus } = classifyMpError(err);
        throw new SubscriptionError(httpStatus, message, { reason });
      }
    }

    const row = await upsertAnnualPayment(payment, { userId: user.id, planCode: plan.code });
    console.log(`[plano-anual] Usuário ${user.id} pagou o anual ${plan.code} em ${pagamento.installments}x (pagamento ${payment.id}, status ${payment.status}).`);
    return toPublicAnnual(row);
  });
}

// ── Webhook e resumo (camada acima de mpSubscriptions) ────
/**
 * Notificação do Mercado Pago. Pagamento do plano anual (external_reference
 * "anual:...") é tratado aqui; todo o resto segue para a assinatura mensal,
 * sem buscar o pagamento duas vezes.
 */
async function processNotification({ type, dataId }) {
  if (!mpConfig.isConfigured || !dataId) return null;
  if (type === "payment") {
    const payment = await mp.getPayment(dataId);
    if (parseAnnualReference(payment?.external_reference)) return upsertAnnualPayment(payment);
    return subs.syncPayment(dataId, { payment });
  }
  return subs.processNotification({ type, dataId });
}

/**
 * Resumo da assinatura (mpSubscriptions.getSummary) + o plano anual mais
 * relevante — vigente, em análise ou o último recusado — ou null.
 */
async function getSummary(userId, { sync = false } = {}) {
  if (sync) {
    await refreshOpenAnnual(userId).catch(err => {
      console.error(`[plano-anual] Falha ao atualizar o pagamento anual do usuário ${userId}:`, mp.describeError(err));
    });
  }
  const summary = await subs.getSummary(userId, { sync });
  return { ...summary, annual: toPublicAnnual(await findCurrentAnnual(userId)) };
}

module.exports = {
  processNotification, getSummary,
  createAnnualPayment, upsertAnnualPayment, refreshOpenAnnual,
  findCurrentAnnual, toPublicAnnual, parseAnnualReference,
  // exportados para testes
  annualReference, parsePaymentForm, addMonthsUtc,
  DIAS_RENOVACAO_ANTECIPADA, HORAS_BLOQUEIO_EM_ANALISE,
};
