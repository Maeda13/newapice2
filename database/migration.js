// ============================================
// database/migration.js
// Adiciona company_id, active e created_at
// à tabela jobs para associar vagas às empresas.
//
// Como usar: node database/migration.js
// Seguro de rodar mais de uma vez.
//
// FIX: MySQL não suporta ADD COLUMN IF NOT EXISTS
// (é sintaxe do PostgreSQL). A solução correta é
// consultar o information_schema antes de cada ALTER.
// ============================================
require("dotenv").config();
const db = require("./db");

// Verifica se uma coluna existe em uma tabela
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

// Verifica se uma constraint (FK) existe
async function constraintExists(constraintName) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA     = DATABASE()
      AND CONSTRAINT_NAME  = ?
  `, [constraintName]);
  return rows[0].total > 0;
}

async function migrate() {
  try {
    console.log("🔄 Iniciando migration...\n");

    // ── company_id ──────────────────────────────────
    if (await columnExists("jobs", "company_id")) {
      console.log("⏭  company_id já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN company_id INT NULL`);
      console.log("✅ Coluna company_id adicionada");
    }

    // ── active ───────────────────────────────────────
    if (await columnExists("jobs", "active")) {
      console.log("⏭  active já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN active BOOLEAN DEFAULT true`);
      console.log("✅ Coluna active adicionada");
    }

    // ── created_at ───────────────────────────────────
    if (await columnExists("jobs", "created_at")) {
      console.log("⏭  created_at já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log("✅ Coluna created_at adicionada");
    }

    // ── Foreign key ──────────────────────────────────
    if (await constraintExists("fk_jobs_company")) {
      console.log("⏭  FK fk_jobs_company já existe — pulando");
    } else {
      await db.query(`
        ALTER TABLE jobs
        ADD CONSTRAINT fk_jobs_company
        FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log("✅ FK fk_jobs_company criada");
    }

    console.log("\n🎉 Migration concluída com sucesso!");
    process.exit(0);

  } catch (err) {
    console.error("❌ Erro na migration:", err.message);
    process.exit(1);
  }
}

migrate();