// ============================================
// database/seed-admin.js
// Cria a conta de administrador a partir das
// variáveis ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NOME.
//
// Não existe cadastro público de admin por segurança — essa é
// a única forma de criar a primeira conta.
//
// Como usar: node database/seed-admin.js
// Seguro de rodar mais de uma vez — não duplica a conta.
// ============================================
require("dotenv").config();
const bcrypt = require("bcrypt");
const db     = require("./db");

const SALT_ROUNDS = 10;

async function seedAdmin() {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const nome     = process.env.ADMIN_NOME || "Administrador";

  if (!email || !password) {
    console.error("❌ Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env antes de rodar este script.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("❌ ADMIN_PASSWORD deve ter no mínimo 8 caracteres.");
    process.exit(1);
  }

  try {
    await db.ready; // garante que as migrações (users.type=admin, user_admin_profiles) já rodaram

    const emailNormalizado = String(email).toLowerCase().trim();
    const [existing] = await db.query("SELECT id, type FROM users WHERE email = ?", [emailNormalizado]);

    if (existing.length > 0) {
      console.log(`⏭  Já existe uma conta com esse e-mail (tipo: ${existing[0].type}) — nada a fazer.`);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await db.query(
      "INSERT INTO users (email, password_hash, type) VALUES (?, ?, 'admin')",
      [emailNormalizado, passwordHash]
    );

    await db.query(
      "INSERT INTO user_admin_profiles (user_id, nome) VALUES (?, ?)",
      [result.insertId, nome]
    );

    console.log(`🎉 Conta admin criada: ${emailNormalizado}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro ao criar conta admin:", err.message);
    process.exit(1);
  }
}

seedAdmin();
