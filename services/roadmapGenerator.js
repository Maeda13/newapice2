// ============================================
// services/roadmapGenerator.js
// Gera o roadmap personalizado cruzando as
// skills da vaga com o perfil do usuário
// ============================================
const db                = require("../database/db");
const { calculateJobMatch } = require("./matchCalculator");

async function generateRoadmap(githubId, jobId) {
  // Calcula o match e obtém o breakdown skill por skill
  const match = await calculateJobMatch(githubId, jobId);

  // Para as skills que o usuário ainda não tem,
  // busca os recursos de aprendizado cadastrados
  const needsToLearn = [];
  const alreadyKnows = [];

  for (const skill of match.breakdown) {
    if (skill.has) {
      // Usuário já possui essa skill
      alreadyKnows.push(skill);
    } else {
      // Busca recursos de aprendizado para essa skill
      const [resources] = await db.query(`
        SELECT id, type, title, url, is_free, duration
        FROM skill_resources
        WHERE skill_id = ?
        ORDER BY type
      `, [skill.skill_id]);

      needsToLearn.push({ ...skill, resources });
    }
  }

  // Mantém a ordem lógica de aprendizado definida no banco
  needsToLearn.sort((a, b) => a.learn_order - b.learn_order);

  // Busca o progresso já salvo do usuário nesse roadmap
  const [progressRows] = await db.query(`
    SELECT skill_id, status
    FROM user_roadmap_progress
    WHERE github_id = ? AND job_id = ?
  `, [githubId, jobId]);

  const progressMap = {};
  for (const row of progressRows) {
    progressMap[row.skill_id] = row.status;
  }

  // Adiciona o status de progresso em cada skill que falta
  const needsToLearnWithProgress = needsToLearn.map(skill => ({
    ...skill,
    status: progressMap[skill.skill_id] ?? "nao_iniciado",
  }));

  return {
    jobId,
    matchPercent:  match.match,
    readyFor:      match.readyFor,
    totalSkills:   match.breakdown.length,
    knownCount:    alreadyKnows.length,
    alreadyKnows,                      // ✅ já sabe
    needsToLearn:  needsToLearnWithProgress, // 📚 precisa aprender
  };
}

module.exports = { generateRoadmap };