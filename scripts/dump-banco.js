#!/usr/bin/env node
// ============================================
// scripts/dump-banco.js
// Backup lógico (.sql) de um banco MySQL usando só o mysql2 que o projeto já tem —
// para quem não tem o `mysqldump` instalado.
//
// SOMENTE LEITURA: a sessão é READ ONLY, numa transação com snapshot consistente
// (InnoDB), com UMA conexão. Não escreve nada no banco.
//
// NÃO lê o .env (de propósito: o alvo precisa ser escolhido de forma explícita).
// As credenciais vêm de variáveis de ambiente próprias deste script:
//   DUMP_HOST  DUMP_PORT (padrão 3306)  DUMP_USER  DUMP_PASS  DUMP_DB   [DUMP_SSL=1]
// Num terminal interativo, o que não estiver definido é PERGUNTADO (a senha é digitada
// sem aparecer na tela e nunca vai para o histórico). Sem terminal, as variáveis são obrigatórias.
//
// Uso (PowerShell), a partir da pasta do projeto:
//   $env:DUMP_HOST="..."; $env:DUMP_USER="..."; $env:DUMP_DB="..."
//   $env:DUMP_PASS = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host -AsSecureString "Senha")))
//   node scripts/dump-banco.js C:\backups-apice\apice-prod-ANTES-migracao.sql
//   Remove-Item Env:DUMP_PASS
//
// O arquivo gerado NÃO tem DROP TABLE: restaurar por cima de um banco que já tem as
// tabelas dá erro em vez de apagar dados. Para restaurar, use um banco VAZIO/descartável.
// Ele contém dados pessoais: guarde FORA do repositório (o script recusa gravar dentro dele).
// ============================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { Writable } = require("stream");
const mysql = require("mysql2/promise");
const { escape } = require("mysql2");

// Só a estrutura (sem linhas): "sessions" guarda a sessão de quem está logado, e ela inclui o token
// do GitHub do usuário. Não é necessária para restaurar o site (todo mundo só precisa logar de novo).
// Use --incluir-sessoes para exportar também esses dados.
const TABELAS_SO_ESTRUTURA = process.argv.includes("--incluir-sessoes") ? [] : ["sessions"];
const LINHAS_POR_INSERT = 500;
const BYTES_POR_INSERT  = 1024 * 1024;

const id = (nome) => "`" + String(nome).replace(/`/g, "``") + "`";
const mascarar = (s) => (s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-3)} (${s.length} caracteres)` : `(${s.length} caracteres)`);

// Valor → literal SQL. Datas já chegam como texto (dateStrings) e números grandes como texto.
function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (Buffer.isBuffer(v)) return v.length ? "0x" + v.toString("hex") : "''";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object" && !(v instanceof Date)) return escape(JSON.stringify(v)); // coluna JSON
  return escape(v instanceof Date ? v.toISOString().slice(0, 23).replace("T", " ") : String(v));
}

// Pergunta no terminal; com oculto=true o texto digitado não aparece: mostra só um * por caractere.
function perguntar(texto, { oculto = false } = {}) {
  return new Promise((ok) => {
    let mostrar = true;
    const saida = new Writable({ write(chunk, enc, cb) { if (mostrar) process.stdout.write(chunk, enc); cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: saida, terminal: true });
    process.stdout.write(texto);
    mostrar = !oculto;
    let digitados = 0;
    const aoTeclar = (caractere, tecla = {}) => {
      if (tecla.name === "backspace") {
        if (digitados > 0) { digitados--; process.stdout.write("\b \b"); }
      } else if (caractere && !tecla.ctrl && !tecla.meta && caractere >= " ") {
        digitados += caractere.length;
        process.stdout.write("*".repeat(caractere.length));
      }
    };
    if (oculto) process.stdin.on("keypress", aoTeclar);
    rl.question("", (resposta) => {
      process.stdin.removeListener("keypress", aoTeclar);
      mostrar = true;
      if (oculto) process.stdout.write("\n");
      rl.close();
      ok(resposta.trim());
    });
  });
}

function falhar(msg) {
  console.error("\n❌ " + msg);
  process.exit(1);
}

async function main() {
  const destino = process.argv.slice(2).find(a => !a.startsWith("--"));
  if (!destino) falhar("Informe o arquivo de saída. Ex.: node scripts/dump-banco.js C:\\backups-apice\\apice-prod.sql");

  const faltando = ["DUMP_HOST", "DUMP_USER", "DUMP_PASS", "DUMP_DB"].filter(n => !process.env[n]);
  if (faltando.length && !(process.stdin.isTTY && process.stdout.isTTY)) {
    falhar(`Faltam variáveis de ambiente: ${faltando.join(", ")}`);
  }
  // Terminal interativo: pergunta só o que faltou (a senha sem aparecer na tela).
  const perguntas = {
    DUMP_HOST: ["Host do banco (aba Information do add-on): ", false],
    DUMP_DB:   ["Nome do banco: ", false],
    DUMP_USER: ["Usuário: ", false],
    DUMP_PASS: ["Senha (aparecem só asteriscos): ", true],
  };
  const dados = {};
  for (const nome of ["DUMP_HOST", "DUMP_DB", "DUMP_USER", "DUMP_PASS"]) {
    dados[nome] = process.env[nome] || await perguntar(perguntas[nome][0], { oculto: perguntas[nome][1] });
    if (!dados[nome]) falhar(`${nome} não informado.`);
  }
  const { DUMP_HOST: host, DUMP_USER: user, DUMP_PASS: password, DUMP_DB: database } = dados;
  const port = Number(process.env.DUMP_PORT) || 3306;

  const arquivo = path.resolve(destino);
  const raiz = path.resolve(__dirname, "..");
  if ((arquivo + path.sep).toLowerCase().startsWith((raiz + path.sep).toLowerCase())) {
    falhar("Recusado: o arquivo de saída está dentro do repositório. Dados pessoais não devem ir para o git. Use uma pasta fora do projeto.");
  }
  if (fs.existsSync(arquivo)) falhar(`O arquivo já existe, não vou sobrescrever: ${arquivo}`);

  const conn = await mysql.createConnection({
    host, port, user, password, database,
    // sem `charset` aqui: a conexão do handshake fica igual à do site (database/db.js); o charset vai por SET NAMES abaixo
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    ssl: process.env.DUMP_SSL ? {} : undefined,
  });
  console.log(`Conectado ao banco ${mascarar(database)} em ${mascarar(host)}.`);
  await conn.query("SET NAMES utf8mb4");

  const saida = fs.createWriteStream(arquivo, { flags: "wx", encoding: "utf8" });
  const hash = crypto.createHash("sha256");
  const escrever = (texto) => new Promise((ok, erro) => {
    hash.update(texto);
    saida.write(texto, e => (e ? erro(e) : ok()));
  });

  try {
    // Só leitura e foto consistente; fuso fixo em UTC (como o mysqldump) para os TIMESTAMP.
    await conn.query("SET SESSION TIME_ZONE = '+00:00'");
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const [lista] = await conn.query("SHOW FULL TABLES");
    const tabelas = lista.filter(r => r.Table_type === "BASE TABLE").map(r => Object.values(r)[0]);
    const visoes  = lista.filter(r => r.Table_type === "VIEW").map(r => Object.values(r)[0]);

    const [motores] = await conn.query(
      "SELECT TABLE_NAME AS t, ENGINE AS e FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    const naoInnoDb = motores.filter(m => String(m.e).toLowerCase() !== "innodb").map(m => `${m.t} (${m.e})`);
    if (naoInnoDb.length) console.warn(`⚠️  Tabelas que não são InnoDB (o snapshot não as cobre): ${naoInnoDb.join(", ")}`);

    await escrever(
      `-- Dump gerado por scripts/dump-banco.js em ${new Date().toISOString()}\n` +
      `-- Banco: ${mascarar(database)} | ${tabelas.length} tabela(s), ${visoes.length} view(s)\n` +
      `/*!40101 SET NAMES utf8mb4 */;\nSET TIME_ZONE = '+00:00';\nSET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\n` +
      `SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n`
    );

    const resumo = [];
    for (const tabela of tabelas) {
      const [[criar]] = await conn.query(`SHOW CREATE TABLE ${id(tabela)}`);
      await escrever(`-- ----------------------------\n-- Tabela ${tabela}\n-- ----------------------------\n${criar["Create Table"]};\n\n`);

      if (TABELAS_SO_ESTRUTURA.includes(tabela)) {
        await escrever(`-- (dados de ${tabela} omitidos de propósito: contêm tokens de sessão; use --incluir-sessoes)

`);
        resumo.push({ tabela, esperado: 0, escritas: 0, ok: true });
        process.stdout.write(`  ${tabela}: só a estrutura (dados omitidos de propósito)
`);
        continue;
      }
      const [[{ n: esperado }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${id(tabela)}`);

      let escritas = 0, colunas = null, lote = [], bytes = 0;
      const descarregar = async () => {
        if (!lote.length) return;
        await escrever(`INSERT INTO ${id(tabela)} (${colunas}) VALUES\n${lote.join(",\n")};\n`);
        lote = []; bytes = 0;
      };
      const fluxo = conn.connection.query(`SELECT * FROM ${id(tabela)}`).stream();
      for await (const linha of fluxo) {
        if (!colunas) colunas = Object.keys(linha).map(id).join(", ");
        const valores = "(" + Object.values(linha).map(literal).join(", ") + ")";
        lote.push(valores); bytes += valores.length; escritas++;
        if (lote.length >= LINHAS_POR_INSERT || bytes >= BYTES_POR_INSERT) await descarregar();
      }
      await descarregar();
      await escrever("\n");
      resumo.push({ tabela, esperado: Number(esperado), escritas, ok: Number(esperado) === escritas });
      process.stdout.write(`  ${tabela}: ${escritas} linha(s)\n`);
    }

    for (const visao of visoes) {
      const [[v]] = await conn.query(`SHOW CREATE VIEW ${id(visao)}`);
      await escrever(`-- View ${visao}\n${v["Create View"]};\n\n`);
    }

    // Triggers (se o usuário puder lê-los). Rotinas não são exportadas.
    try {
      const [triggers] = await conn.query("SHOW TRIGGERS");
      for (const t of triggers) {
        const [[c]] = await conn.query(`SHOW CREATE TRIGGER ${id(t.Trigger)}`);
        await escrever(`-- Trigger ${t.Trigger}\nDELIMITER ;;\n${c["SQL Original Statement"]};;\nDELIMITER ;\n\n`);
      }
    } catch (e) {
      console.warn(`⚠️  Triggers não exportados (${e.code || e.message}).`);
    }

    await conn.query("ROLLBACK"); // nada a confirmar: só leitura
    await escrever(`SET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n-- Dump completed on ${new Date().toISOString()}\n`);
    await new Promise((ok, erro) => saida.end(e => (e ? erro(e) : ok())));

    const ruins = resumo.filter(r => !r.ok);
    const tamanho = fs.statSync(arquivo).size;
    console.log(`\nArquivo: ${arquivo}`);
    console.log(`Tamanho: ${tamanho} bytes | SHA-256: ${hash.digest("hex")}`);
    console.log(`Tabelas: ${resumo.length} | linhas no total: ${resumo.reduce((s, r) => s + r.escritas, 0)}`);
    if (ruins.length) {
      console.error("\n❌ Contagem diferente do COUNT(*) em: " + ruins.map(r => `${r.tabela} (esperado ${r.esperado}, escrito ${r.escritas})`).join("; "));
      process.exitCode = 1;
    } else {
      console.log("✅ Todas as tabelas conferem com o COUNT(*) do mesmo snapshot.");
    }
  } finally {
    await conn.end().catch(() => {});
  }
}

main().catch(e => {
  console.error("\n❌ Falha no dump:", e.code || "", e.message);
  process.exit(1);
});
