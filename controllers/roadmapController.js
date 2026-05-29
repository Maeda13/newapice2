const db = require("../database/db");

const { generateRoadmap }   = require("../services/roadmapGenerator");
const { calculateJobMatch } = require("../services/matchCalculator");

// Helper — retorna o ID correto para consultas em user_skills / user_roadmap_progress
function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

// Retorna o ID correto para user_skills / user_roadmap_progress:
// GitHub users têm github_id (número do GitHub); email-only users usam o id interno.
function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

const roadmapController = {
  listJobs: async (req, res) => {
    try {
      const [jobs] = await Promise.race([
        db.query("SELECT id, title, company, description, level FROM jobs ORDER BY id"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 8000)),
      ]);
      res.json(jobs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  listJobsWithDetails: async (req, res) => {
    try {
      const [jobs] = await db.query(
        "SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id"
      );

      const [jobSkills] = await db.query(`
        SELECT js.job_id, js.importance, s.id AS skill_id, s.name, s.type, s.category
        FROM job_skills js
        JOIN skills s ON s.id = js.skill_id
        ORDER BY js.job_id, js.importance DESC, js.learn_order
      `);

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

      res.json(jobs.map(job => ({ ...job, skills: skillsByJob[job.id] ?? [] })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getRoadmap: async (req, res) => {
    try {
      const roadmap = await generateRoadmap(getUserId(req), req.params.jobId);
      res.json(roadmap);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  updateSkillStatus: async (req, res) => {
    const { status } = req.body;
    const validStatus = ["nao_iniciado", "em_progresso", "concluido"];

    if (!validStatus.includes(status)) {
      return res.status(400).json({ error: "Status inválido" });
    }

    try {
      const userId = getUserId(req);
      await db.query(`
        INSERT INTO user_roadmap_progress (github_id, job_id, skill_id, status, completed_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status       = VALUES(status),
          completed_at = VALUES(completed_at)
      `, [
        userId,
        req.params.jobId,
        req.params.skillId,
        status,
        status === "concluido" ? new Date() : null,
      ]);

      const match = await calculateJobMatch(userId, req.params.jobId);
      res.json({ success: true, newMatch: match.match });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getPublicJob: async (req, res) => {
    const jobId = req.params.id;
    try {
      const [jobs] = await db.query("SELECT * FROM jobs WHERE id = ?", [jobId]);
      if (!jobs.length) return res.status(404).json({ error: "Vaga não encontrada." });
      const job = jobs[0];

      const [jobSkills] = await db.query(`
        SELECT js.skill_id, js.importance, js.learn_order, s.name, s.type, s.category
        FROM job_skills js JOIN skills s ON s.id = js.skill_id
        WHERE js.job_id = ? ORDER BY js.importance DESC, js.learn_order
      `, [jobId]);

      let match = null;
      if (req.session?.user) {
        const uid = getUserId(req);
        const profileData = {
          nivel:             req.session.user.nivel,
          jobLevel:          job.level,
          jobEnglish:        job.english_level,
          jobYears:          job.years_experience,
        };
        match = await calculateJobMatch(uid, jobId, profileData);
      }

      res.json({ ...job, skills: jobSkills, match });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getDashboard: async (req, res) => {
    try {
      const userId = getUserId(req);
      const [rows] = await db.query(`
        SELECT
          j.id,
          j.title,
          j.company,
          j.level,
          COUNT(DISTINCT js.skill_id)                                               AS total_skills,
          SUM(urp.status = 'concluido')                                             AS concluded,
          SUM(urp.status = 'em_progresso')                                          AS in_progress,
          ROUND(SUM(urp.status = 'concluido') / COUNT(DISTINCT js.skill_id) * 100) AS progress_percent
        FROM jobs j
        JOIN job_skills js ON js.job_id = j.id
        LEFT JOIN user_roadmap_progress urp
          ON urp.job_id    = j.id
          AND urp.skill_id = js.skill_id
          AND urp.github_id = ?
        GROUP BY j.id
        HAVING COUNT(urp.github_id) > 0
        ORDER BY progress_percent DESC, j.id
      `, [userId]);

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
};

module.exports = roadmapController;
