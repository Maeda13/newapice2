const db = require("../database/db");

const empresaController = {
  getDashboard: async (req, res) => {
    const companyId = req.session.user.id;

    try {
      const [profileRows] = await db.query(
        "SELECT * FROM user_company_profiles WHERE user_id = ?",
        [companyId]
      );
      const profile = profileRows[0] ?? null;

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

      const totalVagas      = jobs.length;
      const vagasAtivas     = jobs.filter(j => j.active).length;
      const totalCandidatos = jobs.reduce((acc, j) => acc + Number(j.total_candidatos ?? 0), 0);
      const totalSkills     = jobs.reduce((acc, j) => acc + Number(j.total_skills ?? 0), 0);

      res.json({
        profile,
        jobs: jobs.map(j => ({
          ...j,
          active:           Boolean(j.active),
          total_skills:     Number(j.total_skills    ?? 0),
          total_candidatos: Number(j.total_candidatos ?? 0),
          avg_progress:     Math.round(Number(j.avg_progress ?? 0)),
        })),
        stats: { totalVagas, vagasAtivas, totalCandidatos, totalSkills },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  createJob: async (req, res) => {
    const { title, level, description } = req.body;
    const companyId = req.session.user.id;

    if (!title) return res.status(400).json({ error: "Título é obrigatório." });

    const validLevels = ["estagio", "junior", "pleno"];
    if (!validLevels.includes(level)) {
      return res.status(400).json({ error: "Nível inválido." });
    }

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
  },

  updateJob: async (req, res) => {
    const { title, level, description, active } = req.body;
    const companyId = req.session.user.id;
    const jobId     = req.params.id;

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
  },

  deleteJob: async (req, res) => {
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
  },

  getProfile: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [users]    = await db.query("SELECT id, email, created_at FROM users WHERE id = ?", [companyId]);
      const [profiles] = await db.query("SELECT * FROM user_company_profiles WHERE user_id = ?", [companyId]);

      const [counts] = await db.query(
        "SELECT COUNT(*) AS total, CAST(SUM(active) AS UNSIGNED) AS ativas FROM jobs WHERE company_id = ?",
        [companyId]
      );
      const [vagas] = await db.query(
        "SELECT id, title, level, active, created_at FROM jobs WHERE company_id = ? ORDER BY created_at DESC LIMIT 5",
        [companyId]
      );

      const profile = profiles[0] ?? {};
      const user    = users[0]    ?? {};

      res.json({
        id:            companyId,
        email:         user.email         ?? "",
        created_at:    user.created_at    ?? null,
        razao_social:  profile.razao_social  ?? "",
        nome_fantasia: profile.nome_fantasia ?? "",
        cnpj:          profile.cnpj       ?? "",
        setor:         profile.setor      ?? "",
        tamanho:       profile.tamanho    ?? "",
        site:          profile.site       ?? "",
        vagas,
        totalVagas:  Number(counts[0]?.total  ?? 0),
        vagasAtivas: Number(counts[0]?.ativas ?? 0),
      });
    } catch (err) {
      console.error("[GET /api/empresa/profile]", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  updateProfile: async (req, res) => {
    const companyId = req.session.user.id;
    const { nome_fantasia, setor, tamanho, site } = req.body;

    if (nome_fantasia !== undefined && !String(nome_fantasia).trim()) {
      return res.status(400).json({ error: "Nome fantasia não pode ser vazio." });
    }

    try {
      const fields = [];
      const values = [];

      if (nome_fantasia !== undefined) { fields.push("nome_fantasia = ?"); values.push(String(nome_fantasia).trim() || null); }
      if (setor         !== undefined) { fields.push("setor = ?");         values.push(setor  || null); }
      if (tamanho       !== undefined) { fields.push("tamanho = ?");       values.push(tamanho || null); }
      if (site          !== undefined) { fields.push("site = ?");          values.push(String(site).trim() || null); }

      if (fields.length > 0) {
        values.push(companyId);
        await db.query(
          `UPDATE user_company_profiles SET ${fields.join(", ")} WHERE user_id = ?`,
          values
        );
      }

      if (nome_fantasia) req.session.user.name = String(nome_fantasia).trim();

      res.json({ success: true, message: "Perfil atualizado com sucesso." });
    } catch (err) {
      console.error("[PATCH /api/empresa/profile]", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },
};

module.exports = empresaController;
