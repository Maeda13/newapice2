// ============================================
// services/matchCalculator.js
// Calcula % de compatibilidade entre usuário e vaga.
//
// Pesos:
//   Skills      → 85%  (obrigatória=peso 2, desejável=peso 1)
//   Senioridade → 15%  (nivel do usuário vs level da vaga)
//
// profileData é opcional — componentes sem dados ficam em 100%
// (não penalizam o score quando informação não disponível).
// ============================================
const db = require("../database/db");

// Mapeamentos ordinais
const NIVEL_ORDER  = { iniciante: 0, intermediario: 1, avancado: 2 };
const LEVEL_ORDER  = { estagio: 0, junior: 1, pleno: 2 };

// ──────────────────────────────────────────────────────────
// Núcleo puro do cálculo de match — única fonte de verdade.
// Usado tanto pela visão do dev (roadmap/vaga pública) quanto
// pela visão da empresa (matchs/desenvolvedores), para que o
// mesmo par dev↔vaga sempre mostre o mesmo % nos dois lados.
// ──────────────────────────────────────────────────────────

/** Score de skills (0-100) — obrigatória tem peso 2, desejável peso 1. */
function computeSkillsScore(userSkillMap, jobSkills) {
  if (!jobSkills.length) return 100;
  let totalWeight = 0;
  let userScore   = 0;
  for (const js of jobSkills) {
    const weight     = js.importance === "obrigatoria" ? 2 : 1;
    const confidence = userSkillMap[js.skill_id] ?? 0;
    totalWeight += weight;
    userScore   += (confidence / 100) * weight;
  }
  return totalWeight > 0 ? Math.round((userScore / totalWeight) * 100) : 100;
}

/** Score de senioridade (0-100) — nivel do usuário vs level da vaga. */
function computeSeniorityScore(nivel, jobLevel) {
  const userRank = NIVEL_ORDER[nivel] ?? -1;
  const jobRank  = LEVEL_ORDER[jobLevel] ?? -1;
  if (userRank < 0 || jobRank < 0) return 100;
  const diff = jobRank - userRank;
  return diff <= 0 ? 100 : diff === 1 ? 55 : 10;
}

/** Match final (0-100): skills 85% + senioridade 15%. */
function computeMatch(userSkillMap, jobSkills, nivel, jobLevel) {
  const skillsScore    = computeSkillsScore(userSkillMap, jobSkills);
  const seniorityScore = nivel ? computeSeniorityScore(nivel, jobLevel) : 100;
  return Math.min(100, Math.round(skillsScore * 0.85 + seniorityScore * 0.15));
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

  // ── 2. Skills do usuário ──────────────────────────
  const [userSkillRows] = await db.query(
    "SELECT skill_id, confidence FROM user_skills WHERE github_id = ?",
    [skillsId]
  );

  const userSkillMap = {};
  for (const s of userSkillRows) userSkillMap[s.skill_id] = s.confidence;

  // ── 3. Breakdown por skill (para o roadmap) ───────
  const breakdown = jobSkills.map(js => {
    const confidence = userSkillMap[js.skill_id] ?? 0;
    return {
      skill_id:    js.skill_id,
      skill_name:  js.name,
      skill_type:  js.type,
      importance:  js.importance,
      learn_order: js.learn_order,
      has:         confidence > 0,
      confidence,
    };
  });

  // ── 4. Scores ──────────────────────────────────────
  const skillsScore = computeSkillsScore(userSkillMap, jobSkills);

  let seniorityScore = 100;
  if (profileData.nivel) {
    // Busca o level da vaga se não estiver em profileData
    const jobLevel = profileData.jobLevel ?? await _fetchJobLevel(jobId);
    seniorityScore = computeSeniorityScore(profileData.nivel, jobLevel);
  }

  const matchPercent = Math.min(100, Math.round(
    skillsScore    * 0.85 +
    seniorityScore * 0.15
  ));

  return {
    match:     matchPercent,
    breakdown,
    readyFor:  matchPercent >= 70,
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

module.exports = { calculateJobMatch, computeSkillsScore, computeSeniorityScore, computeMatch };
