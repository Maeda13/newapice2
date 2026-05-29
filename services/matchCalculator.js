// ============================================
// services/matchCalculator.js
// Calcula % de compatibilidade entre usuário e vaga.
//
// Pesos:
//   Skills      → 75%  (obrigatória=peso 2, desejável=peso 1)
//   Senioridade → 15%  (nivel do usuário vs level da vaga)
//   Inglês      →  5%  (ingles do usuário vs english_level da vaga)
//   Experiência →  5%  (anos_experiencia do usuário vs years_experience)
//
// profileData é opcional — componentes sem dados ficam em 100%
// (não penalizam o score quando informação não disponível).
// ============================================
const db = require("../database/db");

// Mapeamentos ordinais
const NIVEL_ORDER  = { iniciante: 0, intermediario: 1, avancado: 2 };
const LEVEL_ORDER  = { estagio: 0, junior: 1, pleno: 2 };
const INGLES_ORDER = { nenhum: 0, basico: 1, intermediario: 2, avancado: 3, fluente: 4 };

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

  // ── 3. SCORE: Skills (75%) ────────────────────────
  let totalWeight = 0;
  let userScore   = 0;

  const breakdown = jobSkills.map(js => {
    const weight     = js.importance === "obrigatoria" ? 2 : 1;
    const confidence = userSkillMap[js.skill_id] ?? 0;
    totalWeight += weight;
    userScore   += (confidence / 100) * weight;
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

  const skillsScore = totalWeight > 0
    ? Math.round((userScore / totalWeight) * 100)
    : 100;

  // ── 4. SCORE: Senioridade (15%) ───────────────────
  let seniorityScore = 100;
  if (profileData.nivel) {
    // Busca o level da vaga se não estiver em profileData
    const jobLevel = profileData.jobLevel ?? await _fetchJobLevel(jobId);
    const userRank = NIVEL_ORDER[profileData.nivel] ?? -1;
    const jobRank  = LEVEL_ORDER[jobLevel]          ?? -1;
    if (userRank >= 0 && jobRank >= 0) {
      const diff = jobRank - userRank;
      seniorityScore = diff <= 0 ? 100 : diff === 1 ? 55 : 10;
    }
  }

  // ── 5. SCORE: Inglês (5%) ─────────────────────────
  let englishScore = 100;
  if (profileData.ingles) {
    const jobEnglish = profileData.jobEnglish ?? await _fetchJobEnglish(jobId);
    if (jobEnglish && jobEnglish !== "nenhum") {
      const userRank = INGLES_ORDER[profileData.ingles]  ?? 0;
      const jobRank  = INGLES_ORDER[jobEnglish]           ?? 0;
      englishScore = userRank >= jobRank
        ? 100
        : Math.round((userRank / Math.max(jobRank, 1)) * 100);
    }
  }

  // ── 6. SCORE: Experiência (5%) ────────────────────
  let experienceScore = 100;
  if (profileData.anos_experiencia !== undefined) {
    const jobYears  = profileData.jobYears ?? await _fetchJobYears(jobId);
    const userYears = Number(profileData.anos_experiencia ?? 0);
    if (jobYears > 0) {
      experienceScore = userYears >= jobYears
        ? 100
        : Math.round((userYears / jobYears) * 100);
    }
  }

  // ── 7. MÉDIA PONDERADA ────────────────────────────
  const matchPercent = Math.min(100, Math.round(
    skillsScore    * 0.75 +
    seniorityScore * 0.15 +
    englishScore   * 0.05 +
    experienceScore* 0.05
  ));

  return {
    match:     matchPercent,
    breakdown,
    readyFor:  matchPercent >= 70,
    scores: {
      skills:     skillsScore,
      seniority:  seniorityScore,
      english:    englishScore,
      experience: experienceScore,
    },
  };
}

// Helpers para buscar campos da vaga quando não vierem em profileData
async function _fetchJobLevel(jobId) {
  const [r] = await db.query("SELECT level FROM jobs WHERE id = ?", [jobId]);
  return r[0]?.level ?? null;
}
async function _fetchJobEnglish(jobId) {
  const [r] = await db.query("SELECT english_level FROM jobs WHERE id = ?", [jobId]);
  return r[0]?.english_level ?? null;
}
async function _fetchJobYears(jobId) {
  const [r] = await db.query("SELECT years_experience FROM jobs WHERE id = ?", [jobId]);
  return Number(r[0]?.years_experience ?? 0);
}

module.exports = { calculateJobMatch };
