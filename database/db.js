// ============================================
// database/db.js
// Pool de conexão com MySQL
// ============================================
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,

  waitForConnections: true,

  connectionLimit: 5,
  maxIdle: 2,       // deixa conexões livres para o session store
  idleTimeout: 60000,

  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function addColumn(table, column, definition) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (n > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function addUniqueKey(table, keyName, column) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, keyName]
  );
  if (n > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${keyName}\` (\`${column}\`)`);
}

async function testarConexao() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Banco de dados conectado com sucesso");
  } catch (err) {
    console.error("❌ Erro ao conectar no banco:", err.message);
    console.error("   Código:", err.code);
    console.error("   Host:",   process.env.DB_HOST  || "(não definido)");
    console.error("   Porta:",  process.env.DB_PORT  || "3306");
    console.error("   Banco:",  process.env.DB_NAME  || "(não definido)");
    console.error("   Usuário:", process.env.DB_USER || "(não definido)");
    return;
  }

  // ── Migrações automáticas (seguras para re-executar) ──────
  try {
    await addColumn("user_dev_profiles", "github_id", "BIGINT DEFAULT NULL");
    await addUniqueKey("user_dev_profiles", "uq_dev_github_id", "github_id");
    await addColumn("user_dev_profiles", "avatar_url", "VARCHAR(500) DEFAULT NULL");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_match_actions (
        id            INT       NOT NULL AUTO_INCREMENT,
        company_id    INT       NOT NULL,
        dev_github_id BIGINT    NOT NULL,
        job_id        INT       NOT NULL,
        action        ENUM('aceito','recusado') NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_action (company_id, dev_github_id, job_id),
        KEY idx_company (company_id),
        CONSTRAINT fk_cma_company FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_cma_job     FOREIGN KEY (job_id)     REFERENCES jobs(id)  ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id            INT       NOT NULL AUTO_INCREMENT,
        job_id        INT       NOT NULL,
        dev_github_id BIGINT    NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_application (job_id, dev_github_id),
        KEY idx_job (job_id),
        CONSTRAINT fk_app_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await addColumn("user_repositories", "is_public", "TINYINT(1) NOT NULL DEFAULT 0");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_repositories (
        id             INT          NOT NULL AUTO_INCREMENT,
        user_id        INT          NOT NULL,
        repo_name      VARCHAR(255) NOT NULL,
        repo_full_name VARCHAR(255) NOT NULL,
        description    TEXT,
        is_private     TINYINT(1)   NOT NULL DEFAULT 0,
        language       VARCHAR(100),
        stars          INT                   DEFAULT 0,
        updated_at_gh  DATETIME,
        added_at       DATETIME              DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE  KEY uq_user_repo (user_id, repo_full_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  } catch (err) {
    console.error("[migration]", err.message);
  }
}

testarConexao();

module.exports = pool;