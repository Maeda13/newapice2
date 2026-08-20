// ============================================
// services/anthropicClient.js
// Client fino pra Messages API da Anthropic (Claude).
// Ponto único de configuração — todo serviço de IA
// passa por aqui, igual subscriptionService.js é o
// ponto único pra consulta de planos.
// ============================================
const axios = require("axios");

const MODEL   = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";

// --------------------------------------------
// Pede uma resposta em JSON estruturado ao Claude.
// system:    instruções de contexto (papel, formato esperado)
// prompt:    conteúdo da requisição (dados já filtrados pro LGPD)
// maxTokens: teto de tokens de saída
// --------------------------------------------
async function askClaudeJSON({ system, prompt, maxTokens = 2048 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada.");
  }

  const res = await axios.post(
    API_URL,
    {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 30000,
    }
  );

  const text = res.data?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    // Claude não retornou JSON válido apesar do pedido no prompt —
    // trata como falha de integração, não derruba o processo chamador.
    throw new Error("Resposta da IA não veio em JSON válido.");
  }
}

module.exports = { askClaudeJSON, MODEL };
