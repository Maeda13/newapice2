const { plansForType } = require("../config/plans");
const { getUserPlan } = require("../services/subscriptionService");
const { findCurrent, toPublicSubscription } = require("../services/mpSubscriptions");
const mpConfig = require("../config/mercadopago");

const plansController = {
  // Planos disponíveis pro tipo do usuário logado — dev vê os planos de
  // dev, empresa vê os de empresa. Não expõe os planos do outro tipo.
  //
  // A assinatura em si acontece em /planos/:id/assinar (Mercado Pago);
  // não existe mais ativação de plano sem pagamento por aqui.
  getPlans: async (req, res) => {
    try {
      const type = req.session.user.type === "empresa" ? "empresa" : "dev";
      const [current, subscription] = await Promise.all([
        getUserPlan(req.session.user.id, type),
        findCurrent(req.session.user.id),
      ]);
      res.json({
        plans: plansForType(type),
        current_plan_code: current.code,
        subscription: toPublicSubscription(subscription),
        checkout_available: mpConfig.isConfigured,
      });
    } catch (err) {
      console.error("[GET /api/plans]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = plansController;
