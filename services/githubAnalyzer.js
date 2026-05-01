// ============================================
// services/githubAnalyzer.js
// Analisa o perfil GitHub do usuário e detecta
// quais skills ele já possui com base nos repos
// ============================================
const axios = require("axios");
const db    = require("../database/db");

// --------------------------------------------
// Busca todas as linguagens usadas nos repos
// --------------------------------------------
async function fetchRepoLanguages(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/languages`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    // Retorna array com os nomes das linguagens em minúsculo
    // Ex: ["javascript", "css", "html"]
    return Object.keys(res.data).map(l => l.toLowerCase());
  } catch {
    return [];
  }
}

// --------------------------------------------
// Busca o README de um repositório
// --------------------------------------------
async function fetchRepoReadme(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/readme`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.raw" } }
    );
    return res.data.toLowerCase();
  } catch {
    return ""; // README não encontrado — sem problema
  }
}

// --------------------------------------------
// Função principal: analisa GitHub e salva
// as skills detectadas no banco de dados
// --------------------------------------------
async function matchSkillsFromGitHub(accessToken, githubId, repos) {
  // Busca todas as skills que têm sinais do GitHub cadastrados
  const [allSkills] = await db.query(
    "SELECT * FROM skills WHERE github_signals IS NOT NULL"
  );

  // Para cada repositório, busca linguagens e README
  const repoData = await Promise.all(
    repos.map(async (repo) => ({
      languages: await fetchRepoLanguages(accessToken, repo.full_name),
      readme:    await fetchRepoReadme(accessToken, repo.full_name),
    }))
  );

  const detectedSkills = [];

  for (const skill of allSkills) {
    // Converte a string de sinais em array
    // Ex: "express,node,nodejs" → ["express", "node", "nodejs"]
    const signals = skill.github_signals.split(",").map(s => s.trim());

    let confidence = 0;

    for (const repo of repoData) {
      for (const signal of signals) {
        // Sinal encontrado como linguagem do repositório (+40 pontos)
        if (repo.languages.includes(signal)) {
          confidence += 40;
        }
        // Sinal encontrado no README do repositório (+20 pontos)
        if (repo.readme.includes(signal)) {
          confidence += 20;
        }
      }
    }

    // Só considera detectada se a confiança for maior que zero
    if (confidence > 0) {
      detectedSkills.push({
        skill_id:   skill.id,
        confidence: Math.min(confidence, 100), // máximo 100
      });
    }
  }

  // Salva (ou atualiza) as skills detectadas no banco
  for (const skill of detectedSkills) {
    await db.query(`
      INSERT INTO user_skills (github_id, skill_id, source, confidence)
      VALUES (?, ?, 'github', ?)
      ON DUPLICATE KEY UPDATE confidence = VALUES(confidence)
    `, [githubId, skill.skill_id, skill.confidence]);
  }

  return detectedSkills;
}

module.exports = { matchSkillsFromGitHub };