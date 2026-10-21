// ============================================
// services/mpMessages.js
// Traduz status e erros do Mercado Pago para mensagens amigáveis
// em português. Os "motivos" (reason) daqui também aparecem na URL da
// página de resultado (?motivo=...) — a página só exibe textos deste
// arquivo, nunca o valor cru da URL.
// ============================================

const SUBSCRIPTION_STATUS_LABEL = {
  pending:    "Pendente",
  authorized: "Ativa",
  paused:     "Pausada",
  cancelled:  "Cancelada",
};

const PAYMENT_STATUS_LABEL = {
  approved:     "Aprovado",
  authorized:   "Autorizado",
  pending:      "Pendente",
  in_process:   "Em análise",
  in_mediation: "Em disputa",
  rejected:     "Recusado",
  cancelled:    "Cancelado",
  refunded:     "Estornado",
  charged_back: "Contestado",
};

// status_detail de pagamentos com cartão (lista oficial do Mercado Pago).
const STATUS_DETAIL_MESSAGES = {
  accredited:                           "Pagamento aprovado.",
  pending_contingency:                  "Estamos processando o pagamento. Em até 2 dias úteis você recebe o resultado.",
  pending_review_manual:                "O pagamento está em análise. Em até 2 dias úteis você recebe o resultado.",
  cc_rejected_bad_filled_card_number:   "Confira o número do cartão.",
  cc_rejected_bad_filled_date:          "Confira a data de validade do cartão.",
  cc_rejected_bad_filled_other:         "Confira os dados do cartão.",
  cc_rejected_bad_filled_security_code: "Confira o código de segurança (CVV) do cartão.",
  cc_rejected_blacklist:                "Não foi possível processar o pagamento com este cartão. Use outro cartão.",
  cc_rejected_call_for_authorize:       "O emissor do cartão pediu autorização. Ligue para o seu banco para liberar a compra e tente de novo.",
  cc_rejected_card_disabled:            "O cartão está desativado. Ligue para o seu banco para ativá-lo ou use outro cartão.",
  cc_rejected_card_error:               "Não conseguimos processar o pagamento com este cartão. Tente de novo ou use outro cartão.",
  cc_rejected_duplicated_payment:       "Já existe um pagamento igual a este. Se precisar pagar de novo, use outro cartão.",
  cc_rejected_high_risk:                "O pagamento foi recusado pela análise de segurança. Use outro cartão.",
  cc_rejected_insufficient_amount:      "O cartão não tem limite suficiente.",
  cc_rejected_invalid_installments:     "O cartão não aceita este tipo de cobrança.",
  cc_rejected_max_attempts:             "Você atingiu o limite de tentativas com este cartão. Use outro cartão.",
  cc_rejected_other_reason:             "O emissor do cartão recusou o pagamento. Use outro cartão ou fale com o seu banco.",
  cc_amount_rate_limit_exceeded:        "O cartão atingiu o limite de valor permitido. Use outro cartão.",
  cc_rejected_3ds_challenge:            "A autenticação do cartão não foi concluída. Tente de novo.",
  cc_rejected_3ds_mandatory:            "Este cartão exige uma autenticação que não foi concluída. Use outro cartão.",
  cc_rejected_bad_filled_card_data:     "Confira os dados do cartão.",
  cc_rejected_by_regulations:           "O pagamento foi recusado por regras do emissor. Use outro cartão.",
  rejected_high_risk:                   "O pagamento foi recusado pela análise de segurança. Use outro cartão.",
  rejected_by_bank:                     "O banco recusou o pagamento. Use outro cartão ou fale com o seu banco.",
  rejected_insufficient_data:           "Faltaram dados para processar o pagamento. Confira os dados do cartão.",
  bank_error:                           "O banco teve um problema ao processar o pagamento. Tente de novo mais tarde.",
};

// Motivos de recusa na CRIAÇÃO da assinatura (erro devolvido pela API,
// antes de existir um pagamento com status_detail).
const REASON_MESSAGES = {
  cartao_recusado:    "O cartão não passou na validação do Mercado Pago. Confira os dados ou use outro cartão.",
  token_invalido:     "Os dados do cartão expiraram antes do envio. Preencha o cartão de novo.",
  email_invalido:     "O e-mail da sua conta não foi aceito pelo Mercado Pago. Confira o e-mail no seu perfil.",
  configuracao_teste: "Não foi possível processar a assinatura neste ambiente de testes (o pagador precisa ser um usuário de teste do Mercado Pago).",
  mesmo_usuario:      "O e-mail desta conta é o mesmo da conta do Mercado Pago que recebe os pagamentos. Assine com outra conta.",
  indisponivel:       "O Mercado Pago não respondeu a tempo. Nenhuma cobrança foi feita — tente de novo em alguns minutos.",
  generico:           "Não foi possível concluir a assinatura. Confira os dados do cartão ou use outro cartão.",
};

function subscriptionStatusLabel(status) {
  return SUBSCRIPTION_STATUS_LABEL[status] ?? status;
}

function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABEL[status] ?? status;
}

/** Mensagem para um status_detail (ex.: cc_rejected_insufficient_amount) ou motivo conhecido. */
function reasonMessage(code) {
  if (typeof code === "string") {
    if (Object.hasOwn(STATUS_DETAIL_MESSAGES, code)) return STATUS_DETAIL_MESSAGES[code];
    if (Object.hasOwn(REASON_MESSAGES, code)) return REASON_MESSAGES[code];
  }
  return REASON_MESSAGES.generico;
}

function isKnownReason(code) {
  return typeof code === "string" &&
    (Object.hasOwn(STATUS_DETAIL_MESSAGES, code) || Object.hasOwn(REASON_MESSAGES, code));
}

/**
 * Classifica um erro do SDK do Mercado Pago ao criar/alterar a assinatura.
 * Devolve { reason, message, httpStatus, configProblem } — configProblem
 * indica erro do nosso lado (credencial, conta de teste), que merece log
 * de erro com dica para quem mantém o sistema.
 */
function classifyMpError(err) {
  const text = [err?.message, err?.error, JSON.stringify(err?.causes ?? [])].join(" ");

  // Algumas respostas trazem o próprio status_detail (cc_rejected_...).
  const detail = text.match(/\b(cc_rejected_[a-z0-9_]+|cc_amount_rate_limit_exceeded|rejected_[a-z_]+)\b/);
  if (detail && Object.hasOwn(STATUS_DETAIL_MESSAGES, detail[1])) {
    return { reason: detail[1], message: STATUS_DETAIL_MESSAGES[detail[1]], httpStatus: 402, configProblem: false };
  }

  if (err?.status === 401 || err?.status === 403) {
    return { reason: "indisponivel", message: REASON_MESSAGES.indisponivel, httpStatus: 503, configProblem: true };
  }
  if (err?.status >= 500 || err?.name === "MPConnectionError") {
    return { reason: "indisponivel", message: REASON_MESSAGES.indisponivel, httpStatus: 503, configProblem: false };
  }
  if (/same user|cannot pay (to )?yourself|payer.{0,20}collector.{0,20}same/i.test(text)) {
    return { reason: "mesmo_usuario", message: REASON_MESSAGES.mesmo_usuario, httpStatus: 422, configProblem: true };
  }
  if (/real or test users|test users|invalid users involved|live credentials|different countries/i.test(text)) {
    return { reason: "configuracao_teste", message: REASON_MESSAGES.configuracao_teste, httpStatus: 422, configProblem: true };
  }
  if (/CC_VAL_\d+|validation has failed|card validation/i.test(text)) {
    return { reason: "cartao_recusado", message: REASON_MESSAGES.cartao_recusado, httpStatus: 402, configProblem: false };
  }
  if (/card[_ ]?token|token/i.test(text)) {
    return { reason: "token_invalido", message: REASON_MESSAGES.token_invalido, httpStatus: 422, configProblem: false };
  }
  if (/payer_email|e-?mail/i.test(text)) {
    return { reason: "email_invalido", message: REASON_MESSAGES.email_invalido, httpStatus: 422, configProblem: false };
  }
  return { reason: "generico", message: REASON_MESSAGES.generico, httpStatus: 402, configProblem: false };
}

module.exports = {
  subscriptionStatusLabel, paymentStatusLabel,
  reasonMessage, isKnownReason, classifyMpError,
};
