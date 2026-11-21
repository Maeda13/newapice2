#!/usr/bin/env node
// ============================================
// scripts/verificar-backup.js
// Confere um backup .sql (mysqldump do Clever Cloud ou de scripts/dump-banco.js) SEM mostrar nenhum dado:
// só tamanho, final do arquivo, tabelas, quais têm INSERT (e quantos) e as colunas de roadmap_fases.
// Pode ser colado numa conversa: a saída não contém linhas de dados nem credenciais.
//
// Aceita .sql e .gz (descompacta em fluxo, sem gravar nada).
// Uso: node scripts/verificar-backup.js "C:\backups-apice\ARQUIVO"
// ============================================
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) { console.error("Uso: node scripts/verificar-backup.js \"C:\\caminho\\do\\arquivo\""); process.exit(1); }
  const caminho = path.resolve(arquivo);
  if (!fs.existsSync(caminho)) { console.error(`❌ Não achei o arquivo: ${caminho}`); process.exit(1); }
  const info = fs.statSync(caminho);
  if (info.isDirectory()) { console.error("❌ Isso é uma pasta, não um arquivo. Aponte para o arquivo dentro dela."); process.exit(1); }

  // .gz? (pela extensão ou pelos 2 bytes iniciais)
  const cabeca = Buffer.alloc(2);
  const fd = fs.openSync(caminho, "r"); fs.readSync(fd, cabeca, 0, 2, 0); fs.closeSync(fd);
  const gz = cabeca[0] === 0x1f && cabeca[1] === 0x8b;
  let fluxo = fs.createReadStream(caminho);
  if (gz) fluxo = fluxo.pipe(zlib.createGunzip());

  const tabelas = new Map();          // nome -> { criada, inserts }
  const colunasFases = [];
  let dentroDeFases = false;
  let linhas = 0, ultimas = [], bytesTexto = 0, versao = null, nenhumaEstrutura = true;

  const rl = readline.createInterface({ input: fluxo, crlfDelay: Infinity });
  for await (const linha of rl) {
    linhas++; bytesTexto += linha.length + 1;
    if (!versao) { const m = linha.match(/^-- (MySQL dump [^\s]+.*|Dump gerado por .*)$/); if (m) versao = m[1].slice(0, 90); }

    let m = linha.match(/^CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`/);
    if (m) {
      nenhumaEstrutura = false;
      if (!tabelas.has(m[1])) tabelas.set(m[1], { criada: true, inserts: 0 });
      dentroDeFases = m[1] === "roadmap_fases";
    } else if (dentroDeFases) {
      const c = linha.match(/^\s+`([^`]+)`\s/);
      if (c) colunasFases.push(c[1]);
      if (/^\)/.test(linha)) dentroDeFases = false;
    }
    m = linha.match(/^INSERT INTO `([^`]+)`/);
    if (m) {
      if (!tabelas.has(m[1])) tabelas.set(m[1], { criada: false, inserts: 0 });
      tabelas.get(m[1]).inserts++;
    }
    // guarda as últimas linhas; só serão exibidas se forem comentário/SET (nunca dados)
    ultimas.push(linha); if (ultimas.length > 4) ultimas.shift();
  }

  const lista = [...tabelas.entries()];
  const comDados = lista.filter(([, t]) => t.inserts > 0);
  const seguras = ultimas.filter(l => /^(--|\/\*!|SET |UNLOCK|COMMIT|$)/.test(l)).map(l => l.slice(0, 100));
  const completo = ultimas.some(l => /Dump completed/i.test(l));

  console.log(`Arquivo: ${path.basename(caminho)}${gz ? "  (compactado .gz — lido em fluxo)" : ""}`);
  console.log(`Tamanho em disco: ${info.size} bytes | linhas: ${linhas}${gz ? ` | texto descompactado: ${bytesTexto} bytes` : ""}`);
  if (versao) console.log(`Origem: ${versao}`);
  console.log(`Tabelas (CREATE TABLE): ${lista.filter(([, t]) => t.criada).length} | com dados (INSERT): ${comDados.length}`);
  console.log(`\nÚltimas linhas (apenas comentários/SET, nunca dados):`);
  for (const l of seguras) console.log(`  ${l}`);
  console.log(`\nColunas de roadmap_fases (só nomes): ${colunasFases.length ? colunasFases.join(", ") : "(tabela não encontrada)"}`);
  const novas = ["projeto_habilidades", "projeto_ultimo_envio_em"].filter(c => colunasFases.includes(c));
  console.log(`Colunas novas já presentes: ${novas.length ? novas.join(", ") : "nenhuma (estado de ANTES da migração, como esperado)"}`);
  const sess = tabelas.get("sessions");
  console.log(`Tabela sessions: ${sess ? (sess.inserts > 0 ? "COM dados (contém tokens de sessão — guarde com cuidado)" : "só estrutura") : "não encontrada"}`);
  console.log(`\nTabelas com INSERT (nº de comandos, não de linhas): ` + (comDados.map(([n, t]) => `${n}(${t.inserts})`).join(", ") || "nenhuma"));

  const problemas = [];
  if (!completo) problemas.push("o final do arquivo NÃO tem 'Dump completed' (pode estar cortado)");
  if (nenhumaEstrutura) problemas.push("nenhum CREATE TABLE encontrado");
  if (!colunasFases.length) problemas.push("roadmap_fases não encontrada");
  if (info.size < 10_000) problemas.push("arquivo muito pequeno");
  if (problemas.length) console.log(`\n❌ Atenção: ${problemas.join("; ")}.`);
  else console.log("\n✅ Backup completo: estrutura de todas as tabelas e final do arquivo corretos.");
  if (!problemas.length) {
    console.log(novas.length
      ? "ℹ️  As colunas novas JÁ estão neste backup (ele foi tirado depois da migração)."
      : "ℹ️  roadmap_fases está no estado de ANTES da migração (sem as colunas novas).");
  }
  process.exit(problemas.length ? 1 : 0);
}

main().catch(e => { console.error("❌ Falha ao ler o arquivo:", e.message); process.exit(1); });
