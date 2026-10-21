// ============================================
// controllers/assinaturasController.js
// Assinatura recorrente (Mercado Pago): API autenticada, páginas EJS e
// webhook público. Toda operação usa SEMPRE o usuário da sessão — nenhuma
// rota recebe ID de assinatura do cliente, então só o dono mexe na sua.
// ============================================
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require("mercadopago");
const db       = require("../database/db");
const mpConfig = require("../config/mercadopago");
const { getPlan, isPaidPlan, plansForType } = require("../config/plans");
const subs     = require("../services/mpSubscriptions");
const { reasonMessage, isKnownReason } = require("../services/mpMessages");
const { loginRedirect, homeFor } = require("../middlewares/auth");

function sendError(res, err, logTag) {
  if (err instanceof subs.SubscriptionError) {
    return res.status(err.httpStatus).json({ error: err.message, reason: err.reason ?? null });
  }
  console.error(logTag, err.message);
  return res.status(500).json({ error: "Erro interno. Tente novamente." });
}

// Planos pagos do tipo da conta (para "Trocar de plano").
function paidPlansFor(type) {
  return plansForType(type).filter(isPaidPlan).map(p => ({
    code: p.code, name: p.name, price_cents: p.price_cents, benefits: p.benefits,
  }));
}

async function sessionEmail(userId) {
  const [[row]] = await db.query("SELECT email FROM users WHERE id = ?", [userId]);
  return row?.email ?? "";
}

const assinaturasController = {
  // ── API ─────────────────────────────────────────────────

  // POST /api/assinaturas  { plan_id, card_token_id }
  create: async (req, res) => {
    try {
      const subscription = await subs.createSubscription({
        user:        req.session.user,
        planCode:    req.body?.plan_id,
        cardTokenId: req.body?.card_token_id,
      });
      res.status(201).json({ status: subscription.status, subscription });
    } catch (err) {
      sendError(res, err, "[POST /api/assinaturas]");
    }
  },

  // GET /api/assinaturas/minha[?sync=1]
  getMine: async (req, res) => {
    try {
      const summary = await subs.getSummary(req.session.user.id, { sync: req.query.sync === "1" });
      res.json(summary);
    } catch (err) {
      sendError(res, err, "[GET /api/assinaturas/minha]");
    }
  },

  // PUT /api/assinaturas/cancelar
  cancel: async (req, res) => {
    try {
      const subscription = await subs.cancelSubscription({ user: req.session.user });
      res.json({ status: subscription.status, subscription });
    } catch (err) {
      sendError(res, err, "[PUT /api/assinaturas/cancelar]");
    }
  },

  // PUT /api/assinaturas/cartao  { card_token_id }
  updateCard: async (req, res) => {
    try {
      const subscription = await subs.updateCard({ user: req.session.user, cardTokenId: req.body?.card_token_id });
      res.json({ status: subscription.status, subscription });
    } catch (err) {
      sendError(res, err, "[PUT /api/assinaturas/cartao]");
    }
  },

  // PUT /api/assinaturas/plano  { plan_id, card_token_id }
  changePlan: async (req, res) => {
    try {
      const subscription = await subs.changePlan({
        user:        req.session.user,
        planCode:    req.body?.plan_id,
        cardTokenId: req.body?.card_token_id,
      });
      res.json({ status: subscription.status, subscription });
    } catch (err) {
      sendError(res, err, "[PUT /api/assinaturas/plano]");
    }
  },

  // ── Páginas ─────────────────────────────────────────────

  // GET /planos/:id/assinar
  assinarPage: async (req, res, next) => {
    const plan = getPlan(req.params.id);
    if (!plan || !isPaidPlan(plan)) return res.redirect("/planos");

    const user = req.session?.user;
    if (!user) return res.redirect(loginRedirect(req, plan.type === "empresa" ? "tipo=empresa" : ""));
    if (user.type === "admin") return res.redirect(homeFor("admin"));
    if (plan.type !== user.type) return res.redirect("/planos");

    try {
      const current = await subs.findCurrent(user.id);
      const live = current && ["authorized", "paused"].includes(current.status) ? current : null;

      let mode = "subscribe";
      if (live && live.plan_id === plan.code) mode = "current";
      else if (live) mode = "change";

      const availability = mode === "current"
        ? { available: true }
        : await subs.checkoutAvailability(plan.code);

      res.render("assinar", {
        currentPage:  "planos",
        userType:     user.type,
        plan,
        mode,
        available:    availability.available,
        current:      subs.toPublicSubscription(current),
        publicKey:    mpConfig.publicKey,
        payerEmail:   availability.available ? await sessionEmail(user.id) : "",
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /assinatura/retorno  (back_url dos planos e destino após o checkout)
  //   ?status=recusada&plano=<code>&motivo=<status_detail|motivo>  → recusa na criação
  //   ?preapproval_id=...  (o Mercado Pago acrescenta ao usar o link do plano)
  //   sem parâmetros       → estado atual da assinatura do usuário
  retornoPage: async (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.redirect(loginRedirect(req));
    if (user.type === "admin") return res.redirect(homeFor("admin"));

    try {
      const planFromQuery = getPlan(String(req.query.plano ?? ""));
      const retryPlan = planFromQuery && isPaidPlan(planFromQuery) && planFromQuery.type === user.type ? planFromQuery : null;

      if (req.query.status === "recusada") {
        const motivo = String(req.query.motivo ?? "");
        return res.render("assinatura-resultado", {
          currentPage: "planos",
          userType:    user.type,
          state:       "recusada",
          subscription: null,
          // Só textos conhecidos — nunca o valor cru da URL.
          reason:      reasonMessage(isKnownReason(motivo) ? motivo : "generico"),
          retryHref:   retryPlan ? `/planos/${retryPlan.code}/assinar` : "/planos",
        });
      }

      // Vindo do link do plano no Mercado Pago (?preapproval_id=): busca
      // essa assinatura na API — a página abaixo só mostra a do próprio
      // usuário da sessão.
      const preapprovalId = String(req.query.preapproval_id ?? "");
      if (mpConfig.isConfigured && /^[A-Za-z0-9]{1,64}$/.test(preapprovalId)) {
        await subs.syncPreapproval(preapprovalId).catch(err => {
          console.error(`[assinaturas] Falha ao buscar a preapproval ${preapprovalId} do retorno:`, err.message);
        });
      }

      const summary = await subs.getSummary(user.id, { sync: true });
      const sub = summary.subscription;
      let state = "nenhuma";
      if (sub?.status === "authorized") state = "ativa";
      else if (sub?.status === "pending") state = "pendente";
      else if (sub?.status === "paused") state = "pausada";

      res.render("assinatura-resultado", {
        currentPage:  "planos",
        userType:     user.type,
        state,
        subscription: sub,
        reason:       null,
        retryHref:    sub?.plan?.code ? `/planos/${sub.plan.code}/assinar` : "/planos",
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /minha-assinatura
  minhaAssinaturaPage: async (req, res, next) => {
    const user = req.session.user;
    if (user.type === "admin") return res.redirect(homeFor("admin"));
    try {
      res.render("minha-assinatura", {
        currentPage: "minha-assinatura",
        userType:    user.type,
        configured:  mpConfig.isConfigured,
        publicKey:   mpConfig.publicKey,
        payerEmail:  mpConfig.isConfigured ? await sessionEmail(user.id) : "",
        paidPlans:   paidPlansFor(user.type),
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Webhook ─────────────────────────────────────────────

  // POST /webhooks/mercadopago (público)
  webhook: (req, res) => {
    const type = String(req.body?.type ?? req.query.type ?? req.query.topic ?? "");
    const queryDataId = req.query["data.id"];
    const dataId = String(queryDataId ?? req.body?.data?.id ?? req.query.id ?? "");
    const requestId = req.headers["x-request-id"];

    if (mpConfig.webhookSecret) {
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.headers["x-signature"],
          xRequestId: requestId,
          // A doc do MP manda usar o data.id da query em minúsculas no manifesto.
          dataId:     queryDataId != null ? String(queryDataId).toLowerCase() : undefined,
          secret:     mpConfig.webhookSecret,
        });
      } catch (err) {
        if (err instanceof InvalidWebhookSignatureError) {
          console.warn(`[webhook-mp] Assinatura inválida (${err.reason}) — request-id ${requestId ?? "-"}, tipo "${type}".`);
          return res.status(401).end();
        }
        throw err;
      }
    }

    // Responde rápido (o MP espera no máximo 22s e reenvia se não houver
    // 200); o processamento segue em segundo plano, buscando o recurso na
    // API pelo ID. Reprocessar é seguro: tudo é upsert.
    res.sendStatus(200);

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dataId)) return;
    setImmediate(() => {
      subs.processNotification({ type, dataId })
        .catch(err => {
          const notFound = err?.status === 404;
          const log = notFound ? console.warn : console.error;
          log(`[webhook-mp] Falha ao processar ${type} ${dataId}${notFound ? " (recurso não encontrado — notificação de teste do painel?)" : ""}:`,
            err?.message ?? err);
        });
    });
  },
};

module.exports = assinaturasController;
