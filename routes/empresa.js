// ============================================
// routes/empresa.js
// Rotas da área da empresa
// ============================================
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

// Middleware: verifica se é empresa autenticada
function isEmpresa(req, res, next) {
  if (!req.session.user)              return res.status(401).json({ error: "Não autenticado" });
  if (req.session.user.type !== "empresa") return res.status(403).json({ error: "Acesso restrito a empresas" });
  next();
}

// --------------------------------------------
// GET /api/empresa/dashboard
// Visão geral da empresa: perfil, vagas e stats
// --------------------------------------------
router.get("/dashboard", isEmpresa, async (req, res) => {
  const companyId = req.session.user.id;

  try {
    // Perfil da empresa
    const [profileRows] = await db.query(
      "SELECT * FROM user_company_profiles WHERE user_id = ?",
      [companyId]
    );
    const profile = profileRows[0] ?? null;

    // Vagas da empresa (filtra por company_id)
    const [jobs] = await db.query(`
      SELECT
        j.id,
        j.title,
        j.level,
        j.description,
        j.active,
        j.created_at,
        COUNT(DISTINCT js.skill_id)                           AS total_skills,
        COUNT(DISTINCT urp.github_id)                         AS total_candidatos,
        SUM(urp.status = 'concluido') / COUNT(DISTINCT CASE WHEN urp.github_id IS NOT NULL THEN js.skill_id END) * 100 AS avg_progress
      FROM jobs j
      LEFT JOIN job_skills js         ON js.job_id = j.id
      LEFT JOIN user_roadmap_progress urp ON urp.job_id = j.id
      WHERE j.company_id = ?
      GROUP BY j.id
      ORDER BY j.created_at DESC
    `, [companyId]);

    // Stats globais
    const totalVagas      = jobs.length;
    const vagasAtivas     = jobs.filter(j => j.active).length;
    const totalCandidatos = jobs.reduce((acc, j) => acc + Number(j.total_candidatos ?? 0), 0);
    const totalSkills     = jobs.reduce((acc, j) => acc + Number(j.total_skills ?? 0), 0);

    res.json({
      profile,
      jobs: jobs.map(j => ({
        ...j,
        active:          Boolean(j.active),
        total_skills:    Number(j.total_skills    ?? 0),
        total_candidatos:Number(j.total_candidatos ?? 0),
        avg_progress:    Math.round(Number(j.avg_progress ?? 0)),
      })),
      stats: {
        totalVagas,
        vagasAtivas,
        totalCandidatos,
        totalSkills,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// POST /api/empresa/jobs
// Cria uma nova vaga para a empresa logada
// --------------------------------------------
router.post("/jobs", isEmpresa, async (req, res) => {
  const { title, level, description } = req.body;
  const companyId = req.session.user.id;

  if (!title) return res.status(400).json({ error: "Título é obrigatório." });

  const validLevels = ["estagio", "junior", "pleno"];
  if (!validLevels.includes(level)) {
    return res.status(400).json({ error: "Nível inválido." });
  }

  // Busca o nome da empresa para preencher o campo company (legado)
  const [profileRows] = await db.query(
    "SELECT nome_fantasia, razao_social FROM user_company_profiles WHERE user_id = ?",
    [companyId]
  );
  const companyName = profileRows[0]?.nome_fantasia ?? profileRows[0]?.razao_social ?? "Empresa";

  try {
    const [result] = await db.query(
      "INSERT INTO jobs (title, company, company_id, description, level) VALUES (?, ?, ?, ?, ?)",
      [title, companyName, companyId, description ?? null, level]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// PATCH /api/empresa/jobs/:id
// Atualiza uma vaga da empresa (título, nível, desc, active)
// --------------------------------------------
router.patch("/jobs/:id", isEmpresa, async (req, res) => {
  const { title, level, description, active } = req.body;
  const companyId = req.session.user.id;
  const jobId     = req.params.id;

  // Confirma que a vaga pertence à empresa
  const [rows] = await db.query(
    "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
    [jobId, companyId]
  );
  if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

  const updates = [];
  const values  = [];

  if (title       !== undefined) { updates.push("title = ?");       values.push(title); }
  if (level       !== undefined) { updates.push("level = ?");       values.push(level); }
  if (description !== undefined) { updates.push("description = ?"); values.push(description); }
  if (active      !== undefined) { updates.push("active = ?");      values.push(active ? 1 : 0); }

  if (!updates.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });

  try {
    await db.query(
      `UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`,
      [...values, jobId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// DELETE /api/empresa/jobs/:id
// Remove uma vaga (somente da empresa dona)
// --------------------------------------------
router.delete("/jobs/:id", isEmpresa, async (req, res) => {
  const companyId = req.session.user.id;
  const jobId     = req.params.id;

  const [rows] = await db.query(
    "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
    [jobId, companyId]
  );
  if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

  try {
    await db.query("DELETE FROM jobs WHERE id = ?", [jobId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;