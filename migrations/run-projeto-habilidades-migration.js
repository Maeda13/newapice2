// ============================================
// migrations/run-projeto-habilidades-migration.js
// Aplica 20261119_projeto_habilidades_up.sql (ou o _down com --down) usando
// o pool já existente (database/db.js), no mesmo padrão dos outros runners.
// Idempotente: confere se a coluna já existe (up) / não existe (down).
//
// Uso: npm run migrate:projeto-habilidades
//      npm run migrate:projeto-habilidades -- --down
// ============================================
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");

const DOWN     = process.argv.includes("--down");
const SQL_FILE = path.join(__dirname, DOWN ? "20261119_projeto_habilidades_down.sql" : "20261119_projeto_habilidades_up.sql");

async function run() {
  await db.ready;

  const [[{ n }]] = await db.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roadmap_fases' AND COLUMN_NAME = 'projeto_habilidades'`
  );
  if (DOWN ? n === 0 : n > 0) {
    console.log(`ℹ️  Nada a fazer: a coluna ${DOWN ? "já não existe" : "já existe"}.`);
    process.exit(0);
  }

  const statements = fs.readFileSync(SQL_FILE, "utf8")
    .split(";")
    .map(s => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);

  for (const statement of statements) await db.query(statement);

  console.log(`✅ Migração das habilidades do projeto ${DOWN ? "revertida" : "aplicada"}.`);
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro ao aplicar a migração:", err.message);
  process.exit(1);
});
