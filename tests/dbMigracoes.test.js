// tests/dbMigracoes.test.js
// Migrações automáticas (database/db.js → testarConexao): cada uma vale sozinha.
// Antes, todas ficavam num único try/catch e a primeira que falhasse fazia as
// seguintes serem puladas em silêncio — tabelas e colunas faltando, e recursos
// que "não salvam". O mysql2 é simulado: nenhum banco de verdade é usado.
const mockConsultas = [];
let mockFalharEm = null;

jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => ({
    query: jest.fn(async (sql) => {
      const s = String(sql).replace(/\s+/g, " ").trim();
      mockConsultas.push(s);
      if (mockFalharEm && mockFalharEm.test(s)) throw Object.assign(new Error("falha simulada"), { code: "ER_SIMULADO" });
      if (/^SELECT COUNT\(\*\) AS n FROM INFORMATION_SCHEMA/i.test(s)) return [[{ n: 0 }]];
      if (/^SELECT COLUMN_TYPE AS colType/i.test(s)) return [[{ colType: "enum('dev','empresa','admin')" }]];
      return [[{ 1: 1 }], []];
    }),
    on: jest.fn(),
  })),
}));

function carregarDb() {
  let db;
  jest.isolateModules(() => { db = require("../database/db"); });
  return db;
}

beforeEach(() => {
  mockConsultas.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { mockFalharEm = null; jest.restoreAllMocks(); });

test("uma migração do começo falhando não impede as seguintes", async () => {
  mockFalharEm = /^ALTER TABLE `user_dev_profiles` ADD COLUMN `github_id`/; // a primeira do bloco
  await carregarDb().ready;
  // as do fim do bloco continuam rodando
  expect(mockConsultas.some(s => /CREATE TABLE IF NOT EXISTS usage_events/.test(s))).toBe(true);
  expect(mockConsultas.some(s => /CREATE TABLE IF NOT EXISTS annual_payments/.test(s))).toBe(true);
  // e o log diz qual falhou
  expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[migration\] falhou: addColumn user_dev_profiles\.github_id/));
});

test("um CREATE TABLE falhando é registrado pelo nome da tabela e o resto segue", async () => {
  mockFalharEm = /CREATE TABLE IF NOT EXISTS mentor_chats/;
  const db = await (async () => { const d = carregarDb(); await d.ready; return d; })();
  expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[migration\] falhou: CREATE TABLE IF NOT EXISTS mentor_chats/));
  expect(mockConsultas.some(s => /CREATE TABLE IF NOT EXISTS annual_payments/.test(s))).toBe(true);
  expect(db.migracoesComFalha).toEqual(["CREATE TABLE IF NOT EXISTS mentor_chats"]);
});

test("as tabelas do roadmap e da análise de perfil (antes só criadas rodando o .sql à mão) são criadas na subida", async () => {
  await carregarDb().ready;
  const criadas = mockConsultas.map(s => (s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1]).filter(Boolean);
  for (const t of ["roadmaps", "roadmap_fases", "recursos", "recursos_pendentes", "roadmap_etapas", "user_skill_evidencias", "user_skill_declaracoes"]) {
    expect(criadas).toContain(t);
  }
  // na ordem das FKs: roadmap_etapas depende de roadmap_fases e de recursos
  expect(criadas.indexOf("roadmap_etapas")).toBeGreaterThan(criadas.indexOf("roadmap_fases"));
  expect(criadas.indexOf("roadmap_etapas")).toBeGreaterThan(criadas.indexOf("recursos"));
});

test("dos arquivos .sql, só CREATE TABLE IF NOT EXISTS roda na subida (nada que altere ou apague)", async () => {
  await carregarDb().ready;
  const doArquivo = mockConsultas.filter(s => /roadmap|recursos|user_skill_(evidencias|declaracoes)/.test(s) && !/^SELECT/.test(s));
  expect(doArquivo.length).toBeGreaterThan(0);
  for (const s of doArquivo) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS /);
});

test("uma tabela do arquivo falhando não impede as outras", async () => {
  mockFalharEm = /CREATE TABLE IF NOT EXISTS roadmaps /;
  const db = carregarDb();
  await db.ready;
  expect(db.migracoesComFalha).toEqual(["CREATE TABLE IF NOT EXISTS roadmaps"]);
  expect(mockConsultas.some(s => /CREATE TABLE IF NOT EXISTS user_skill_declaracoes/.test(s))).toBe(true);
});

test("sem falhas, nenhuma migração é registrada como falha", async () => {
  const db = carregarDb();
  await db.ready;
  expect(db.migracoesComFalha).toEqual([]);
  expect(console.error).not.toHaveBeenCalledWith(expect.stringMatching(/\[migration\]/));
});
