// ============================================
// services/emailService.js
// Envio de e-mails transacionais (recuperação de senha).
//
// Requer as variáveis de ambiente SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS e SMTP_FROM — sem elas, o transporte
// não é criado e sendPasswordResetEmail() falha com um erro
// claro (o chamador decide como responder ao usuário).
// ============================================
const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP não configurado (defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS no .env).");
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function sendPasswordResetEmail(to, resetUrl) {
  const from = process.env.SMTP_FROM || "Ápice <no-reply@apice.app>";

  await getTransporter().sendMail({
    from,
    to,
    subject: "Redefinição de senha — Ápice",
    text: `Recebemos um pedido para redefinir sua senha.\n\n` +
          `Acesse o link abaixo para escolher uma nova senha (válido por 1 hora):\n${resetUrl}\n\n` +
          `Se você não pediu isso, pode ignorar este e-mail com segurança.`,
    html: `
      <p>Recebemos um pedido para redefinir sua senha na Ápice.</p>
      <p><a href="${resetUrl}">Clique aqui para escolher uma nova senha</a> (link válido por 1 hora).</p>
      <p>Se você não pediu isso, pode ignorar este e-mail com segurança.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
