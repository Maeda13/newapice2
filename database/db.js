// ============================================
// database/db.js
// Conexão com o banco MySQL do Clever Cloud
// ============================================
const mysql = require("mysql2/promise");

// Cria um "pool" de conexões.
// Pool significa que o Node.js reaproveita conexões abertas
// ao invés de abrir e fechar uma nova a cada consulta.
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT     || 3306,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit:    4,
  queueLimit:         0,
});

// Testa a conexão ao iniciar o servidor
pool.getConnection()
  .then(conn => {
    console.log("✅ Banco de dados conectado com sucesso");
    conn.release(); // Devolve a conexão para o pool
  })
  .catch(err => {
    console.error("❌ Erro ao conectar no banco:", err.message);
  });

module.exports = pool;