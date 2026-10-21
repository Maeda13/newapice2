// ============================================
// config/plans.js
// Definição estática dos planos do modelo Freemium
// (ver documentação de monetização).
//
// Objeto estático em vez de tabela: são 5 planos fixos,
// sem UI de "criar plano novo" prevista no escopo atual.
//
// Assinatura paga: a cobrança mensal é feita pelo Mercado Pago
// (ver services/mpSubscriptions.js). O `mp_plan_id` de cada plano
// pago NÃO fica aqui: ele depende da conta do Mercado Pago em uso
// (credenciais de teste geram planos diferentes das de produção),
// então é criado na subida do servidor (services/mpPlanSync.js, ou à mão
// com `npm run mp:sync-plans`) e salvo na tabela
// mp_plans — ver getMpPlanId() em services/mpSubscriptions.js.
// O preço cobrado sempre sai daqui (price_cents), nunca do front.
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
      mentor_carreira:       false,
      simulador_entrevista:  false,
      verificacao_projetos:  false, // análise de repositório do projeto da fase — Free fecha por autodeclaração
    },
    // Limites do sistema de Roadmap (fases/etapas via IA — docs/roadmap-spec.md,
    // seção "Planos Free e PRO"). Mesmo padrão de max_active_jobs abaixo:
    // limite numérico fica no plano, não espalhado pelo código.
    roadmap: {
      max_ativos:           1,
      regen_intervalo_dias: 30, // 1 regeneração por mês
    },
    benefits: [
      "Análise das suas skills a partir do GitHub",
      "Vagas com percentual de compatibilidade",
      "Roadmap com as skills que faltam para a vaga",
    ],
  },
  dev_pro: {
    type: "dev",
    code: "dev_pro",
    name: "PRO",
    price_cents: 1990,
    features: {
      roadmap_personalizado: true,
      destaque_perfil:       true,
      mentor_carreira:       true, // chatbot de mentoria de carreira (IA)
      simulador_entrevista:  true, // simulador de entrevista técnica (IA)
      verificacao_projetos:  true,
    },
    roadmap: {
      max_ativos:           5,
      regen_intervalo_dias: 7, // 1 regeneração por semana
    },
    benefits: [
      "Roadmap com cursos e vídeos recomendados",
      "Mentor de carreira com IA",
      "Simulador de entrevista técnica com IA",
      "Destaque do seu perfil para empresas",
    ],
  },

  empresa_free: {
    type: "empresa",
    code: "empresa_free",
    name: "Free",
    price_cents: 0,
    max_active_jobs: 1,
    benefits: [
      "1 vaga ativa por vez",
      "Desenvolvedores compatíveis com a vaga",
    ],
  },
  empresa_basico: {
    type: "empresa",
    code: "empresa_basico",
    name: "Básico",
    price_cents: 4990,
    max_active_jobs: 3,
    benefits: [
      "Até 3 vagas ativas ao mesmo tempo",
      "Desenvolvedores compatíveis com cada vaga",
    ],
  },
  empresa_premium: {
    type: "empresa",
    code: "empresa_premium",
    name: "Premium",
    price_cents: 9990,
    max_active_jobs: null, // null = ilimitado
    benefits: [
      "Vagas ativas ilimitadas",
      "Resumo de candidatos gerado por IA",
      "Desenvolvedores compatíveis com cada vaga",
    ],
  },
};

const DEFAULT_PLAN_BY_TYPE = { dev: "dev_free", empresa: "empresa_free" };

function getPlan(code) {
  // hasOwn: o código vem da URL/do body — não deixa "constructor",
  // "__proto__" etc. resolverem para propriedades herdadas do objeto.
  return Object.hasOwn(PLANS, code) ? PLANS[code] : null;
}

function plansForType(type) {
  return Object.values(PLANS).filter(p => p.type === type);
}

function isPaidPlan(plan) {
  return Boolean(plan) && plan.price_cents > 0;
}

function paidPlans() {
  return Object.values(PLANS).filter(isPaidPlan);
}

/** Valor mensal em reais (ex.: 19.9), no formato que o Mercado Pago espera. */
function planAmount(plan) {
  return plan.price_cents / 100;
}

module.exports = { PLANS, DEFAULT_PLAN_BY_TYPE, getPlan, plansForType, isPaidPlan, paidPlans, planAmount };
