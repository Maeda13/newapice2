// Planos reais de config/plans.js + um plano pago extra de empresa, SÓ PARA
// OS TESTES. No produto há um plano pago por tipo de conta (PRO), mas a
// troca entre planos pagos (changePlan, "melhor plano vale") continua no
// código — este plano permite testá-la.
//
// Uso (no topo do arquivo de teste):
//   jest.mock("../../config/plans", () => require("./helpers/planosDeTeste").comPlanoExtra());
const PLANO_EXTRA = {
  type: "empresa",
  code: "empresa_basico",
  name: "Básico (teste)",
  price_cents: 4990,
  max_active_jobs: 3,
  benefits: ["Até 3 vagas ativas ao mesmo tempo"],
};

function comPlanoExtra() {
  const real = jest.requireActual("../../../config/plans");
  const PLANS = { ...real.PLANS, [PLANO_EXTRA.code]: PLANO_EXTRA };
  const getPlan = code => (Object.hasOwn(PLANS, code) ? PLANS[code] : null);
  return {
    ...real,
    PLANS,
    getPlan,
    plansForType: type => Object.values(PLANS).filter(p => p.type === type),
    paidPlans: () => Object.values(PLANS).filter(real.isPaidPlan),
  };
}

// Valor mensal de cada plano como o Mercado Pago espera (ex.: 24.9).
function valorMp(code) {
  const real = jest.requireActual("../../../config/plans");
  const plan = code === PLANO_EXTRA.code ? PLANO_EXTRA : real.getPlan(code);
  return plan.price_cents / 100;
}

module.exports = { comPlanoExtra, valorMp, PLANO_EXTRA };
