// ============================================
// middlewares/requirePlan.js
// Protege recursos premium pelo plano efetivo do usuário (assinatura
// paga no Mercado Pago, plano manual do admin ou gratuito — ver
// services/subscriptionService.js).
//
//   router.post("/x", isEmpresa, requirePlan("empresa_premium"), handler)
//   router.get("/y", requirePlan("empresa_basico", "empresa_premium", { message: "..." }), handler)
//
// Rotas /api respondem 401/402 em JSON (mesmo padrão 402 dos gates de
// plano já existentes); páginas redirecionam para o login ou para /planos.
// ============================================
const { getUserPlan } = require("../services/subscriptionService");
const { getPlan }     = require("../config/plans");

function requirePlan(...args) {
  const last     = args[args.length - 1];
  const options  = last && typeof last === "object" && !Array.isArray(last) ? args.pop() : {};
  const allowed  = args.flat();
  const names    = allowed.map(code => getPlan(code)?.name ?? code).join(" ou ");
  const message  = options.message ?? `Recurso exclusivo do plano ${names}.`;

  return async (req, res, next) => {
    const isApi = req.originalUrl.startsWith("/api/");
    const user  = req.session?.user;

    if (!user) {
      return isApi
        ? res.status(401).json({ error: "Não autenticado." })
        : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }

    try {
      const plan = await getUserPlan(user.id, user.type);
      if (plan && allowed.includes(plan.code)) {
        req.userPlan = plan;
        return next();
      }
      return isApi
        ? res.status(402).json({ error: message, required_plans: allowed })
        : res.redirect("/planos");
    } catch (err) {
      console.error("[requirePlan]", err.message);
      return isApi ? res.status(500).json({ error: "Erro interno. Tente novamente." }) : next(err);
    }
  };
}

module.exports = { requirePlan };
