// tests/dbPool.test.js
// Configuração do pool (database/db.js). O mysql2 é simulado: nenhum banco de
// verdade é usado.
//
// Fuso: o MySQL guarda as datas em UTC e o Render roda em UTC, mas o mysql2,
// por padrão, lê e grava datas no fuso da máquina. Rodando o site num
// computador em horário de Brasília (com o mesmo banco), tudo o que era gravado
// saía 3 horas atrasado e o que era lido aparecia 3 horas adiantado.
//
// Limite de conexões: o usuário do MySQL aceita no máximo 5 conexões ao mesmo
// tempo (max_user_connections), e o session store usa o mesmo pool. Com outra
// instância conectada (deploy sobrepondo a antiga, o site rodando localmente),
// consultas eram recusadas com ER_USER_LIMIT_REACHED e o que o usuário salvava
// (ou a própria sessão) se perdia.
const SqlString = require("sqlstring");

const mockChamadas = [];
let mockResponder = null; // (metodo, sql) => lança um erro para simular falha

jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => {
    const responder = async (metodo, sql) => {
      const s = String(sql).replace(/\s+/g, " ").trim();
      mockChamadas.push(`${metodo} ${s}`);
      if (mockResponder) mockResponder(metodo, s);
      if (/^SELECT COUNT\(\*\) AS n FROM INFORMATION_SCHEMA/i.test(s)) return [[{ n: 1 }]];
      if (/^SELECT COLUMN_TYPE AS colType/i.test(s)) return [[{ colType: "enum('dev','empresa','admin')" }]];
      return [[{ ok: 1 }], []];
    };
    return {
      query: jest.fn((sql) => responder("query", sql)),
      execute: jest.fn((sql) => responder("execute", sql)),
      getConnection: jest.fn(async () => { await responder("getConnection", ""); return { release() {} }; }),
      on: jest.fn(),
    };
  }),
}));

const mysql = require("mysql2/promise");

function carregarDb() {
  mysql.createPool.mockClear();
  let db;
  jest.isolateModules(() => { db = require("../database/db"); });
  return db;
}
const configDoPool = () => { carregarDb(); return mysql.createPool.mock.calls[0][0]; };
const erro = code => Object.assign(new Error(`erro simulado ${code}`), { code });

const tzOriginal = process.env.TZ;
const limiteOriginal = process.env.DB_CONNECTION_LIMIT;
beforeEach(() => {
  mockChamadas.length = 0;
  mockResponder = null;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
  if (limiteOriginal === undefined) delete process.env.DB_CONNECTION_LIMIT; else process.env.DB_CONNECTION_LIMIT = limiteOriginal;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("fuso horário das datas", () => {
  test("o pool lê e grava datas em UTC, como o banco e o Render", () => {
    expect(configDoPool().timezone).toBe("Z");
  });

  test("uma data gravada numa máquina em horário de Brasília sai com a hora certa (UTC)", () => {
    process.env.TZ = "America/Sao_Paulo";
    const { timezone = "local" } = configDoPool();
    const instante = new Date("2026-11-19T15:00:00Z");
    // é assim que o mysql2 monta o valor do "?" no pool.query
    expect(SqlString.format("?", [instante], false, timezone)).toBe("'2026-11-19 15:00:00.000'");
  });

  test("colunas DATE (dia, sem hora — jobs.expires_at) chegam como 'AAAA-MM-DD', sem virar o dia anterior", () => {
    const { dateStrings } = configDoPool();
    expect(dateStrings).toEqual(["DATE"]); // DATETIME e TIMESTAMP continuam chegando como Date
  });
});

describe("limite de conexões do usuário do MySQL", () => {
  test("o pool abre no máximo 4 conexões (sobra uma para outra instância) e DB_CONNECTION_LIMIT muda isso", () => {
    delete process.env.DB_CONNECTION_LIMIT;
    expect(configDoPool().connectionLimit).toBe(4);
    process.env.DB_CONNECTION_LIMIT = "2";
    const cfg = configDoPool();
    expect(cfg.connectionLimit).toBe(2);
    expect(cfg.maxIdle).toBeLessThanOrEqual(2);
    for (const invalido of ["0", "-3", "abc", "2.5", ""]) {
      process.env.DB_CONNECTION_LIMIT = invalido;
      expect(configDoPool().connectionLimit).toBe(4);
    }
  });

  test.each([
    ["ER_USER_LIMIT_REACHED"], // max_user_connections do usuário
    ["ER_CON_COUNT_ERROR"],    // "Too many connections" do servidor
  ])("consulta recusada com %s é tentada de novo e dá certo", async (code) => {
    const db = carregarDb();
    await db.ready;
    let falhas = 2;
    mockResponder = (metodo, s) => { if (s === "UPDATE perfis SET nome = ?" && falhas-- > 0) throw erro(code); };
    jest.useFakeTimers();
    const p = db.query("UPDATE perfis SET nome = ?", ["Ana"]);
    await jest.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toEqual([[{ ok: 1 }], []]);
    expect(mockChamadas.filter(c => c === "query UPDATE perfis SET nome = ?")).toHaveLength(3);
  });

  test("execute e getConnection (transações) também tentam de novo", async () => {
    const db = carregarDb();
    await db.ready;
    let falhasExecute = 1, falhasConexao = 1;
    mockResponder = (metodo) => {
      if (metodo === "execute" && falhasExecute-- > 0) throw erro("ER_USER_LIMIT_REACHED");
      if (metodo === "getConnection" && falhasConexao-- > 0) throw erro("ER_USER_LIMIT_REACHED");
    };
    jest.useFakeTimers();
    const pe = db.execute("SELECT 1");
    const pc = db.getConnection();
    await jest.advanceTimersByTimeAsync(10000);
    await expect(pe).resolves.toBeDefined();
    await expect(pc).resolves.toHaveProperty("release");
  });

  test("outros erros (ex.: duplicado) não são repetidos: o comando pode ter chegado ao banco", async () => {
    const db = carregarDb();
    await db.ready;
    mockResponder = (metodo, s) => { if (s.startsWith("INSERT INTO x")) throw erro("ER_DUP_ENTRY"); };
    await expect(db.query("INSERT INTO x VALUES (1)")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(mockChamadas.filter(c => c.startsWith("query INSERT INTO x"))).toHaveLength(1);
  });

  test("se o limite continuar estourado, desiste depois de algumas tentativas com o erro original", async () => {
    const db = carregarDb();
    await db.ready;
    mockResponder = (metodo, s) => { if (s === "SELECT 2") throw erro("ER_USER_LIMIT_REACHED"); };
    jest.useFakeTimers();
    const p = db.query("SELECT 2");
    const resultado = expect(p).rejects.toMatchObject({ code: "ER_USER_LIMIT_REACHED" });
    await jest.advanceTimersByTimeAsync(60000);
    await resultado;
    const tentativas = mockChamadas.filter(c => c === "query SELECT 2").length;
    expect(tentativas).toBeGreaterThan(1);
    expect(tentativas).toBeLessThanOrEqual(6);
  });
});
