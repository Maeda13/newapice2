// ============================================
// services/iaErros.js
// Erro padronizado das chamadas de IA (Gemini e
// fallback multi-provedor). Classifica a falha —
// tempo esgotado, limite de uso, provedor
// sobrecarregado, chave ausente/inválida, resposta
// ruim — para o retry saber o que vale repetir e as
// rotas responderem com o status HTTP certo.
// ============================================

class ErroIA extends Error {
  // tipo:       "tempo" | "limite" | "sobrecarga" | "rede" | "config" | "chave"
  //             | "requisicao" | "vazia" | "cortada" | "json" | "indisponivel" | "desconhecido"
  // status:     status HTTP devolvido pelo provedor, se houve resposta
  // temporario: true quando tentar de novo em instantes pode dar certo
  constructor(mensagem, { tipo = "desconhecido", status = null, temporario = false } = {}) {
    super(mensagem);
    this.name = "ErroIA";
    this.tipo = tipo;
    this.status = status;
    this.temporario = temporario;
  }
}

// Status HTTP do erro do provedor: @google/genai usa status ou statusCode,
// o SDK da OpenAI usa status.
function statusDoErro(err) {
  return err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
}

// sinal: o AbortSignal da tentativa — se ele abortou, quem estourou foi o
// nosso prazo (não um erro do provedor).
function classificarErro(err, sinal) {
  const status = statusDoErro(err);
  const texto = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (sinal?.aborted || /timeout|timed out|aborted/i.test(texto)) return { tipo: "tempo", status, temporario: true };
  if (status === 429) return { tipo: "limite", status, temporario: true };
  if (status === 408 || status === 409 || (status >= 500 && status <= 599)) return { tipo: "sobrecarga", status, temporario: true };
  if (status === 401 || status === 403) return { tipo: "chave", status, temporario: false };
  if (status) return { tipo: "requisicao", status, temporario: false };
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|connection/i.test(texto)) {
    return { tipo: "rede", status, temporario: true };
  }
  return { tipo: "desconhecido", status, temporario: false };
}

// Status HTTP para as rotas de IA. 503 quando a IA está indisponível agora
// (sobrecarga, limite, tempo esgotado) ou mal configurada (sem chave / chave
// inválida); 502 quando o provedor respondeu algo inutilizável. Erros que
// não são de IA (banco, validação...) ficam com o padrão de quem chama.
function statusHttpDaIA(err, padrao = 502) {
  if (!(err instanceof ErroIA)) return padrao;
  return err.temporario || err.tipo === "config" || err.tipo === "chave" ? 503 : 502;
}

module.exports = { ErroIA, classificarErro, statusHttpDaIA };
