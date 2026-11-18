// ============================================
// services/vagasPublicas.js
// Dados das páginas públicas de vagas — /vagas (vitrine) e /vagas/:id
// (detalhe) —, lidos do banco e já prontos para a view: datas por extenso,
// faixa salarial, idioma, responsabilidades com rótulo, benefícios
// pontuados, área para o filtro e o match do dev logado.
//
// As consultas usam SELECT * em jobs e user_company_profiles de propósito:
// enquanto a migração automática (database/db.js) não criou short_title,
// summary e logo_url, a página continua funcionando com o que existe.
// ============================================
const { calculateJobMatch, faixaDoMatch } = require("./matchCalculator");
const { inferirAreaPorHabilidades } = require("./areaDaVaga");

const NIVEL_LABEL      = Object.freeze({ estagio: "Estágio", junior: "Júnior", pleno: "Pleno" });
const MODALIDADE_LABEL = Object.freeze({ presencial: "Presencial", remoto: "Remoto", hibrido: "Híbrido" });
const IDIOMA_LABEL     = Object.freeze({ ingles: "Inglês", espanhol: "Espanhol", frances: "Francês", alemao: "Alemão", italiano: "Italiano", mandarim: "Mandarim" });
const NIVEL_IDIOMA     = Object.freeze({ nenhum: "Não exigido", basico: "Básico", intermediario: "Intermediário", avancado: "Avançado", fluente: "Fluente" });
// jobs.area (formulário da empresa) → valor do filtro de área da vitrine
const AREA_FILTRO      = Object.freeze({ "front-end": "frontend", "back-end": "backend", "full-stack": "fullstack", dados: "dados" });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ── Formatação (funções puras) ───────────────────────────

/** "15 de outubro de 2026" — de um Date (DATE/TIMESTAMP do mysql2) ou de "2026-10-15". */
function dataPorExtenso(valor) {
  if (valor == null || valor === "") return null;
  let dia, mes, ano;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    [dia, mes, ano] = [valor.getDate(), valor.getMonth(), valor.getFullYear()];
  } else {
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    [ano, mes, dia] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  }
  return `${dia} de ${MESES[mes]} de ${ano}`;
}

/**
 * "2026-10-15" para <time datetime> e o JSON-LD — o MESMO dia de dataPorExtenso
 * (data local, como o mysql2 entrega DATE/TIMESTAMP). toISOString() daria o dia
 * em UTC, um a menos em servidores com fuso positivo.
 */
function dataIso(valor) {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const dois = (n) => String(n).padStart(2, "0");
    return `${valor.getFullYear()}-${dois(valor.getMonth() + 1)}-${dois(valor.getDate())}`;
  }
  const m = String(valor ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Milissegundos para ordenar "Mais recentes" (0 se a data não existe). */
function instante(valor) {
  if (valor instanceof Date) return valor.getTime() || 0;
  const t = Date.parse(valor ?? "");
  return Number.isNaN(t) ? 0 : t;
}

const reais = (n) => `R$ ${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

/** "R$ 1.800 – R$ 2.500", "A partir de R$ 1.800", "Até R$ 2.500" ou null (valores em reais). */
function faixaSalarial(min, max) {
  const a = Number(min) > 0 ? Number(min) : null, b = Number(max) > 0 ? Number(max) : null;
  if (a && b) return a === b ? reais(a) : `${reais(a)} – ${reais(b)}`;
  if (a) return `A partir de ${reais(a)}`;
  if (b) return `Até ${reais(b)}`;
  return null;
}

/** Língua exigida: a escolhida no formulário da vaga; vagas antigas só têm o nível de inglês. */
function idiomaExigido(job) {
  if (job.foreign_language && IDIOMA_LABEL[job.foreign_language]) {
    return { idioma: IDIOMA_LABEL[job.foreign_language], nivel: NIVEL_IDIOMA[job.foreign_level] ?? NIVEL_IDIOMA.basico };
  }
  if (job.english_level && job.english_level !== "nenhum" && NIVEL_IDIOMA[job.english_level]) {
    return { idioma: "Inglês", nivel: NIVEL_IDIOMA[job.english_level] };
  }
  return null;
}

/** "Rio de Janeiro - RJ" → "Rio de Janeiro" (o card da vitrine mostra só a cidade). */
function cidadeDe(local) {
  const s = String(local ?? "").trim();
  if (!s) return null;
  return s.split(/\s+[-–]\s+|,/)[0].trim() || s;
}

/** Tags da vaga (vírgula) em lista. */
function tagsDe(tags) {
  return String(tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
}

/** "Vaga inclusiva" → "Inclusiva" (o card da vitrine é curto). */
function tagCurta(tag) {
  const s = String(tag ?? "").trim().replace(/^vaga\s+/i, "");
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}

const semMarcador = (linha) => linha.replace(/^\s*[•\-*–·]\s*/, "").trim();

/** Linhas de texto em lista, sem marcadores ("• ", "- ") nem linhas vazias. */
function linhasDe(texto) {
  return String(texto ?? "").split(/\r?\n/).map(semMarcador).filter(Boolean);
}

/** Responsabilidades: "Rótulo: texto" vira { rotulo, texto }; sem rótulo curto, só o texto. */
function responsabilidadesDe(texto) {
  return linhasDe(texto).map(linha => {
    const i = linha.indexOf(":");
    if (i > 0 && i <= 40 && linha.slice(i + 1).trim()) {
      return { rotulo: linha.slice(0, i).trim(), texto: linha.slice(i + 1).trim() };
    }
    return { rotulo: null, texto: linha };
  });
}

/** Benefícios: um por linha (ou separados por ";"), cada um terminando em ";" e o último em ".". */
function beneficiosDe(texto) {
  const itens = String(texto ?? "").split(/\r?\n|;/).map(semMarcador).map(b => b.replace(/[;.,]+$/, "").trim()).filter(Boolean);
  return itens.map((b, i) => `${b}${i === itens.length - 1 ? "." : ";"}`);
}

/** Parágrafos da descrição (cada linha com texto vira um parágrafo). */
function paragrafosDe(texto) {
  return linhasDe(texto);
}

/** Área para o filtro: a escolhida pela empresa; sem ela, a inferida pelas skills. */
function areaDoFiltro(job, nomesDasSkills) {
  if (job.area && AREA_FILTRO[job.area]) return AREA_FILTRO[job.area];
  if (!nomesDasSkills.length) return null;
  return AREA_FILTRO[inferirAreaPorHabilidades(nomesDasSkills)] ?? null;
}

/** Iniciais para o logo provisório: "Azyra" → "A", "Tech Corp" → "TC". */
function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  return (partes.length > 1 ? partes[0][0] + partes[1][0] : (partes[0] ?? "?")[0]).toUpperCase();
}

/** Texto em minúsculas e sem acentos, para a busca da vitrine. */
function normalizar(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function empresaDe(job, perfil) {
  const nome = perfil?.nome_fantasia || perfil?.razao_social || job.company || "Empresa";
  return { nome, logo: perfil?.logo_url || null, iniciais: iniciais(nome) };
}

// ── Leitura do banco ─────────────────────────────────────

async function perfisDasEmpresas(conn, ids) {
  const unicos = [...new Set(ids.filter(v => v != null))];
  if (!unicos.length) return new Map();
  const [rows] = await conn.query("SELECT * FROM user_company_profiles WHERE user_id IN (?)", [unicos]);
  return new Map(rows.map(r => [r.user_id, r]));
}

async function skillsDasVagas(conn, jobIds) {
  if (!jobIds.length) return new Map();
  const [rows] = await conn.query(
    `SELECT js.job_id, js.skill_id, s.name
     FROM job_skills js JOIN skills s ON s.id = js.skill_id
     WHERE js.job_id IN (?) ORDER BY js.job_id, js.learn_order, js.id`,
    [jobIds]
  );
  const porVaga = new Map();
  for (const r of rows) {
    if (!porVaga.has(r.job_id)) porVaga.set(r.job_id, []);
    porVaga.get(r.job_id).push({ id: r.skill_id, nome: r.name });
  }
  return porVaga;
}

/** Vagas ativas da vitrine, das mais recentes para as mais antigas. */
async function listarVitrine(conn) {
  const [jobs] = await conn.query("SELECT * FROM jobs WHERE active = 1 ORDER BY created_at DESC, id DESC LIMIT 500");
  const empresas = await perfisDasEmpresas(conn, jobs.map(j => j.company_id));
  const skills   = await skillsDasVagas(conn, jobs.map(j => j.id));

  return jobs.map(job => {
    const empresa = empresaDe(job, empresas.get(job.company_id));
    const lista   = (skills.get(job.id) ?? []).map(s => s.nome);
    const tags    = tagsDe(job.tags);
    const titulo  = job.short_title || job.title;
    const resumo  = job.summary || job.description || "";
    return {
      id: job.id,
      titulo,
      resumo,
      empresa,
      cidade: cidadeDe(job.location),
      modalidade: MODALIDADE_LABEL[job.modality] ?? null,
      tag: tags.length ? tagCurta(tags[0]) : null,
      skills: lista.slice(0, 3),
      nivel: job.level,
      area: areaDoFiltro(job, lista),
      publicada: instante(job.created_at),
      busca: normalizar([titulo, job.title, empresa.nome, resumo, ...lista].join(" ")),
    };
  });
}

/** Mensagem embaixo da barra do match. */
function mensagemDoMatch(pct) {
  return pct >= 100
    ? "Você atende a todos os requisitos desta vaga!"
    : "Você está a poucos módulos de aumentar a sua compatibilidade!";
}

/**
 * Card "Seu match com a vaga". Visitante e dev sem skills veem 0% com o
 * convite para entrar / completar o perfil; empresa não tem match (null).
 */
function cardDoMatch({ viewer, match, skills, job }) {
  if (viewer === "empresa") return null;
  const requisito = NIVEL_LABEL[job.level] ?? null;
  const zerado = (convite) => ({
    total: 0, faixa: faixaDoMatch(0), convite,
    skills: { pct: 0, faixa: faixaDoMatch(0), itens: skills.map(s => ({ nome: s.nome, tem: null })) },
    senioridade: { pct: 0, faixa: faixaDoMatch(0), atende: null, requisito },
  });
  if (viewer !== "dev") {
    return zerado({ texto: "Entre e complete seu perfil para ver a sua compatibilidade com esta vaga.", link: `/login?next=/vagas/${job.id}`, acao: "Entrar" });
  }
  if (!match || match.perfilVazio) {
    return zerado({ texto: "Complete seu perfil com as suas skills (ou conecte o GitHub) para ver a sua compatibilidade.", link: "/perfil", acao: "Completar perfil" });
  }
  const tem = new Map(match.breakdown.map(b => [b.skill_id, b.has]));
  return {
    total: match.match,
    faixa: faixaDoMatch(match.match),
    mensagem: mensagemDoMatch(match.match),
    skills: {
      pct: match.scores.skills, faixa: faixaDoMatch(match.scores.skills),
      itens: skills.map(s => ({ nome: s.nome, tem: tem.get(s.id) ?? false })),
    },
    senioridade: {
      pct: match.scores.seniority, faixa: faixaDoMatch(match.scores.seniority),
      atende: match.scores.seniority >= 100, requisito,
    },
  };
}

/**
 * Detalhe de uma vaga para /vagas/:id, ou null se não existe.
 * sessionUser: req.session.user (ou undefined para visitante).
 */
async function detalheDaVaga(conn, jobId, sessionUser) {
  const [rows] = await conn.query("SELECT * FROM jobs WHERE id = ?", [jobId]);
  const job = rows[0];
  if (!job) return null;

  const viewer  = sessionUser?.type === "empresa" ? "empresa" : sessionUser?.type === "dev" ? "dev" : "visitante";
  const empresa = empresaDe(job, (await perfisDasEmpresas(conn, [job.company_id])).get(job.company_id));
  const skills  = (await skillsDasVagas(conn, [job.id])).get(job.id) ?? [];

  let match = null, applied = false;
  if (viewer === "dev") {
    const chave = sessionUser.github_id ?? sessionUser.id; // mesma chave de user_skills (getUserId)
    match = await calculateJobMatch(chave, job.id, { nivel: sessionUser.nivel, jobLevel: job.level, usuarioId: sessionUser.id });
    const [ap] = await conn.query("SELECT id FROM job_applications WHERE job_id = ? AND dev_github_id = ?", [job.id, chave]);
    applied = ap.length > 0;
  }

  const idioma = idiomaExigido(job);
  return {
    viewer,
    isOwner: viewer === "empresa" && job.company_id === sessionUser.id,
    applied,
    vaga: {
      id: job.id,
      titulo: job.title,
      ativa: Boolean(job.active),
      empresa,
      publicadaEm: dataPorExtenso(job.created_at),
      inscricoesAte: dataPorExtenso(job.expires_at),
      local: job.location ? String(job.location).trim() : null,
      modalidade: MODALIDADE_LABEL[job.modality] ?? null,
      tags: tagsDe(job.tags),
      nivel: NIVEL_LABEL[job.level] ?? null,
      paragrafos: paragrafosDe(job.description),
      responsabilidades: responsabilidadesDe(job.responsibilities),
      beneficios: beneficiosDe(job.benefits),
      salario: faixaSalarial(job.salary_min, job.salary_max),
      salarioMin: Number(job.salary_min) || null,
      salarioMax: Number(job.salary_max) || null,
      idioma,
      descricaoCurta: String(job.summary || job.description || "").replace(/\s+/g, " ").trim().slice(0, 200),
      publicadaIso: dataIso(job.created_at),
      expiraIso: dataIso(job.expires_at),
    },
    match: cardDoMatch({ viewer, match, skills, job }),
  };
}

module.exports = {
  listarVitrine, detalheDaVaga,
  // formatação (exportada para os testes)
  dataPorExtenso, dataIso, faixaSalarial, idiomaExigido, cidadeDe, tagsDe, tagCurta,
  responsabilidadesDe, beneficiosDe, paragrafosDe, areaDoFiltro, iniciais, normalizar, cardDoMatch,
  NIVEL_LABEL, MODALIDADE_LABEL,
};
