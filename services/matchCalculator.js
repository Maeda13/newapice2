// ============================================
// services/matchCalculator.js
// Calcula o % de compatibilidade entre o
// usuário e uma vaga específica
// ============================================
const db = require("../database/db");

async function calculateJobMatch(githubId, jobId) {
  // Busca todas as skills exigidas pela vaga
  const [jobSkills] = await db.query(`
    SELECT js.skill_id, js.importance, js.learn_order, s.name, s.type
    FROM job_skills js
    JOIN skills s ON s.id = js.skill_id
    WHERE js.job_id = ?
    ORDER BY js.learn_order
  `, [jobId]);

  // Busca o que o usuário já sabe
  const [userSkills] = await db.query(`
    SELECT skill_id, confidence
    FROM user_skills
    WHERE github_id = ?
  `, [githubId]);

  const userSkillMap = {};
  for (const s of userSkills) {
    userSkillMap[s.skill_id] = s.confidence;
  }

  let totalWeight = 0;
  let userScore   = 0;

  const breakdown = jobSkills.map(jobSkill => {
    // Habilidades obrigatórias têm peso 2, desejáveis peso 1
    const weight     = jobSkill.importance === "obrigatoria" ? 2 : 1;
    const confidence = userSkillMap[jobSkill.skill_id] ?? 0;
    const hasSkill   = confidence > 0;

    totalWeight += weight;
    // Pontuação proporcional à confiança do usuário naquela skill
    userScore   += (confidence / 100) * weight;

    return {
      skill_id:    jobSkill.skill_id,
      skill_name:  jobSkill.name,
      skill_type:  jobSkill.type,
      importance:  jobSkill.importance,
      learn_order: jobSkill.learn_order,
      has:         hasSkill,
      confidence:  confidence,
    };
  });

  const matchPercent = totalWeight > 0
    ? Math.round((userScore / totalWeight) * 100)
    : 0;

  return {
    match:     matchPercent,   // Ex: 68
    breakdown: breakdown,      // Detalhe skill por skill
    readyFor:  matchPercent >= 70,
  };
}

module.exports = { calculateJobMatch };