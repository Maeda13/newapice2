// ============================================
// routes/roadmap.js
// Rotas da feature Roadmap de Carreira
// ============================================
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

const { generateRoadmap }   = require("../services/roadmapGenerator");
const { calculateJobMatch } = require("../services/matchCalculator");

function isAuthenticated(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Não autenticado" });
  next();
}

// --------------------------------------------
// GET /api/jobs
// Lista todas as vagas (público — sem login)
// --------------------------------------------
router.get("/jobs", async (req, res) => {
  try {
    const [jobs] = await db.query(
      "SELECT id, title, company, description, level FROM jobs ORDER BY id"
    );
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// GET /api/jobs/detalhes
// Lista vagas com skills de cada uma (público)
// Usado pela vitrine de vagas (/vagas)
// --------------------------------------------
router.get("/jobs/detalhes", async (req, res) => {
  try {
    // Busca vagas
    const [jobs] = await db.query(
      "SELECT id, title, company, description, level FROM jobs ORDER BY id"
    );

    // Busca todas as relações vaga ↔ skill de uma vez
    const [jobSkills] = await db.query(`
      SELECT js.job_id, js.importance, s.id AS skill_id, s.name, s.type, s.category
      FROM job_skills js
      JOIN skills s ON s.id = js.skill_id
      ORDER BY js.job_id, js.importance DESC, js.learn_order
    `);

    // Agrupa as skills por job_id
    const skillsByJob = {};
    for (const row of jobSkills) {
      if (!skillsByJob[row.job_id]) skillsByJob[row.job_id] = [];
      skillsByJob[row.job_id].push({
        id:         row.skill_id,
        name:       row.name,
        type:       row.type,
        category:   row.category,
        importance: row.importance,
      });
    }

    const result = jobs.map(job => ({
      ...job,
      skills: skillsByJob[job.id] ?? [],
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// GET /api/roadmap/:jobId
// Gera o roadmap personalizado para uma vaga
// --------------------------------------------
router.get("/roadmap/:jobId", isAuthenticated, async (req, res) => {
  try {
    const roadmap = await generateRoadmap(
      req.session.user.id,
      req.params.jobId
    );
    res.json(roadmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// PATCH /api/roadmap/:jobId/skill/:skillId
// Atualiza o status de uma skill no roadmap
// --------------------------------------------
router.patch("/roadmap/:jobId/skill/:skillId", isAuthenticated, async (req, res) => {
  const { status } = req.body;
  const validStatus = ["nao_iniciado", "em_progresso", "concluido"];

  if (!validStatus.includes(status)) {
    return res.status(400).json({ error: "Status inválido" });
  }

  try {
    await db.query(`
      INSERT INTO user_roadmap_progress (github_id, job_id, skill_id, status, completed_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status       = VALUES(status),
        completed_at = VALUES(completed_at)
    `, [
      req.session.user.id,
      req.params.jobId,
      req.params.skillId,
      status,
      status === "concluido" ? new Date() : null,
    ]);

    const match = await calculateJobMatch(req.session.user.id, req.params.jobId);
    res.json({ success: true, newMatch: match.match });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// GET /api/dashboard
// Retorna todos os roadmaps que o usuário iniciou,
// com contagem de concluídas, em progresso e total
// --------------------------------------------
router.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        j.id,
        j.title,
        j.company,
        j.level,
        COUNT(js.skill_id)                                               AS total_skills,
        SUM(urp.status = 'concluido')                                    AS concluded,
        SUM(urp.status = 'em_progresso')                                 AS in_progress,
        ROUND(SUM(urp.status = 'concluido') / COUNT(js.skill_id) * 100) AS progress_percent
      FROM jobs j
      JOIN job_skills js ON js.job_id = j.id
      LEFT JOIN user_roadmap_progress urp
        ON urp.job_id    = j.id
        AND urp.skill_id = js.skill_id
        AND urp.github_id = ?
      WHERE urp.github_id = ?
      GROUP BY j.id
      ORDER BY progress_percent DESC, j.id
    `, [req.session.user.id, req.session.user.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;