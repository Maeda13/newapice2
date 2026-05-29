// ============================================
// database/migration-avatar.js
// Adiciona avatar_url à tabela user_dev_profiles
// Como usar: node database/migration-avatar.js
// ============================================
require("dotenv").config();
const db = require("./db");

async function columnExists(table, column) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND COLUMN_NAME  = ?
  `, [table, column]);
  return rows[0].total > 0;
}

async function migrate() {
  try {
    console.log("🔄 Iniciando migration de avatar...\n");

    if (await columnExists("user_dev_profiles", "avatar_url")) {
      console.log("⏭  avatar_url já existe — pulando");
    } else {
      await db.query(`ALTER TABLE user_dev_profiles ADD COLUMN avatar_url VARCHAR(500) NULL`);
      console.log("✅ Coluna avatar_url adicionada em user_dev_profiles");
    }

    console.log("\n🎉 Migration concluída!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  }
}

migrate();

