// tests/roadmapService.test.js
// Testa services/roadmapService.js — o roadmap é gerado por ALGORITMO
// (services/roadmapAlgoritmo.js, sem IA), então não há mock de IA aqui; só o
// banco é mockado (sem precisar de MySQL disponível).
//
// data/habilidades-referencia.json e data/roadmaps-modelo/*.json são lidos
// de verdade do disco (dados estáticos do próprio repo).

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

const db = require("../database/db");
const {
  gerarRoadmap,
  regenerarRoadmap,
  inferirAreaDaVaga,
} = require("../services/roadmapService");

// ── Fake DB: roteia cada SQL pro resultado esperado, sem precisar de
// MySQL de verdade. Compartilhado entre db.query (fora de transação, usado
// por montarGap) e connection.query (dentro da transação) — mesma rota. ──
function criarFakeDb({
  recursoDisponivel = true,
  etapasConcluidas = [],
  roadmapExistente = null,
  habilidadesDaVaga = ["JavaScript"],
  nivelVaga = "junior",
  skillsDoUsuario = [],
  areaDaVaga = null,
} = {}) {
  let proximoId = 1000;

  const handler = jest.fn(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.includes("from user_dev_profiles")) return [[{ github_id: 123, nivel: "iniciante" }]];
    if (s.includes("from user_skills"))        return [skillsDoUsuario]; // [] → gap completo
    if (s.includes("from job_skills")) {
      return [habilidadesDaVaga.map((habilidade, i) => ({
        skill_id: i + 1, importance: "obrigatoria", learn_order: i + 1, habilidade,
        nivel_vaga: nivelVaga, vaga_titulo: "Vaga de teste", vaga_area: areaDaVaga,
      }))];
    }
    if (s.startsWith("select id, name from skills")) {
      return [habilidadesDaVaga.map((name, i) => ({ id: i + 1, name }))];
    }

    if (s.startsWith("select id from recursos")) {
      return [recursoDisponivel ? [{ id: 777 }] : []];
    }
    if (s.startsWith("insert into recursos_pendentes")) return [{ affectedRows: 1 }];

    if (s.startsWith("insert into roadmaps"))       return [{ insertId: proximoId++ }];
    if (s.startsWith("insert into roadmap_fases"))  return [{ insertId: proximoId++ }];
    if (s.startsWith("insert into roadmap_etapas")) return [{ insertId: proximoId++ }];

    if (s.startsWith("select * from roadmaps where id")) {
      return [[roadmapExistente ?? {
        id: params[0], usuario_id: 1, tipo_objetivo: "area", vaga_id: null,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      }]];
    }
    if (s.includes("from roadmap_etapas re") && s.includes("join roadmap_fases")) {
      return [etapasConcluidas];
    }
    if (s.startsWith("delete from roadmap_fases")) return [{ affectedRows: 1 }];
    if (s.startsWith("update roadmaps"))           return [{ affectedRows: 1 }];

    throw new Error(`fakeDb: rota não mapeada para: ${sql}`);
  });

  const connection = {
    query: handler,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };

  return { handler, connection };
}

function instalarFakeDb(opts) {
  const { handler, connection } = criarFakeDb(opts);
  db.query.mockImplementation(handler);
  db.getConnection.mockResolvedValue(connection);
  return { handler, connection };
}

const OBJETIVO_AREA_FRONT_END = { tipo: "area", area: "front-end" };
const nomesDasEtapas = (r) => r.fases.flatMap(f => f.etapas.map(e => e.habilidade));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("gerarRoadmap (algoritmo, sem IA)", () => {
  test("objetivo por área → trilha gravada, origem 'modelo', sem depender de nenhuma IA", async () => {
    const { connection } = instalarFakeDb();

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    expect(resultado.origem).toBe("modelo"); // valor do ENUM do banco: 'modelo' = algoritmo
    expect(resultado.versao).toBe(1);
    expect(resultado.fases.length).toBeGreaterThanOrEqual(2);
    expect(resultado.fases.every(f => f.etapas.length >= 1 && f.projeto.enunciado)).toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  test("é determinístico: mesma entrada gera as mesmas etapas", async () => {
    instalarFakeDb();
    const a = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);
    instalarFakeDb();
    const b = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);
    expect(a.fases.map(f => f.etapas.map(e => e.titulo))).toEqual(b.fases.map(f => f.etapas.map(e => e.titulo)));
  });

  test("objetivo por vaga é personalizado pelas skills da vaga (só o que ela pede)", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas"] });

    const resultado = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(new Set(nomesDasEtapas(resultado))).toEqual(new Set(["Python", "Pandas"]));
  });

  test("a área escolhida na vaga vence a inferida pelas skills (grava em roadmaps.area)", async () => {
    // HTML + CSS sozinhos inferiam "full-stack" (empate entre front-end e full-stack)
    const { handler } = instalarFakeDb({ habilidadesDaVaga: ["HTML", "CSS"], areaDaVaga: "dados" });

    await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    const [, params] = handler.mock.calls.find(([sql]) => /insert into roadmaps/i.test(sql));
    expect(params[3]).toBe("dados");
  });

  test("sem área na vaga, continua inferindo pelas skills", async () => {
    const { handler } = instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas"], areaDaVaga: null });

    await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    const [, params] = handler.mock.calls.find(([sql]) => /insert into roadmaps/i.test(sql));
    expect(params[3]).toBe("dados");
  });

  test("vaga de nível mais alto gera uma trilha mais profunda", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["JavaScript", "React"], nivelVaga: "estagio" });
    const estagio = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);
    instalarFakeDb({ habilidadesDaVaga: ["JavaScript", "React"], nivelVaga: "pleno" });
    const pleno = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(nomesDasEtapas(pleno).length).toBeGreaterThan(nomesDasEtapas(estagio).length);
  });

  test("usuário que já tem a skill (confidence > 0) não recebe etapa dela", async () => {
    instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS"],
      skillsDoUsuario: [{ skill_id: 1, confidence: 80 }], // skill_id 1 = HTML
    });

    const resultado = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(new Set(nomesDasEtapas(resultado))).toEqual(new Set(["CSS"]));
  });

  test("usuário que já atende a vaga inteira → erro claro e nada é gravado", async () => {
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["HTML"],
      skillsDoUsuario: [{ skill_id: 1, confidence: 90 }],
    });

    await expect(gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10)).rejects.toThrow(/já atende/i);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(handler.mock.calls.some(([sql]) => /insert into roadmaps/i.test(sql))).toBe(false);
  });

  test("habilidade sem recurso cadastrado → recurso_id null e registra em recursos_pendentes", async () => {
    const { handler } = instalarFakeDb({ recursoDisponivel: false });

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    const todasEtapas = resultado.fases.flatMap(f => f.etapas);
    expect(todasEtapas.length).toBeGreaterThan(0);
    expect(todasEtapas.every(e => e.recurso_id === null)).toBe(true);

    const chamadasPendentes = handler.mock.calls.filter(([sql]) =>
      sql.toLowerCase().includes("insert into recursos_pendentes")
    );
    expect(chamadasPendentes.length).toBe(todasEtapas.length);
  });

  test("o serviço não depende mais de nenhum cliente de IA", () => {
    const fs = require("fs");
    const path = require("path");
    for (const arq of ["roadmapService.js", "roadmapAlgoritmo.js", "roadmapGenerator.js"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "services", arq), "utf8");
      expect(src).not.toMatch(/geminiClient|askGeminiJSON|aiFallback/);
    }
  });
});

describe("inferirAreaDaVaga", () => {
  test("vaga com skills de dados (Python, Pandas, Estatística Básica) → 'dados'", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas", "Estatística Básica"] });
    await expect(inferirAreaDaVaga(10)).resolves.toBe("dados");
  });

  test("vaga sem nenhuma skill presente em data/habilidades-referencia.json → 'full-stack'", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["COBOL", "Fortran"] });
    await expect(inferirAreaDaVaga(11)).resolves.toBe("full-stack");
  });

  test("vaga sem nenhuma skill cadastrada (job_skills vazio) → 'full-stack'", async () => {
    instalarFakeDb({ habilidadesDaVaga: [] });
    await expect(inferirAreaDaVaga(12)).resolves.toBe("full-stack");
  });
});

describe("regenerarRoadmap", () => {
  test("preserva etapas concluídas (mesma habilidade) e substitui o resto, versao + 1", async () => {
    const concluidaEm = new Date("2026-01-01T00:00:00Z");
    instalarFakeDb({
      etapasConcluidas: [{ habilidade: "JavaScript", concluida_em: concluidaEm }],
      roadmapExistente: {
        id: 42, usuario_id: 1, tipo_objetivo: "area", vaga_id: null,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      },
    });

    const resultado = await regenerarRoadmap(42);

    expect(resultado.versao).toBe(2);

    const todasEtapas = resultado.fases.flatMap(f => f.etapas);
    const etapasJs = todasEtapas.filter(e => e.habilidade === "JavaScript");
    expect(etapasJs.length).toBeGreaterThan(0);
    expect(etapasJs.every(e => e.status === "concluida" && e.concluida_em === concluidaEm)).toBe(true);

    const outrasEtapas = todasEtapas.filter(e => e.habilidade !== "JavaScript");
    expect(outrasEtapas.every(e => e.status === "pendente")).toBe(true);
  });

  test("se o usuário já atende tudo, a regeneração falha sem apagar a trilha atual", async () => {
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["HTML"],
      skillsDoUsuario: [{ skill_id: 1, confidence: 90 }],
      roadmapExistente: {
        id: 43, usuario_id: 1, tipo_objetivo: "vaga", vaga_id: 10,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      },
    });

    await expect(regenerarRoadmap(43)).rejects.toThrow(/já atende/i);
    expect(connection.rollback).toHaveBeenCalled();
    expect(handler.mock.calls.some(([sql]) => /delete from roadmap_fases/i.test(sql))).toBe(false);
  });
});
