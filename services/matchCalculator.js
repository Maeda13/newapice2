// ============================================
// services/matchCalculator.js
// Calcula % de compatibilidade entre um dev e uma vaga — fonte única do
// match no site todo: páginas de vagas do dev, roadmap, matchs e
// candidaturas da empresa, relatórios do admin e o Mentor.
//
//   Skills      = skills da vaga que o dev tem ÷ total de skills da vaga
//   Senioridade = 100 se o nível do dev atende ao da vaga; 55 um nível
//                 abaixo; 10 dois níveis abaixo (services/niveis.js)
//   Match       = Skills × 70% + Senioridade × 30%   (PESOS_MATCH)
//
// "Tem a skill" (possuiSkill): está no perfil (user_skills, que já inclui o
// que a análise dos repositórios detectou e o que o dev declarou) ou é a
// habilidade de um módulo concluído num roadmap dele. Os nomes são
// comparados sem diferenciar maiúsculas e acentos, e nomes equivalentes
// contam como a mesma skill (chaveSkill: "React" = "React.js",
// "Node" = "Node.js", "REST API" = "APIs REST").
//
// Dev sem nenhuma skill → match 0. Vaga sem skills → nota de skills 100
// (não penaliza); sem nível do dev, a senioridade também não penaliza.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

// Mapeamentos ordinais — fonte única em services/niveis.js
const { NIVEL_ORDER, LEVEL_ORDER } = require("./niveis");

// Pesos do match geral (somam 1). Mude aqui para ajustar o site todo.
const PESOS_MATCH = Object.freeze({ skills: 0.7, senioridade: 0.3 });

// Faixas de cor do match (número e barras): até `ate`, inclusive.
const FAIXAS_MATCH = Object.freeze([
  Object.freeze({ ate: 19,  faixa: "muito-baixo" }), // vermelho  #DC2626
  Object.freeze({ ate: 39,  faixa: "baixo" }),       // laranja   #F97316
  Object.freeze({ ate: 69,  faixa: "medio" }),       // amarelo   #EAB308
  Object.freeze({ ate: 100, faixa: "alto" }),        // verde     #4ADE80
]);

function faixaDoMatch(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return FAIXAS_MATCH.find(f => n <= f.ate).faixa;
}

const MATCH_IA_SYSTEM_PROMPT = `Você explica, em português, de forma breve (2-3 frases) e
direta, por que um candidato tem um determinado percentual de compatibilidade com uma vaga
de tecnologia. Responda SEMPRE em JSON puro (sem markdown) no formato exato:
{ "percentual_ia": <inteiro 0-100>, "explicacao": "string" }
O percentual_ia deve ficar próximo do percentual calculado informado — pequenos ajustes são
aceitáveis se a explicação justificar, mas não invente uma nota muito distante da calculada.`;

// ──────────────────────────────────────────────────────────
// Nomes de skill: a mesma skill escrita de jeitos diferentes vira a
// mesma chave. Depois de tirar acentos, maiúsculas, o ".js" do fim e tudo
// que não é letra/número (+ e # ficam, por C++ e C#), os sinônimos abaixo
// apontam para uma chave só.
// ──────────────────────────────────────────────────────────
const SINONIMOS = Object.freeze({
  js: "javascript", ecmascript: "javascript",
  ts: "typescript",
  restapi: "rest", restapis: "rest", apirest: "rest", apisrest: "rest",
  restful: "rest", restfulapi: "rest", restfulapis: "rest", apisrestful: "rest",
  html5: "html", css3: "css",
  postgres: "postgresql",
  golang: "go",
  k8s: "kubernetes",
  dotnet: "net", aspnet: "net", aspnetcore: "net",
  rails: "rubyonrails", ror: "rubyonrails",
  springboot: "spring", springframework: "spring",
  mongodb: "mongo",
});

function chaveSkill(nome) {
  let k = String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (SINONIMOS[k.replace(/[^a-z0-9+#]/g, "")] === "javascript") return "javascript"; // "JS" sozinho
  k = k.replace(/\.?\s*js$/, "");          // "React.js" / "ReactJS" / "Node.js" → "react" / "node"
  k = k.replace(/[^a-z0-9+#]/g, "");
  return SINONIMOS[k] ?? k;
}

// ──────────────────────────────────────────────────────────
// Perfil de skills de um dev para o match:
//   porId:   { skill_id: confiança } (user_skills; tem = confiança > 0)
//   porNome: Set de chaveSkill() das skills que ele tem e das habilidades
//            dos módulos concluídos nos roadmaps dele
// As funções puras aceitam também só o mapa { skill_id: confiança }.
// ──────────────────────────────────────────────────────────
function comoPerfil(perfil) {
  if (perfil && perfil.porId && perfil.porNome) return perfil;
  return { porId: perfil ?? {}, porNome: new Set() };
}

function perfilVazio() {
  return { porId: {}, porNome: new Set() };
}

function temAlgumaSkill(perfil) {
  const p = comoPerfil(perfil);
  return p.porNome.size > 0 || Object.values(p.porId).some(c => Number(c) > 0);
}

/** O dev tem esta skill da vaga ({ skill_id, name })? */
function possuiSkill(perfil, jobSkill) {
  const p = comoPerfil(perfil);
  if ((Number(p.porId[jobSkill.skill_id]) || 0) > 0) return true;
  return jobSkill.name != null && p.porNome.has(chaveSkill(jobSkill.name));
}

// ──────────────────────────────────────────────────────────
// Núcleo puro do cálculo de match — única fonte de verdade.
// ──────────────────────────────────────────────────────────

/** Nota de skills (0-100): skills da vaga que o dev tem ÷ total de skills da vaga. */
function computeSkillsScore(perfil, jobSkills) {
  if (!jobSkills.length) return 100;
  const p = comoPerfil(perfil);
  const tem = jobSkills.filter(js => possuiSkill(p, js)).length;
  return Math.round((tem / jobSkills.length) * 100);
}

/** Nota de senioridade (0-100) — nível do dev vs level da vaga. */
function computeSeniorityScore(nivel, jobLevel) {
  const userRank = NIVEL_ORDER[nivel] ?? -1;
  const jobRank  = LEVEL_ORDER[jobLevel] ?? -1;
  if (userRank < 0 || jobRank < 0) return 100;
  const diff = jobRank - userRank;
  return diff <= 0 ? 100 : diff === 1 ? 55 : 10;
}

/** Match final (0-100): média das notas de skills e senioridade com os pesos de PESOS_MATCH. */
function computeMatch(perfil, jobSkills, nivel, jobLevel) {
  if (!temAlgumaSkill(perfil)) return 0;
  const skillsScore    = computeSkillsScore(perfil, jobSkills);
  const seniorityScore = nivel ? computeSeniorityScore(nivel, jobLevel) : 100;
  return Math.min(100, Math.round(skillsScore * PESOS_MATCH.skills + seniorityScore * PESOS_MATCH.senioridade));
}

// ──────────────────────────────────────────────────────────
// Carrega o perfil de skills de vários devs de uma vez (visão da empresa,
// relatórios) ou de um só (visão do dev).
//   devs: [{ chave, usuarioId }]
//     chave     = a chave de user_skills (github_id, ou o id interno de
//                 quem não tem GitHub — ver getUserId nos controllers)
//     usuarioId = users.id, dono dos roadmaps (opcional)
// Retorna Map(String(chave) → perfil).
// ──────────────────────────────────────────────────────────
async function carregarPerfis(conn, devs) {
  const perfis = new Map();
  const comChave = devs.filter(d => d && d.chave != null);
  for (const d of comChave) if (!perfis.has(String(d.chave))) perfis.set(String(d.chave), perfilVazio());
  if (!perfis.size) return perfis;

  const [skills] = await conn.query(
    `SELECT us.github_id, us.skill_id, us.confidence, s.name
     FROM user_skills us JOIN skills s ON s.id = us.skill_id
     WHERE us.github_id IN (?) AND us.confidence > 0`,
    [[...perfis.keys()]]
  );
  for (const s of skills) {
    const p = perfis.get(String(s.github_id));
    if (!p) continue;
    p.porId[s.skill_id] = Number(s.confidence);
    if (s.name) p.porNome.add(chaveSkill(s.name));
  }

  // Módulos concluídos nos roadmaps: a habilidade do módulo conta como adquirida.
  const chavePorUsuario = new Map();
  for (const d of comChave) if (d.usuarioId != null) chavePorUsuario.set(Number(d.usuarioId), String(d.chave));
  if (chavePorUsuario.size) {
    try {
      const [etapas] = await conn.query(
        `SELECT DISTINCT r.usuario_id, re.habilidade
         FROM roadmaps r
         JOIN roadmap_fases rf  ON rf.roadmap_id = r.id
         JOIN roadmap_etapas re ON re.fase_id = rf.id
         WHERE r.usuario_id IN (?) AND re.status = 'concluida'`,
        [[...chavePorUsuario.keys()]]
      );
      for (const e of etapas) if (e.habilidade) perfis.get(chavePorUsuario.get(Number(e.usuario_id)))?.porNome.add(chaveSkill(e.habilidade));
    } catch (err) {
      // Sem os roadmaps (tabela ainda não criada, falha na consulta), o match
      // segue só com o perfil — não derruba a página da vaga nem as telas da empresa.
      if (err.code !== "ER_NO_SUCH_TABLE") console.error("[match] módulos concluídos do roadmap:", err.message);
    }
  }
  return perfis;
}

// users.id do dono de uma chave de user_skills: o perfil com esse github_id,
// ou a própria chave (contas sem GitHub usam o id interno).
async function _usuarioDaChave(chave) {
  try {
    const [rows] = await db.query("SELECT user_id FROM user_dev_profiles WHERE github_id = ? LIMIT 1", [chave]);
    return rows[0]?.user_id ?? chave;
  } catch (err) {
    console.error("[match] dono da chave de skills:", err.message);
    return chave;
  }
}

async function calculateJobMatch(skillsId, jobId, profileData = {}) {
  // ── 1. Skills da vaga ─────────────────────────────
  const [jobSkills] = await db.query(`
    SELECT js.skill_id, js.importance, js.learn_order, s.name, s.type
    FROM job_skills js
    JOIN skills s ON s.id = js.skill_id
    WHERE js.job_id = ?
    ORDER BY js.learn_order
  `, [jobId]);

  // ── 2. Perfil de skills do dev ────────────────────
  const usuarioId = profileData.usuarioId ?? await _usuarioDaChave(skillsId);
  const perfis = await carregarPerfis(db, [{ chave: skillsId, usuarioId }]);
  const perfil = perfis.get(String(skillsId)) ?? perfilVazio();

  // "Compatibilidade ao concluir o roadmap" (docs/roadmap-spec.md,
  // "Integrações"): projeta as habilidades do roadmap ativo como já
  // adquiridas, reaproveitando a MESMA fórmula — sem efeito para quem não
  // passa esse campo.
  for (const h of profileData.habilidadesAdquiridas ?? []) perfil.porNome.add(chaveSkill(h));

  // ── 3. Skill a skill (✓ / ✕ na página da vaga, roadmap) ───
  const breakdown = jobSkills.map(js => ({
    skill_id:    js.skill_id,
    skill_name:  js.name,
    skill_type:  js.type,
    importance:  js.importance,
    learn_order: js.learn_order,
    has:         possuiSkill(perfil, js),
    confidence:  Number(perfil.porId[js.skill_id]) || 0,
  }));

  // ── 4. Notas ──────────────────────────────────────
  const nivel    = profileData.nivel ?? null;
  // Busca o level da vaga só se for usado (sem nível do dev, a senioridade não conta)
  const jobLevel = nivel ? (profileData.jobLevel ?? await _fetchJobLevel(jobId)) : null;

  const temSkills      = temAlgumaSkill(perfil);
  const skillsScore    = temSkills ? computeSkillsScore(perfil, jobSkills) : 0;
  const seniorityScore = nivel ? computeSeniorityScore(nivel, jobLevel) : 100;
  const matchPercent   = computeMatch(perfil, jobSkills, nivel, jobLevel);

  return {
    match:     matchPercent,
    breakdown,
    readyFor:  matchPercent >= 70,
    perfilVazio: !temSkills,
    scores: {
      skills:    skillsScore,
      seniority: seniorityScore,
    },
  };
}

// Helper para buscar o level da vaga quando não vier em profileData
async function _fetchJobLevel(jobId) {
  const [r] = await db.query("SELECT level FROM jobs WHERE id = ?", [jobId]);
  return r[0]?.level ?? null;
}

// ──────────────────────────────────────────────────────────
// Explicação semântica do match via IA — cacheada por par
// candidato-vaga em match_ia_cache, pra não chamar a IA de novo
// a cada acesso. O percentual numérico continua vindo de
// calculateJobMatch (computeMatch é a única fonte de verdade);
// a IA só complementa com uma explicação em texto.
//
// O cache guarda o percentual CALCULADO usado para gerar a explicação e só
// vale enquanto ele for igual ao match calculado agora: mudou skill, nível ou
// requisito da vaga → a explicação é gerada de novo e substitui a antiga
// (limitação 8 do doc).
// ──────────────────────────────────────────────────────────
async function getMatchExplanation(githubId, jobId, profileData = {}) {
  const match = await calculateJobMatch(githubId, jobId, profileData);

  const [[cached]] = await db.query(
    "SELECT percentual, explicacao FROM match_ia_cache WHERE github_id = ? AND job_id = ?",
    [githubId, jobId]
  );
  if (cached && Number(cached.percentual) === match.match) {
    return { percentual_ia: match.match, explicacao: cached.explicacao };
  }

  // LGPD: só tecnologias/skills e o breakdown do match vão pro prompt —
  // nunca nome, e-mail ou outro dado pessoal do candidato.
  const payload = {
    percentual_calculado: match.match,
    skills: match.breakdown.map(s => ({
      nome:        s.skill_name,
      importancia: s.importance,
      tem_a_skill: s.has,
      confianca:   s.confidence,
    })),
  };

  const result = await askGeminiJSON({
    system: MATCH_IA_SYSTEM_PROMPT,
    prompt: `Dados do match candidato-vaga:\n${JSON.stringify(payload)}`,
    maxTokens: 1536,
    obrigatorios: ["explicacao"], // sem explicação, não grava texto vazio no cache
  });

  const explicacao = result.explicacao;

  // Guarda o percentual calculado (não o que a IA sugeriu) — é ele que diz se
  // a explicação ainda vale. O percentual exibido continua sendo o calculado.
  await db.query(
    `INSERT INTO match_ia_cache (github_id, job_id, percentual, explicacao)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE percentual = VALUES(percentual), explicacao = VALUES(explicacao)`,
    [githubId, jobId, match.match, explicacao]
  );

  return { percentual_ia: match.match, explicacao };
}

module.exports = {
  PESOS_MATCH, FAIXAS_MATCH, faixaDoMatch,
  chaveSkill, possuiSkill, temAlgumaSkill, carregarPerfis,
  calculateJobMatch, computeSkillsScore, computeSeniorityScore, computeMatch,
  getMatchExplanation,
};
