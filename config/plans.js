// ============================================
// config/plans.js
// Definição estática dos planos do modelo Freemium
// (ver documentação de monetização).
//
// Objeto estático em vez de tabela: são 4 planos fixos (Free e PRO para
// devs e para empresas), sem UI de "criar plano novo" prevista.
//
// Cada plano pago tem duas formas de pagamento:
//   - MENSAL (price_cents): assinatura recorrente no Mercado Pago;
//   - ANUAL (annual_price_cents): pagamento único do ano — à vista ou em
//     até MAX_PARCELAS_ANUAL vezes no cartão — que libera o plano por
//     MESES_PLANO_ANUAL meses, sem renovação automática (o Mercado Pago não
//     parcela assinaturas recorrentes). Ver services/mpAnnual.js.
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
      verificacao_projetos:  false, // análise de repositório do projeto da fase — Free fecha por autodeclaração
    },
    // Limites do sistema de Roadmap (fases/etapas por algoritmo — docs/roadmap-spec.md,
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
    price_cents:        2490,  // R$ 24,90 por mês (mensal recorrente)
    annual_price_cents: 23880, // R$ 238,80 por ano = R$ 19,90 × 12
    features: {
      roadmap_personalizado: true,
      destaque_perfil:       true,
      mentor_carreira:       true, // chatbot de mentoria de carreira (IA), com simulação de entrevista técnica
      verificacao_projetos:  true,
    },
    roadmap: {
      max_ativos:           5,
      regen_intervalo_dias: 7, // 1 regeneração por semana
    },
    benefits: [
      "Roadmap com cursos e vídeos recomendados",
      "Mentor de carreira com IA, com simulação de entrevista técnica",
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
  // O código continua "empresa_premium" (é o que está gravado nas assinaturas
  // e nos planos liberados pelo admin); para o usuário o plano se chama PRO.
  empresa_premium: {
    type: "empresa",
    code: "empresa_premium",
    name: "PRO",
    price_cents:        9999,  // R$ 99,99 por mês (mensal recorrente)
    annual_price_cents: 95880, // R$ 958,80 por ano = R$ 79,90 × 12
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

// ── Plano anual (pagamento único) ──────────────────────────
const MAX_PARCELAS_ANUAL = 12; // parcelas no cartão (sem juros para o cliente: configurado na conta do MP)
const MESES_PLANO_ANUAL  = 12; // meses de acesso liberados por um pagamento anual

function hasAnnualOption(plan) {
  return isPaidPlan(plan) && Number(plan.annual_price_cents) > 0;
}

/** Valor do ano em reais (ex.: 238.8), no formato que o Mercado Pago espera. */
function annualAmount(plan) {
  return plan.annual_price_cents / 100;
}

/** Equivalente mensal do anual, em centavos (ex.: 1990), para exibição. */
function annualMonthlyCents(plan) {
  return Math.round(plan.annual_price_cents / MESES_PLANO_ANUAL);
}

module.exports = {
  PLANS, DEFAULT_PLAN_BY_TYPE, getPlan, plansForType, isPaidPlan, paidPlans, planAmount,
  MAX_PARCELAS_ANUAL, MESES_PLANO_ANUAL, hasAnnualOption, annualAmount, annualMonthlyCents,
};
