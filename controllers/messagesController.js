// ============================================
// controllers/messagesController.js
// Sistema de mensagens dev <-> empresa.
// ============================================
const db = require("../database/db");

function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

// Confere se o usuário logado é um dos dois lados da conversa.
async function ownsConversation(conversationId, req) {
  const [rows] = await db.query(
    "SELECT id, dev_github_id, company_id FROM conversations WHERE id = ?",
    [conversationId]
  );
  if (!rows.length) return null;
  const conv = rows[0];

  if (req.session.user.type === "dev" && conv.dev_github_id === getUserId(req)) return conv;
  if (req.session.user.type === "empresa" && conv.company_id === req.session.user.id) return conv;
  return null;
}

const messagesController = {
  // Contagem total de não lidas — usado pro badge no ícone de mensagens
  // do header, chamado em toda página (por isso fica leve/separado
  // de listConversations, que traz muito mais dado por conversa).
  getUnreadCount: async (req, res) => {
    try {
      const isDev = req.session.user.type === "dev";
      const filterCol = isDev ? "c.dev_github_id" : "c.company_id";
      const filterVal = isDev ? getUserId(req) : req.session.user.id;

      const [[{ total }]] = await db.query(`
        SELECT COUNT(*) AS total
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE ${filterCol} = ? AND m.read_at IS NULL AND m.sender_user_id != ?
      `, [filterVal, req.session.user.id]);

      res.json({ count: Number(total) });
    } catch (err) {
      console.error("[GET /api/messages/unread-count]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  listConversations: async (req, res) => {
    try {
      const isDev = req.session.user.type === "dev";
      const filterCol = isDev ? "c.dev_github_id" : "c.company_id";
      const filterVal = isDev ? getUserId(req) : req.session.user.id;

      const [rows] = await db.query(`
        SELECT
          c.id, c.dev_github_id, c.company_id, c.job_id, c.created_at,
          j.title AS job_title,
          udp.user_id AS dev_id, udp.nome AS dev_nome, udp.github_login AS dev_github_login,
          ucp.nome_fantasia, ucp.razao_social,
          (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read_at IS NULL AND m.sender_user_id != ?) AS unread
        FROM conversations c
        LEFT JOIN jobs j ON j.id = c.job_id
        -- dev_github_id guarda o github_id de verdade quando existe, ou o user_id
        -- interno como fallback (mesmo padrão de getUserId() usado no resto do
        -- app) — por isso casa com qualquer um dos dois, senão dev sem GitHub
        -- vinculado aparece com nome/id nulos na conversa.
        LEFT JOIN user_dev_profiles udp ON udp.github_id = c.dev_github_id OR udp.user_id = c.dev_github_id
        LEFT JOIN user_company_profiles ucp ON ucp.user_id = c.company_id
        WHERE ${filterCol} = ?
        ORDER BY last_message_at IS NULL, last_message_at DESC, c.created_at DESC
      `, [req.session.user.id, filterVal]);

      res.json(rows.map(r => ({
        id: r.id,
        job_id: r.job_id,
        job_title: r.job_title,
        dev_id: r.dev_id,
        dev_github_id: r.dev_github_id,
        dev_name: r.dev_nome,
        dev_github: r.dev_github_login,
        company_id: r.company_id,
        company_name: r.nome_fantasia ?? r.razao_social,
        last_message: r.last_message,
        last_message_at: r.last_message_at,
        unread: Number(r.unread),
        created_at: r.created_at,
      })));
    } catch (err) {
      console.error("[GET /api/messages/conversations]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  startConversation: async (req, res) => {
    const isDev = req.session.user.type === "dev";
    const jobId = req.body.job_id ? Number(req.body.job_id) : null;

    try {
      let devGithubId, companyId;

      if (isDev) {
        devGithubId = getUserId(req);
        companyId   = req.body.company_id ? Number(req.body.company_id) : null;

        // Sem company_id explícito, mas com job_id: descobre a empresa pela vaga.
        // É o caminho normal do "Nova conversa" — o dev busca por vaga, não por empresa.
        if (!companyId && jobId) {
          const [job] = await db.query("SELECT company_id FROM jobs WHERE id = ?", [jobId]);
          if (!job.length || !job[0].company_id) return res.status(404).json({ error: "Vaga não encontrada." });
          companyId = job[0].company_id;
        }
        if (!companyId) return res.status(400).json({ error: "company_id ou job_id é obrigatório." });

        const [company] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'empresa'", [companyId]);
        if (!company.length) return res.status(404).json({ error: "Empresa não encontrada." });
      } else {
        companyId   = req.session.user.id;
        devGithubId = Number(req.body.dev_github_id);
        if (!devGithubId) return res.status(400).json({ error: "dev_github_id é obrigatório." });
        const [dev] = await db.query("SELECT github_id FROM user_dev_profiles WHERE github_id = ?", [devGithubId]);
        if (!dev.length) return res.status(404).json({ error: "Desenvolvedor não encontrado." });
      }

      // Não dá pra confiar em ON DUPLICATE KEY aqui: a unique key inclui
      // job_id, e o MySQL trata cada NULL como distinto dos outros — duas
      // conversas "gerais" (sem vaga) entre o mesmo par não colidiriam.
      // Por isso o dedup é feito explicitamente com <=> (NULL-safe equals).
      const [existing] = await db.query(
        "SELECT id FROM conversations WHERE dev_github_id = ? AND company_id = ? AND job_id <=> ?",
        [devGithubId, companyId, jobId]
      );

      let conversationId;
      if (existing.length) {
        conversationId = existing[0].id;
      } else {
        const [result] = await db.query(
          "INSERT INTO conversations (dev_github_id, company_id, job_id) VALUES (?, ?, ?)",
          [devGithubId, companyId, jobId]
        );
        conversationId = result.insertId;
      }

      res.status(201).json({ success: true, conversation_id: conversationId });
    } catch (err) {
      console.error("[POST /api/messages/conversations]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getMessages: async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const conv = await ownsConversation(conversationId, req);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const [messages] = await db.query(
        "SELECT id, sender_user_id, body, created_at, read_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
        [conversationId]
      );
      res.json(messages.map(m => ({ ...m, mine: m.sender_user_id === req.session.user.id })));
    } catch (err) {
      console.error("[GET /api/messages/conversations/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  sendMessage: async (req, res) => {
    const conversationId = Number(req.params.id);
    const body = req.body.body?.trim();
    if (!Number.isInteger(conversationId) || conversationId <= 0) return res.status(400).json({ error: "ID inválido." });
    if (!body) return res.status(400).json({ error: "Mensagem não pode ser vazia." });
    if (body.length > 4000) return res.status(400).json({ error: "Mensagem muito longa (máx. 4000 caracteres)." });

    try {
      const conv = await ownsConversation(conversationId, req);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const [result] = await db.query(
        "INSERT INTO messages (conversation_id, sender_user_id, body) VALUES (?, ?, ?)",
        [conversationId, req.session.user.id, body]
      );
      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("[POST /api/messages/conversations/:id/messages]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  markRead: async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const conv = await ownsConversation(conversationId, req);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      await db.query(
        "UPDATE messages SET read_at = NOW() WHERE conversation_id = ? AND sender_user_id != ? AND read_at IS NULL",
        [conversationId, req.session.user.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/messages/conversations/:id/read]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = messagesController;
