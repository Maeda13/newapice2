// ============================================
// config/plans.js
// Definição estática dos planos do modelo Freemium
// (ver documentação de monetização). Sem gateway de
// pagamento escolhido ainda — enquanto isso, o "checkout"
// é manual via admin (ver services/subscriptionService.js).
//
// Objeto estático em vez de tabela: são 5 planos fixos,
// sem UI de "criar plano novo" prevista no escopo atual.
// ============================================

const PLANS = {
  dev_free: {
    type: "dev",
    code: "dev_free",
    name: "Gratuito",
    price_cents: 0,
    features: {
      roadmap_personalizado: false, // inclui as recomendações de cursos/skills
      destaque_perfil:       false,
    },
  },
  dev_pro: {
    type: "dev",
    code: "dev_pro",
    name: "PRO",
    price_cents: 1990,
    features: {
      roadmap_personalizado: true,
      destaque_perfil:       true,
    },
  },

  empresa_free: {
    type: "empresa",
    code: "empresa_free",
    name: "Free",
    price_cents: 0,
    max_active_jobs: 1,
  },
  empresa_basico: {
    type: "empresa",
    code: "empresa_basico",
    name: "Básico",
    price_cents: 4990,
    max_active_jobs: 3,
  },
  empresa_premium: {
    type: "empresa",
    code: "empresa_premium",
    name: "Premium",
    price_cents: 9990,
    max_active_jobs: null, // null = ilimitado
  },
};

const DEFAULT_PLAN_BY_TYPE = { dev: "dev_free", empresa: "empresa_free" };

function getPlan(code) {
  return PLANS[code] ?? null;
}

function plansForType(type) {
  return Object.values(PLANS).filter(p => p.type === type);
}

module.exports = { PLANS, DEFAULT_PLAN_BY_TYPE, getPlan, plansForType };
