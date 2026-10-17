// Mensagens amigáveis para status/erros do Mercado Pago (services/mpMessages.js)
const { MPBadRequestError, MPAuthenticationError, MPServerError, MPConnectionError } = require("mercadopago");
const { classifyMpError, reasonMessage, isKnownReason, paymentStatusLabel, subscriptionStatusLabel } = require("../../services/mpMessages");

const bad = message => new MPBadRequestError({ status: 400, message });

test.each([
  ["CC_VAL_433 Credit card validation has failed",           "cartao_recusado",    402],
  ["Card token service not found",                           "token_invalido",     422],
  ["Both payer and collector must be real or test users",    "configuracao_teste", 422],
  ["Invalid users involved",                                 "configuracao_teste", 422],
  ["Payer and collector cannot be the same user",            "mesmo_usuario",      422],
  ["Invalid payer_email",                                    "email_invalido",     422],
  ["payment rejected: cc_rejected_insufficient_amount",      "cc_rejected_insufficient_amount", 402],
  ["algo que ninguém previu",                                "generico",           402],
])("erro de criação %p → %s (%i)", (message, reason, httpStatus) => {
  expect(classifyMpError(bad(message))).toMatchObject({ reason, httpStatus });
});

test("credencial inválida (401) é problema de configuração, não do cartão", () => {
  expect(classifyMpError(new MPAuthenticationError({ status: 401, message: "invalid access token" })))
    .toMatchObject({ reason: "indisponivel", httpStatus: 503, configProblem: true });
});

test("5xx/rede → indisponível (o usuário pode tentar de novo)", () => {
  expect(classifyMpError(new MPServerError({ status: 500, message: "internal" })).reason).toBe("indisponivel");
  expect(classifyMpError(new MPConnectionError(new Error("ECONNRESET"))).reason).toBe("indisponivel");
});

test("status_detail conhecidos têm tradução; desconhecidos caem no genérico", () => {
  expect(reasonMessage("cc_rejected_bad_filled_security_code")).toBe("Confira o código de segurança (CVV) do cartão.");
  expect(reasonMessage("cc_rejected_call_for_authorize")).toMatch(/Ligue para o seu banco/);
  expect(reasonMessage("qualquer_coisa")).toBe(reasonMessage("generico"));
  expect(reasonMessage("__proto__")).toBe(reasonMessage("generico"));
  expect(isKnownReason("cartao_recusado")).toBe(true);
  expect(isKnownReason("<script>")).toBe(false);
});

test("rótulos em português", () => {
  expect(subscriptionStatusLabel("authorized")).toBe("Ativa");
  expect(subscriptionStatusLabel("cancelled")).toBe("Cancelada");
  expect(paymentStatusLabel("approved")).toBe("Aprovado");
  expect(paymentStatusLabel("rejected")).toBe("Recusado");
});
