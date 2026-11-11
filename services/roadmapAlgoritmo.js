// ============================================
// services/roadmapAlgoritmo.js
// Monta as fases/etapas/projetos do roadmap SEM IA: função pura (gap →
// trilha), determinística, personalizada pelo objetivo:
//   - só entram as skills com gap (o que o usuário já tem fica de fora);
//   - a profundidade vem da vaga: nível (estagio/junior/pleno) para as
//     obrigatórias, só o passo inicial para as desejáveis; em objetivo por
//     área, o nivel_esperado de cada skill;
//   - o passo inicial respeita o nível que o usuário já tem na skill;
//   - a ordem segue o learn_order da vaga e, no empate, a ordem canônica de
//     estudo dos modelos (HTML antes de JavaScript, JavaScript antes de React);
//   - desejáveis ficam numa fase final "Diferenciais da vaga".
//
// O catálogo de passos (título, descrição, horas) é o próprio conteúdo de
// data/roadmaps-modelo/*.json; skill sem passos no catálogo ganha passos
// genéricos. Links de estudo NÃO são decididos aqui — vêm da tabela curada
// `recursos` (ver escolherRecurso em services/roadmapService.js).
// ============================================
const fs   = require("fs");
const path = require("path");
const { NIVEL_ORDER, LEVEL_ORDER } = require("./niveis");

const MODELOS_DIR = path.join(__dirname, "..", "data", "roadmaps-modelo");
const NIVEIS = ["iniciante", "intermediario", "avancado"];

const ETAPAS_POR_FASE = 4;  // tamanho-alvo de uma fase
const ETAPAS_MAX_FASE = 6;  // teto de uma fase

// ──────────────────────────────────────────────────────────
// Catálogo: habilidade → passos (por área) + posição canônica de estudo
// ──────────────────────────────────────────────────────────

let catalogoCache = null;

function carregarCatalogo() {
  if (catalogoCache) return catalogoCache;

  const porHabilidade = {}; // habilidade → { passosPorArea: {area: [..]}, posicoes: [0..1] }

  const arquivos = fs.readdirSync(MODELOS_DIR).filter(f => f.endsWith(".json")).sort();
  for (const arquivo of arquivos) {
    const modelo = JSON.parse(fs.readFileSync(path.join(MODELOS_DIR, arquivo), "utf8"));
    const area   = modelo.area ?? arquivo.replace(/\.json$/, "");
    const etapas = (modelo.fases ?? []).flatMap(f => f.etapas ?? []);

    etapas.forEach((e, i) => {
      const item = (porHabilidade[e.habilidade] ??= { passosPorArea: {}, posicoes: [] });
      (item.passosPorArea[area] ??= []).push({
        titulo: e.titulo, descricao: e.descricao, horas_estimadas: e.horas_estimadas,
      });
      item.posicoes.push(etapas.length > 1 ? i / (etapas.length - 1) : 0);
    });
  }

  const catalogo = {};
  for (const [habilidade, item] of Object.entries(porHabilidade)) {
    catalogo[habilidade] = {
      passosPorArea: item.passosPorArea,
      rank: item.posicoes.reduce((a, b) => a + b, 0) / item.posicoes.length,
    };
  }
  catalogoCache = catalogo;
  return catalogo;
}

// Passos de uma skill: os da área do objetivo se existirem; senão, o modelo
// que mais detalha a skill (mais passos); senão, genéricos.
function passosDa(habilidade, area) {
  const item = carregarCatalogo()[habilidade];
  if (item) {
    if (area && item.passosPorArea[area]) return item.passosPorArea[area];
    return Object.values(item.passosPorArea).sort((a, b) => b.length - a.length)[0];
  }
  return [
    {
      titulo: `${habilidade}: fundamentos`,
      descricao: `Estudar os conceitos essenciais de ${habilidade} e praticar com exercícios curtos.`,
      horas_estimadas: 6,
    },
    {
      titulo: `${habilidade}: prática aplicada`,
      descricao: `Aplicar ${habilidade} em um mini-projeto, seguindo a documentação oficial e boas práticas.`,
      horas_estimadas: 8,
    },
    {
      titulo: `${habilidade}: aprofundamento`,
      descricao: `Aprofundar ${habilidade} com casos reais de mercado, desempenho e boas práticas.`,
      horas_estimadas: 10,
    },
  ];
}

function rankDa(habilidade) {
  return carregarCatalogo()[habilidade]?.rank ?? 0.5;
}

// ──────────────────────────────────────────────────────────
// Profundidade: quais passos de cada skill entram
// ──────────────────────────────────────────────────────────

// Índice do nível-alvo (0 = iniciante … 2 = avançado) que o objetivo pede.
function alvoDoRequisito(gap, r) {
  if (gap.tipo === "area") return NIVEL_ORDER[r.nivel_esperado] ?? 0;
  if (r.importancia === "desejavel") return 0;
  return LEVEL_ORDER[gap.nivelVaga] ?? 0;
}

function etapasDoRequisito(gap, r) {
  const todos  = passosDa(r.habilidade, gap.area);
  const alvo   = alvoDoRequisito(gap, r);
  const inicio = r.nivel_atual ? (NIVEL_ORDER[r.nivel_atual] ?? -1) + 1 : 0;

  let passos = todos.slice(inicio, alvo + 1).map((p, k) => ({ ...p, idx: inicio + k }));
  // Tem gap mas o catálogo não detalha o nível seguinte: nunca deixa a skill
  // sem etapa — acrescenta um passo de aprofundamento.
  if (!passos.length) {
    passos = [{
      titulo: `${r.habilidade}: aprofundamento`,
      descricao: `Aprofundar ${r.habilidade} até o nível pedido, com exercícios e um mini-projeto.`,
      horas_estimadas: 6,
      idx: inicio,
    }];
  }

  return passos.map(p => ({
    titulo: p.titulo,
    descricao: p.descricao,
    habilidade: r.habilidade,
    horas_estimadas: p.horas_estimadas,
    nivel_atual: NIVEIS[Math.min(p.idx, NIVEIS.length - 1)], // nível-alvo do passo (casa recursos por nível)
  }));
}

// ──────────────────────────────────────────────────────────
// Fases
// ──────────────────────────────────────────────────────────

function porOrdemDeEstudo(a, b) {
  const oa = a.ordem ?? Infinity, ob = b.ordem ?? Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  const ra = rankDa(a.habilidade), rb = rankDa(b.habilidade);
  if (ra !== rb) return ra - rb;
  return a.habilidade.localeCompare(b.habilidade, "pt-BR");
}

// Agrupa as etapas (já organizadas por skill, na ordem de estudo) em ~`n`
// fases de tamanho parecido, sem separar os passos de uma mesma skill entre
// duas fases e sem passar de ETAPAS_MAX_FASE por fase.
function dividirPorSkill(grupos, n) {
  const total = grupos.reduce((soma, g) => soma + g.length, 0);
  const alvo = total / n;
  const blocos = [];
  let atual = [];
  for (const grupo of grupos) {
    const estoura    = atual.length + grupo.length > ETAPAS_MAX_FASE;
    const passaDoAlvo = atual.length + grupo.length > alvo + 0.5 && blocos.length < n - 1;
    if (atual.length && (estoura || passaDoAlvo)) {
      blocos.push(atual);
      atual = [];
    }
    atual.push(...grupo);
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

function numeroDeFases(qtdEtapas) {
  if (!qtdEtapas) return 0;
  return Math.max(Math.ceil(qtdEtapas / ETAPAS_POR_FASE), Math.ceil(qtdEtapas / ETAPAS_MAX_FASE));
}

function listaNatural(nomes, max = 4) {
  if (nomes.length <= max) {
    return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
  }
  return `${nomes.slice(0, max).join(", ")} e mais ${nomes.length - max}`;
}

function montarFase(etapas, { numero, diferenciais, gap }) {
  const habilidades = [...new Set(etapas.map(e => e.habilidade))];
  const lista = listaNatural(habilidades);

  const nome = diferenciais
    ? (gap.tipo === "vaga" ? "Diferenciais da vaga" : "Aprofundamento")
    : `Fase ${numero}: ${listaNatural(habilidades, 2)}`;

  let objetivo;
  if (diferenciais) objetivo = `Ampliar seu perfil com as skills desejáveis ${gap.tipo === "vaga" ? "da vaga" : "da área"}: ${lista}.`;
  else if (gap.tipo === "vaga") objetivo = `Chegar ao nível pedido pela vaga em ${lista}.`;
  else objetivo = `Chegar ao nível esperado para a área em ${lista}.`;

  let enunciado = `Construa um projeto prático que use ${lista} e publique o código em um repositório público no GitHub.`;
  if (gap.tipo === "vaga" && gap.vagaTitulo) {
    enunciado += ` Simule uma entrega típica da vaga "${String(gap.vagaTitulo).slice(0, 80)}".`;
  }

  return { nome, objetivo, etapas, projeto: { enunciado, habilidades } };
}

/**
 * gap = saída de montarGap (services/roadmapService.js):
 *   { tipo: 'vaga'|'area', area, nivelVaga?, vagaTitulo?,
 *     requisitos: [{ habilidade, importancia?, ordem?, nivel_atual, nivel_esperado?, tem_gap }] }
 * Devolve { fases: [{ nome, objetivo, etapas, projeto }] }; lança erro se não
 * houver nada a estudar.
 */
function montarFases(gap) {
  const comGap = (gap.requisitos ?? []).filter(r => r.tem_gap);

  const obrigatorias = comGap.filter(r => r.importancia !== "desejavel").sort(porOrdemDeEstudo);
  const desejaveis   = comGap.filter(r => r.importancia === "desejavel").sort(porOrdemDeEstudo);

  const gruposObrig = obrigatorias.map(r => etapasDoRequisito(gap, r));
  const gruposDesej = desejaveis.map(r => etapasDoRequisito(gap, r));
  const qtd = (grupos) => grupos.reduce((soma, g) => soma + g.length, 0);

  if (!qtd(gruposObrig) && !qtd(gruposDesej)) {
    throw new Error("Você já atende a todos os requisitos deste objetivo — não há nada a estudar por enquanto.");
  }

  const fases = [];
  let numero = 1;
  if (gruposObrig.length) {
    for (const bloco of dividirPorSkill(gruposObrig, numeroDeFases(qtd(gruposObrig)))) {
      fases.push(montarFase(bloco, { numero: numero++, diferenciais: false, gap }));
    }
  }
  if (gruposDesej.length) {
    for (const bloco of dividirPorSkill(gruposDesej, numeroDeFases(qtd(gruposDesej)))) {
      fases.push(montarFase(bloco, { numero: numero++, diferenciais: true, gap }));
    }
  }

  return { fases };
}

module.exports = { montarFases };
