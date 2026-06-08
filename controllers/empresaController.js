const db = require("../database/db");

const NIVEL_MAP = { iniciante: "estagio", intermediario: "junior", avancado: "pleno" };

function computeSkillScore(devSkills, jobSkills) {
  if (!jobSkills.length) return { score: 0, skillsMatch: 0, totalSkills: 0 };
  let totalWeight = 0, userScore = 0, skillsMatch = 0;
  for (const js of jobSkills) {
    const weight     = js.importance === "obrigatoria" ? 2 : 1;
    const confidence = devSkills[js.skill_id] ?? 0;
    totalWeight += weight;
    userScore   += (confidence / 100) * weight;
    if (confidence > 0) skillsMatch++;
  }
  return {
    score:       Math.round((userScore / totalWeight) * 100),
    skillsMatch,
    totalSkills: jobSkills.length,
  };
}

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
      console.error("[GET /api/empresa/dashboard]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  createJob: async (req, res) => {
    const {
      title, level, description, modality, contract_type,
      salary_min, salary_max, location, years_experience,
      english_level, responsibilities, benefits, max_candidates,
      tags, active,
    } = req.body;
    const companyId = req.session.user.id;

    if (!title?.trim()) return res.status(400).json({ error: "Título é obrigatório." });
    if (!["estagio","junior","pleno"].includes(level))
      return res.status(400).json({ error: "Nível inválido." });

    try {
      const [profileRows] = await db.query(
        "SELECT nome_fantasia, razao_social FROM user_company_profiles WHERE user_id = ?",
        [companyId]
      );
      const companyName = profileRows[0]?.nome_fantasia ?? profileRows[0]?.razao_social ?? "Empresa";

      const [result] = await db.query(`
        INSERT INTO jobs
          (title, company, company_id, description, level, modality, contract_type,
           salary_min, salary_max, location, years_experience, english_level,
           responsibilities, benefits, max_candidates, tags, active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        title.trim(), companyName, companyId,
        description   || null,
        level,
        modality      || "remoto",
        contract_type || "estagio",
        salary_min    ? Number(salary_min)    : null,
        salary_max    ? Number(salary_max)    : null,
        location      || null,
        years_experience ? Number(years_experience) : 0,
        english_level || "nenhum",
        responsibilities || null,
        benefits         || null,
        max_candidates   ? Number(max_candidates) : 100,
        tags             || null,
        active !== undefined ? (active ? 1 : 0) : 1,
      ]);
      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("[POST /api/empresa/jobs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJob: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      const allowed = [
        "title","level","description","modality","contract_type",
        "salary_min","salary_max","location","years_experience",
        "english_level","responsibilities","benefits","max_candidates",
        "tags","active",
      ];

      const updates = [];
      const values  = [];

      for (const field of allowed) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          if (field === "active") values.push(req.body[field] ? 1 : 0);
          else values.push(req.body[field] ?? null);
        }
      }

      if (!updates.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });

      await db.query(
        `UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`,
        [...values, jobId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/empresa/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  deleteJob: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query("DELETE FROM jobs WHERE id = ?", [jobId]);
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/empresa/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getSkills: async (req, res) => {
    try {
      const [skills] = await db.query(
        "SELECT id, name, type, category FROM skills ORDER BY type, category, name"
      );
      res.json(skills);
    } catch (err) {
      console.error("[GET /api/empresa/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getJobSkills: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;
    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      const [skills] = await db.query(
        "SELECT skill_id, importance, learn_order FROM job_skills WHERE job_id = ? ORDER BY learn_order",
        [jobId]
      );
      res.json(skills);
    } catch (err) {
      console.error("[GET /api/empresa/jobs/:id/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJobSkills: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;
    const { skills } = req.body;

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query("DELETE FROM job_skills WHERE job_id = ?", [jobId]);

      if (Array.isArray(skills) && skills.length > 0) {
        const values = skills.map((s, i) => [jobId, s.skill_id, s.importance, i + 1]);
        await db.query(
          "INSERT INTO job_skills (job_id, skill_id, importance, learn_order) VALUES ?",
          [values]
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("[PUT /api/empresa/jobs/:id/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getMatchs: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [jobs] = await db.query(
        "SELECT id, title FROM jobs WHERE company_id = ? AND active = 1",
        [companyId]
      );
      if (!jobs.length) return res.json([]);

      const jobIds = jobs.map(j => j.id);

      const [jobSkillRows] = await db.query(
        "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
        [jobIds]
      );
      const jobSkillMap = {};
      for (const r of jobSkillRows) {
        if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
        jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
      }

      const [devs] = await db.query(
        "SELECT user_id AS id, github_id, nome, github_login, nivel FROM user_dev_profiles WHERE github_id IS NOT NULL"
      );
      if (!devs.length) return res.json([]);

      const devGithubIds = devs.map(d => d.github_id);

      const [skillRows] = await db.query(
        "SELECT github_id, skill_id, confidence FROM user_skills WHERE github_id IN (?)",
        [devGithubIds]
      );
      const devSkillMap = {};
      for (const s of skillRows) {
        if (!devSkillMap[s.github_id]) devSkillMap[s.github_id] = {};
        devSkillMap[s.github_id][s.skill_id] = s.confidence;
      }

      const [actions] = await db.query(
        "SELECT dev_github_id, job_id, action FROM company_match_actions WHERE company_id = ?",
        [companyId]
      );
      const actionMap = {};
      for (const a of actions) actionMap[`${a.dev_github_id}-${a.job_id}`] = a.action;

      const matchs = [];
      for (const dev of devs) {
        const devSkills = devSkillMap[dev.github_id] ?? {};
        for (const job of jobs) {
          const jobSkills = jobSkillMap[job.id] ?? [];
          if (!jobSkills.length) continue;
          const { score, skillsMatch, totalSkills } = computeSkillScore(devSkills, jobSkills);
          if (score === 0) continue;
          const key = `${dev.github_id}-${job.id}`;
          matchs.push({
            id:           key,
            dev_id:       dev.id,
            dev_github_id: dev.github_id,
            dev:          dev.nome,
            github:       dev.github_login,
            level:        NIVEL_MAP[dev.nivel] ?? "estagio",
            job_id:       job.id,
            job:          job.title,
            score,
            skills_match: skillsMatch,
            total_skills: totalSkills,
            status:       actionMap[key] ?? "novo",
          });
        }
      }

      matchs.sort((a, b) => b.score - a.score);
      res.json(matchs);
    } catch (err) {
      console.error("[GET /api/empresa/matchs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateMatchAction: async (req, res) => {
    const companyId    = req.session.user.id;
    const devGithubId  = Number(req.params.devGithubId);
    const jobId        = Number(req.params.jobId);
    const { action }   = req.body;

    if (!["aceito", "recusado"].includes(action))
      return res.status(400).json({ error: "Ação inválida." });
    if (!devGithubId || !jobId)
      return res.status(400).json({ error: "IDs inválidos." });

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query(`
        INSERT INTO company_match_actions (company_id, dev_github_id, job_id, action)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE action = VALUES(action)
      `, [companyId, devGithubId, jobId, action]);

      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/empresa/matchs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDesenvolvedores: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [jobs] = await db.query(
        "SELECT id FROM jobs WHERE company_id = ? AND active = 1",
        [companyId]
      );
      const jobIds = jobs.map(j => j.id);

      const jobSkillMap = {};
      if (jobIds.length) {
        const [jobSkillRows] = await db.query(
          "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
          [jobIds]
        );
        for (const r of jobSkillRows) {
          if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
          jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
        }
      }

      const [devs] = await db.query(
        "SELECT user_id AS id, github_id, nome, github_login, nivel FROM user_dev_profiles WHERE github_id IS NOT NULL"
      );
      if (!devs.length) return res.json([]);

      const devGithubIds = devs.map(d => d.github_id);

      const [skillRows] = await db.query(`
        SELECT us.github_id, us.skill_id, us.confidence, s.name AS skill_name
        FROM user_skills us
        JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id IN (?)
        ORDER BY us.confidence DESC
      `, [devGithubIds]);

      const devSkillMap   = {};
      const devSkillNames = {};
      for (const s of skillRows) {
        if (!devSkillMap[s.github_id]) { devSkillMap[s.github_id] = {}; devSkillNames[s.github_id] = []; }
        devSkillMap[s.github_id][s.skill_id] = s.confidence;
        devSkillNames[s.github_id].push(s.skill_name);
      }

      const [progressRows] = await db.query(`
        SELECT
          github_id,
          job_id,
          COUNT(*)                              AS total_skills,
          SUM(status = 'concluido')             AS concluded,
          SUM(status IN ('em_progresso','concluido')) AS active_skills
        FROM user_roadmap_progress
        WHERE github_id IN (?)
        GROUP BY github_id, job_id
      `, [devGithubIds]);

      const devProgressMap = {};
      for (const p of progressRows) {
        if (!devProgressMap[p.github_id])
          devProgressMap[p.github_id] = { bestProgress: 0, inRoadmap: false, concluido: false };
        const pct = p.total_skills > 0
          ? Math.round(Number(p.concluded) / p.total_skills * 100) : 0;
        const pm = devProgressMap[p.github_id];
        if (pct > pm.bestProgress) pm.bestProgress = pct;
        if (Number(p.active_skills) > 0) pm.inRoadmap = true;
        if (Number(p.concluded) > 0 && Number(p.concluded) === p.total_skills) pm.concluido = true;
      }

      const result = devs.map(dev => {
        const devSkills   = devSkillMap[dev.github_id]   ?? {};
        const skillNames  = devSkillNames[dev.github_id] ?? [];
        const prog        = devProgressMap[dev.github_id] ?? { bestProgress: 0, inRoadmap: false, concluido: false };

        let bestMatch = 0;
        for (const jobId of jobIds) {
          const { score } = computeSkillScore(devSkills, jobSkillMap[jobId] ?? []);
          if (score > bestMatch) bestMatch = score;
        }

        return {
          id:           dev.id,
          dev_github_id: dev.github_id,
          name:         dev.nome,
          github:       dev.github_login,
          level:        NIVEL_MAP[dev.nivel] ?? "estagio",
          skills:       skillNames.slice(0, 5),
          progress:     prog.bestProgress,
          match:        bestMatch,
          roadmap:      prog.inRoadmap,
          concluido:    prog.concluido,
        };
      });

      res.json(result);
    } catch (err) {
      console.error("[GET /api/empresa/desenvolvedores]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDevProfile: async (req, res) => {
    const companyId = req.session.user.id;
    const devId     = Number(req.params.id);
    if (!Number.isInteger(devId) || devId <= 0)
      return res.status(400).json({ error: "ID inválido." });

    try {
      const [profiles] = await db.query(
        "SELECT user_id AS id, github_id, nome, sobrenome, github_login, nivel FROM user_dev_profiles WHERE user_id = ?",
        [devId]
      );
      if (!profiles.length) return res.status(404).json({ error: "Desenvolvedor não encontrado." });
      const dev = profiles[0];

      const [skillRows] = await db.query(`
        SELECT s.id AS skill_id, s.name, s.category, s.type, us.confidence
        FROM user_skills us
        JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id = ?
        ORDER BY us.confidence DESC
      `, [dev.github_id]);

      const devSkills = {};
      for (const s of skillRows) devSkills[s.skill_id] = s.confidence;

      const [jobs] = await db.query(
        "SELECT id, title FROM jobs WHERE company_id = ? AND active = 1",
        [companyId]
      );

      let bestMatch = 0;
      let bestJobTitle = null;
      if (jobs.length) {
        const jobIds = jobs.map(j => j.id);
        const [jobSkillRows] = await db.query(
          "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
          [jobIds]
        );
        const jobSkillMap = {};
        for (const r of jobSkillRows) {
          if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
          jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
        }
        for (const job of jobs) {
          const { score } = computeSkillScore(devSkills, jobSkillMap[job.id] ?? []);
          if (score > bestMatch) { bestMatch = score; bestJobTitle = job.title; }
        }
      }

      const [progressRows] = await db.query(`
        SELECT job_id, COUNT(*) AS total, SUM(status = 'concluido') AS concluded
        FROM user_roadmap_progress
        WHERE github_id = ?
        GROUP BY job_id
      `, [dev.github_id]);

      res.json({
        id:           dev.id,
        github_id:    dev.github_id,
        name:         [dev.nome, dev.sobrenome].filter(Boolean).join(" "),
        github:       dev.github_login,
        level:        NIVEL_MAP[dev.nivel] ?? "estagio",
        skills:       skillRows.map(s => ({ name: s.name, category: s.category, type: s.type, confidence: s.confidence })),
        match:        bestMatch,
        best_job:     bestJobTitle,
        roadmaps:     progressRows.map(p => ({
          job_id:    p.job_id,
          total:     Number(p.total),
          concluded: Number(p.concluded),
          progress:  p.total > 0 ? Math.round(Number(p.concluded) / Number(p.total) * 100) : 0,
        })),
      });
    } catch (err) {
      console.error("[GET /api/empresa/dev/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
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
