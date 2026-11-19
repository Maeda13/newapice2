// tests/dbPool.test.js
// Configuração do pool (database/db.js). O mysql2 é simulado: nenhum banco de
// verdade é usado.
//
// Fuso: o MySQL guarda as datas em UTC e o Render roda em UTC, mas o mysql2,
// por padrão, lê e grava datas no fuso da máquina. Rodando o site num
// computador em horário de Brasília (com o mesmo banco), tudo o que era gravado
// saía 3 horas atrasado e o que era lido aparecia 3 horas adiantado.
const SqlString = require("sqlstring");

jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => ({
    query: jest.fn(async (sql) => {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^SELECT COUNT\(\*\) AS n FROM INFORMATION_SCHEMA/i.test(s)) return [[{ n: 1 }]];
      if (/^SELECT COLUMN_TYPE AS colType/i.test(s)) return [[{ colType: "enum('dev','empresa','admin')" }]];
      return [[{ 1: 1 }], []];
    }),
    on: jest.fn(),
  })),
}));

const mysql = require("mysql2/promise");

function configDoPool() {
  mysql.createPool.mockClear();
  jest.isolateModules(() => { require("../database/db"); });
  return mysql.createPool.mock.calls[0][0];
}

const tzOriginal = process.env.TZ;
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
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
