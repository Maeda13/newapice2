const express = require("express");
const router  = express.Router();
const { param, body } = require("express-validator");
const { isAuth } = require("../middlewares/auth");
const { handleValidation } = require("../validators/handle-validation");
const { hasFeature } = require("../services/subscriptionService");
const { getCachedProfile, analyzeUserProfile } = require("../services/aiProfileAnalyzer");
const { getMatchExplanation } = require("../services/matchCalculator");
const { getHistory, sendMessage } = require("../services/mentorChat");
const { gerarPergunta, avaliarResposta } = require("../services/interviewSimulator");
const { getLatestInsights, generateInsights } = require("../services/marketInsights");

// Gate de plano PRO — mesmo padrão 402 usado em empresaController.createJob
// quando o plano do usuário não permite a funcionalidade.
function requireFeature(featureKey, mensagem) {
  return async (req, res, next) => {
    try {
      const allowed = await hasFeature(req.session.user.id, featureKey);
      if (!allowed) return res.status(402).json({ error: mensagem });
      next();
    } catch (err) {
      console.error("[requireFeature]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  };
}

function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

const intParam = name => [
  param(name).isInt({ min: 1 }).withMessage(`${name} deve ser inteiro positivo.`).toInt(),
  handleValidation,
];

// GET /api/ai/perfil-tecnico — análise de repositórios via IA
// (proficiência estimada, boas práticas, pontos de melhoria).
// Usa cache em perfil_tecnico_ia; só chama a IA se ainda não existir.
router.get("/perfil-tecnico", isAuth, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const cached = await getCachedProfile(userId);
    if (cached) return res.json(cached);

    const accessToken = req.session.user?.accessToken;
    if (!accessToken) {
      return res.status(400).json({ error: "Conta GitHub não vinculada. Faça login com o GitHub para gerar a análise." });
    }

    const profile = await analyzeUserProfile(userId, accessToken);
    res.json(profile);
  } catch (err) {
    console.error("[GET /api/ai/perfil-tecnico]", err.message);
    if (err.message.includes("repositórios importados")) {
      return res.status(400).json({ error: "Importe ao menos um repositório antes de gerar a análise." });
    }
    res.status(502).json({ error: "Erro ao gerar análise com IA. Tente novamente em instantes." });
  }
});

// GET /api/ai/jobs/:id/match-explicacao — compatibilidade semântica
// (percentual + explicação textual) entre o usuário logado e a vaga.
// Cacheado por par candidato-vaga em match_ia_cache.
router.get("/jobs/:id/match-explicacao", isAuth, ...intParam("id"), async (req, res) => {
  const githubId = getUserId(req);
  const jobId    = req.params.id;

  try {
    const explanation = await getMatchExplanation(githubId, jobId);
    res.json(explanation);
  } catch (err) {
    console.error("[GET /api/ai/jobs/:id/match-explicacao]", err.message);
    res.status(502).json({ error: "Erro ao gerar explicação com IA. Tente novamente em instantes." });
  }
});

// ── Mentor de carreira (chat) — exclusivo plano PRO ──────────
const MENTOR_GATE_MSG = "O mentor de carreira é exclusivo do plano PRO. Faça upgrade para conversar com o mentor.";

router.get("/mentor/historico", isAuth, requireFeature("mentor_carreira", MENTOR_GATE_MSG), async (req, res) => {
  try {
    const history = await getHistory(req.session.user.id);
    res.json(history);
  } catch (err) {
    console.error("[GET /api/ai/mentor/historico]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
});

router.post(
  "/mentor/mensagem",
  isAuth,
  requireFeature("mentor_carreira", MENTOR_GATE_MSG),
  body("mensagem").trim().isLength({ min: 1, max: 2000 }).withMessage("Mensagem deve ter entre 1 e 2000 caracteres."),
  handleValidation,
  async (req, res) => {
    const userId   = req.session.user.id;
    const githubId = req.session.user.github_id ?? userId;
    const nivel    = req.session.user.nivel;

    try {
      const resposta = await sendMessage(userId, githubId, nivel, req.body.mensagem);
      res.status(201).json({ resposta });
    } catch (err) {
      console.error("[POST /api/ai/mentor/mensagem]", err.message);
      res.status(502).json({ error: "Erro ao falar com o mentor. Tente novamente em instantes." });
    }
  }
);

// ── Simulador de entrevista técnica — exclusivo plano PRO ────
const ENTREVISTA_GATE_MSG = "O simulador de entrevista técnica é exclusivo do plano PRO. Faça upgrade para praticar.";

router.post(
  "/entrevista/iniciar",
  isAuth,
  requireFeature("simulador_entrevista", ENTREVISTA_GATE_MSG),
  body("job_id").optional({ nullable: true }).isInt({ min: 1 }).withMessage("job_id deve ser inteiro positivo.").toInt(),
  handleValidation,
  async (req, res) => {
    const userId   = req.session.user.id;
    const githubId = req.session.user.github_id ?? userId;
    const nivel    = req.session.user.nivel;
    const jobId    = req.body.job_id ?? null;

    try {
      const simulacao = await gerarPergunta(userId, githubId, nivel, jobId);
      res.status(201).json(simulacao);
    } catch (err) {
      console.error("[POST /api/ai/entrevista/iniciar]", err.message);
      res.status(502).json({ error: "Erro ao gerar pergunta com IA. Tente novamente em instantes." });
    }
  }
);

router.post(
  "/entrevista/:id/responder",
  isAuth,
  requireFeature("simulador_entrevista", ENTREVISTA_GATE_MSG),
  ...intParam("id"),
  body("resposta").trim().isLength({ min: 1, max: 4000 }).withMessage("Resposta deve ter entre 1 e 4000 caracteres."),
  handleValidation,
  async (req, res) => {
    try {
      const resultado = await avaliarResposta(req.session.user.id, req.params.id, req.body.resposta);
      res.json(resultado);
    } catch (err) {
      console.error("[POST /api/ai/entrevista/:id/responder]", err.message);
      if (err.message === "Simulação não encontrada.") {
        return res.status(404).json({ error: err.message });
      }
      res.status(502).json({ error: "Erro ao avaliar resposta com IA. Tente novamente em instantes." });
    }
  }
);

// ── Insights de mercado — página pública, sem gate de plano ──
// Idealmente rodaria como rotina periódica (cron); por ora, gera sob
// demanda quando não há um insight ainda salvo.
router.get("/insights-mercado", async (req, res) => {
  try {
    const cached = await getLatestInsights();
    if (cached) return res.json(cached);

    const insights = await generateInsights();
    res.json(insights);
  } catch (err) {
    console.error("[GET /api/ai/insights-mercado]", err.message);
    if (err.message.includes("Nenhuma vaga")) {
      return res.status(404).json({ error: "Ainda não há dados suficientes de vagas pra gerar insights." });
    }
    res.status(502).json({ error: "Erro ao gerar insights com IA. Tente novamente em instantes." });
  }
});

module.exports = router;
