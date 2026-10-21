// ============================================
// middlewares/mpCheckoutCsp.js
// CSP das páginas que montam o Card Payment Brick (SDK JS v2 do Mercado
// Pago). Substitui o header da CSP global (server.js) só nessas rotas —
// o resto do site continua sem liberar domínios de terceiros.
//
// O SDK carrega scripts, estilos e imagens de domínios do Mercado Pago/
// Mercado Livre, renderiza os campos do cartão em iframes (Secure Fields)
// e faz chamadas à API (métodos de pagamento, tokenização, antifraude).
// ============================================
const helmet = require("helmet");

const MP_SOURCES = [
  "https://sdk.mercadopago.com",
  "https://*.mercadopago.com",
  "https://*.mercadopago.com.br",
  "https://*.mercadolibre.com",
  "https://*.mercadolivre.com",
  "https://*.mercadolivre.com.br",
  "https://*.mlstatic.com",
];

const mpCheckoutCsp = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc:    ["'self'"],
    scriptSrc:     ["'self'", "'unsafe-inline'", ...MP_SOURCES],
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", ...MP_SOURCES],
    fontSrc:       ["'self'", "data:", "https://fonts.gstatic.com", ...MP_SOURCES],
    imgSrc:        ["'self'", "data:", "blob:", "https://avatars.githubusercontent.com", ...MP_SOURCES],
    connectSrc:    ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", ...MP_SOURCES],
    frameSrc:      ["'self'", ...MP_SOURCES],
    workerSrc:     ["'self'", "blob:"],
  },
});

module.exports = { mpCheckoutCsp, MP_SOURCES };
