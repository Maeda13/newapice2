// ============================================
// services/mercadoPago.js
// Camada fina sobre o SDK oficial (mercadopago v3 — MercadoPagoConfig,
// PreApprovalPlan, PreApproval, Payment...). É o ÚNICO arquivo que fala
// com a API do Mercado Pago: o resto do código (e os testes, via
// jest.mock) usa só estas funções.
// ============================================
const {
  PreApproval, PreApprovalPlan, Payment, Invoice, User,
  MercadoPagoError, MPConnectionError,
} = require("mercadopago");
const mpConfig = require("../config/mercadopago");

class MpNotConfiguredError extends Error {
  constructor() {
    super("Mercado Pago não configurado (MP_ACCESS_TOKEN/MP_PUBLIC_KEY ausentes).");
    this.name = "MpNotConfiguredError";
  }
}

function sdk(Client) {
  if (!mpConfig.isConfigured) throw new MpNotConfiguredError();
  return new Client(mpConfig.newClientConfig());
}

// ── Conta (vendedor) dona das credenciais ─────────────────
// O id da conta separa os mp_plan_id de teste dos de produção (ver
// tabela mp_plans). Fica em cache durante a vida do processo; se a
// chamada falhar, a próxima tenta de novo.
let accountPromise = null;
function getAccount() {
  if (!accountPromise) {
    accountPromise = sdk(User).get()
      .then(user => {
        if (!user?.id) throw new Error("Resposta de /users/me sem id.");
        return {
          id: user.id,
          siteId: user.site_id ?? null,
          isTestUser: Array.isArray(user.tags) && user.tags.includes("test_user"),
        };
      })
      .catch(err => { accountPromise = null; throw err; });
  }
  return accountPromise;
}

// ── Planos (preapproval_plan) ─────────────────────────────
const createPlan = body => sdk(PreApprovalPlan).create({ body });
const getPlan    = id   => sdk(PreApprovalPlan).get({ preApprovalPlanId: id });
const updatePlan = (id, body) => sdk(PreApprovalPlan).update({ id, updatePreApprovalPlanRequest: body });
const searchPlans = options => sdk(PreApprovalPlan).search({ options });

// ── Assinaturas (preapproval) ─────────────────────────────
// Criação sem retry automático do SDK: um POST que deu timeout pode ter
// criado a assinatura do lado do MP, e repetir às cegas arriscaria uma
// cobrança em dobro. Esse caso é tratado em mpSubscriptions (busca a
// assinatura recém-criada antes de dar erro).
const createPreapproval  = body => sdk(PreApproval).create({ body, requestOptions: { maxRetries: 0 } });
const getPreapproval     = id   => sdk(PreApproval).get({ id });
const updatePreapproval  = (id, body) => sdk(PreApproval).update({ id, body });
const searchPreapprovals = options => sdk(PreApproval).search({ options });

// ── Cobranças da assinatura (authorized_payments) e pagamentos ──
const getAuthorizedPayment     = id      => sdk(Invoice).get({ id });
const searchAuthorizedPayments = options => sdk(Invoice).search({ options });
const getPayment               = id      => sdk(Payment).get({ id });

/** Erro do SDK cujo resultado é incerto (timeout, rede, 5xx): o MP pode ter processado. */
function isAmbiguousError(err) {
  if (err instanceof MPConnectionError) return true;
  if (err instanceof MercadoPagoError) return err.status >= 500;
  return err?.name === "AbortError" || err?.name === "TimeoutError";
}

function isNotFoundError(err) {
  return err instanceof MercadoPagoError && err.status === 404;
}

/** Texto do erro para log — nunca inclui token, corpo da requisição nem dados de cartão. */
function describeError(err) {
  if (err instanceof MercadoPagoError) {
    const causes = Array.isArray(err.causes) && err.causes.length
      ? ` causes=${JSON.stringify(err.causes).slice(0, 300)}`
      : "";
    return `${err.name} status=${err.status} message="${err.message}"${causes}`;
  }
  return `${err?.name ?? "Error"}: ${err?.message ?? err}`;
}

module.exports = {
  MpNotConfiguredError,
  getAccount,
  createPlan, getPlan, updatePlan, searchPlans,
  createPreapproval, getPreapproval, updatePreapproval, searchPreapprovals,
  getAuthorizedPayment, searchAuthorizedPayments, getPayment,
  isAmbiguousError, isNotFoundError, describeError,
};
