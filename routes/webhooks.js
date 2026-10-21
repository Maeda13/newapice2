const express    = require("express");
const router     = express.Router();
const rateLimit  = require("express-rate-limit");
const controller = require("../controllers/assinaturasController");

// Público por natureza (quem chama é o Mercado Pago) — sem sessão, sem
// login. A autenticidade vem do x-signature (MP_WEBHOOK_SECRET) e os dados
// são sempre buscados na API do MP pelo ID, nunca lidos do corpo.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
});

router.post("/mercadopago", webhookLimiter, controller.webhook);

module.exports = router;
