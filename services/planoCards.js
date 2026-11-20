// ============================================
// services/planoCards.js
// Dados dos cards de plano PRO (mensal e anual) das páginas públicas
// /para-devs e /para-empresas. Mesmo conteúdo e mesma regra de exibição dos
// cards de /planos (views/planos.ejs, logado): preço, desconto do anual e
// benefícios saem de config/plans.js.
// ============================================
const { getPlan } = require("../config/plans");

// "R$99,99" (sem espaço), como em /planos.
function moeda(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, "");
}

function descontoAnual(plan) {
  if (!plan.annual_price_cents) return 0;
  return Math.round((1 - plan.annual_price_cents / (plan.price_cents * 12)) * 100);
}

// Mesma lista que /planos mostra para o dev PRO (limites de roadmap + recursos).
function beneficiosDev(plan) {
  const r = plan.roadmap || {}, f = plan.features || {};
  const itens = [];
  if (r.max_ativos) itens.push(`Até ${r.max_ativos} roadmaps ativos simultaneamente`);
  if (r.regen_intervalo_dias === 7) itens.push("Regeneração de roadmap semanal");
  else if (r.regen_intervalo_dias) itens.push(`Regeneração de roadmap a cada ${r.regen_intervalo_dias} dias`);
  if (f.verificacao_projetos) itens.push("Verificação automática de projetos");
  if (f.mentor_carreira) itens.push("Mentor de Carreira com IA");
  return itens;
}

function cardsPlano(code) {
  const plan = getPlan(code);
  const beneficios = plan.type === "dev" ? beneficiosDev(plan) : (plan.benefits || []);
  const checkout = `/planos/${encodeURIComponent(plan.code)}/assinar`;
  const mensal = {
    periodo: "Mensal",
    nome: `Plano ${plan.name}`,
    preco: moeda(plan.price_cents),
    unidade: "/mês",
    total: "",
    tag: "",
    beneficios,
    href: checkout,
  };
  if (!plan.annual_price_cents) return [mensal];

  const desconto = descontoAnual(plan);
  const anual = {
    periodo: "Anual",
    nome: `Plano ${plan.name}`,
    preco: moeda(Math.round(plan.annual_price_cents / 12)), // destaque no equivalente mensal
    unidade: "/mês",
    total: `Ou ${moeda(plan.annual_price_cents)} à vista`,
    tag: desconto > 0 ? `${desconto}% Desconto` : "",
    beneficios,
    href: `${checkout}?periodo=anual`,
  };
  return [mensal, anual];
}

module.exports = { cardsPlano };
