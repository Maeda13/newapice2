#!/usr/bin/env node
// ============================================
// scripts/conferir-banco.js
// SOMENTE LEITURA DE VERDADE: conexão direta com o mysql2, sessão READ ONLY. NÃO carrega database/db.js
// (o db.js roda migrações automáticas ao ser carregado) e NÃO lê o .env.
//
// Mostra a que banco as variáveis DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS apontam (nome e host
// MASCARADOS), a versão do servidor, quantas tabelas existem, algumas contagens e os NOMES das colunas
// de roadmap_fases. Nada de dados nem credenciais.
//
// Uso: node scripts/conferir-banco.js
// ============================================
const mysql = require("mysql2/promise");

const mascarar = (s) => (s && s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-3)} (${s.length} caracteres)` : `(${(s || "").length} caracteres)`);

(async () => {
  const faltando = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASS"].filter(n => !process.env[n]);
  if (faltando.length) {
    console.error(`❌ Faltam variáveis de ambiente: ${faltando.join(", ")} (este script não lê o .env de propósito).`);
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
  });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const [[info]] = await conn.query("SELECT DATABASE() AS banco, VERSION() AS versao");
    console.log(`Banco:  ${mascarar(info.banco)}`);
    console.log(`Host:   ${mascarar(process.env.DB_HOST)}`);
    console.log(`Servidor: MySQL ${info.versao}`);

    const [[{ n: tabelas }]] = await conn.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    console.log(`Tabelas no banco: ${tabelas}`);

    const contar = async (tabela) => {
      try { const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${tabela}\``); return r.n; }
      catch { return "(tabela não existe)"; }
    };
    console.log(`\nusers: ${await contar("users")} | roadmaps: ${await contar("roadmaps")} | roadmap_fases: ${await contar("roadmap_fases")}`);

    const [cols] = await conn.query("SHOW COLUMNS FROM roadmap_fases");
    const nomes = cols.map(c => c.Field);
    console.log(`\nColunas de roadmap_fases: ${nomes.join(", ")}`);
    for (const c of ["projeto_habilidades", "projeto_ultimo_envio_em"]) {
      console.log(`  ${c}: ${nomes.includes(c) ? "EXISTE" : "não existe"}`);
    }
  } finally {
    await conn.end().catch(() => {});
  }
  process.exit(0);
})().catch((e) => { console.error("❌ Falha:", e.code || "", e.message); process.exit(1); });
