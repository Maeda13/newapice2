// ============================================
// database/migration-jobs-v2.js
// Adiciona campos avançados à tabela jobs:
// modality, contract_type, salary, location,
// years_experience, english_level, responsibilities,
// benefits, max_candidates, tags
//
// Como usar: node database/migration-jobs-v2.js
// ============================================
require("dotenv").config();
const db = require("./db");

async function columnExists(table, column) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS total FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [table, column]);
  return rows[0].total > 0;
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) {
    console.log(`⏭  ${column} já existe — pulando`);
  } else {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`✅ Coluna ${column} adicionada`);
  }
}

async function migrate() {
  try {
    console.log("🔄 Iniciando migration jobs-v2...\n");

    await addColumn("jobs", "modality",        "ENUM('presencial','remoto','hibrido') DEFAULT 'remoto'");
    await addColumn("jobs", "contract_type",   "ENUM('clt','pj','estagio','freelancer') DEFAULT 'estagio'");
    await addColumn("jobs", "salary_min",      "INT UNSIGNED NULL");
    await addColumn("jobs", "salary_max",      "INT UNSIGNED NULL");
    await addColumn("jobs", "location",        "VARCHAR(255) NULL");
    await addColumn("jobs", "years_experience","TINYINT UNSIGNED DEFAULT 0");
    await addColumn("jobs", "english_level",   "ENUM('nenhum','basico','intermediario','avancado','fluente') DEFAULT 'nenhum'");
    await addColumn("jobs", "responsibilities","TEXT NULL");
    await addColumn("jobs", "benefits",        "TEXT NULL");
    await addColumn("jobs", "max_candidates",  "SMALLINT UNSIGNED DEFAULT 100");
    await addColumn("jobs", "tags",            "VARCHAR(500) NULL");

    console.log("\n🎉 Migration jobs-v2 concluída com sucesso!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro na migration:", err.message);
    process.exit(1);
  }
}

migrate();
