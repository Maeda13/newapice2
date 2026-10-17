// ============================================
// config/mercadopago.js
// Credenciais do Mercado Pago — lidas SOMENTE de variáveis de ambiente
// (.env local / Environment do Render). Ver docs/ASSINATURAS.md.
//
//   MP_ACCESS_TOKEN    backend apenas — nunca vai para o front nem para logs
//   MP_PUBLIC_KEY      pode ir para o front (usada pelo Card Payment Brick)
//   MP_WEBHOOK_SECRET  valida o header x-signature dos webhooks
//   APP_BASE_URL       URL pública do site (opcional: cai para APP_URL)
//
// Sem MP_ACCESS_TOKEN/MP_PUBLIC_KEY o servidor sobe normalmente: as
// páginas de assinatura mostram "Assinaturas temporariamente
// indisponíveis" e o resto do site funciona como antes.
// ============================================
const { MercadoPagoConfig } = require("mercadopago");

const accessToken   = (process.env.MP_ACCESS_TOKEN   || "").trim();
const publicKey     = (process.env.MP_PUBLIC_KEY     || "").trim();
const webhookSecret = (process.env.MP_WEBHOOK_SECRET || "").trim();
const baseUrl       = (process.env.APP_BASE_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");

const isConfigured = Boolean(accessToken && publicKey);

// Credenciais TEST-... (aba "Credenciais de teste"). Credenciais de produção
// de uma conta de teste também começam com APP_USR-, então isso é só uma
// pista para os logs — o código funciona igual nos dois modos.
const looksLikeTestCredential = accessToken.startsWith("TEST-");

// Uma configuração NOVA por chamada: os clients do SDK fazem
// `this.config.options = {...this.config.options, ...requestOptions}`, ou
// seja, um requestOptions passado numa chamada vazaria para todas as
// seguintes se o MercadoPagoConfig fosse compartilhado.
function newClientConfig() {
  if (!isConfigured) return null;
  return new MercadoPagoConfig({
    accessToken,
    // O padrão do SDK é 60s por tentativa — longo demais para quem está
    // esperando o checkout responder.
    options: { timeout: 15000 },
  });
}

if (!isConfigured) {
  const missing = [!accessToken && "MP_ACCESS_TOKEN", !publicKey && "MP_PUBLIC_KEY"].filter(Boolean).join(", ");
  console.warn(
    `[mercadopago] Assinaturas desativadas: defina ${missing} no .env (local) ou nas ` +
    "Environment Variables do Render. Veja docs/ASSINATURAS.md."
  );
} else {
  if (!webhookSecret) {
    console.warn(
      "[mercadopago] MP_WEBHOOK_SECRET não definido: webhooks serão aceitos sem validar o " +
      "x-signature (os dados continuam vindo sempre da API do Mercado Pago). Defina-o antes de ir para produção."
    );
  }
  if (!baseUrl) {
    console.warn("[mercadopago] APP_BASE_URL/APP_URL não definido: a back_url dos planos não pode ser montada.");
  }
  if ((process.env.MP_TEST_PAYER_EMAIL || "").trim()) {
    console.warn(
      process.env.NODE_ENV === "production"
        ? "[mercadopago] MP_TEST_PAYER_EMAIL é ignorado com NODE_ENV=production."
        : "[mercadopago] MP_TEST_PAYER_EMAIL ativo: todas as assinaturas usarão esse e-mail de pagador (somente para testes)."
    );
  }
}

module.exports = {
  isConfigured,
  newClientConfig,
  publicKey: isConfigured ? publicKey : "",
  webhookSecret,
  baseUrl,
  looksLikeTestCredential,
  backUrl: `${baseUrl}/assinatura/retorno`,
};
