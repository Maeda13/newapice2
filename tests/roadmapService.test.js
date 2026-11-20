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
  catalogoDeSkills = null, // null → toda skill pedida existe; senão, só estas
  // fases 'verificado' do roadmap (regeneração):
  // [{ id, ordem, projeto_habilidades: string|null, habilidadesDasEtapas: [..] }]
  fasesVerificadas = [],
  falharNoInsertDeFase = false,
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
    // validação das habilidades do projeto (salvarFasesEEtapas)
    // regeneração: fases verificadas (ficam) e as habilidades das etapas delas
    if (s.startsWith("select id, projeto_habilidades from roadmap_fases")) {
      return [[...fasesVerificadas].sort((a, b) => a.ordem - b.ordem)
        .map(({ id, projeto_habilidades = null }) => ({ id, projeto_habilidades }))];
    }
    if (s.startsWith("select habilidade from roadmap_etapas where fase_id in")) {
      const ids = params[0] ?? [];
      return [fasesVerificadas.filter(f => ids.includes(f.id))
        .flatMap(f => (f.habilidadesDasEtapas ?? []).map(habilidade => ({ habilidade })))];
    }
    if (s.startsWith("update roadmap_fases set ordem")) return [{ affectedRows: 1 }];
    if (s.startsWith("select name from skills where name in")) {
      const pedidas = params[0] ?? [];
      return [pedidas.filter(n => !catalogoDeSkills || catalogoDeSkills.includes(n)).map(name => ({ name }))];
    }
    if (s.startsWith("select id, name from skills")) {
      return [habilidadesDaVaga.map((name, i) => ({ id: i + 1, name }))];
    }

    if (s.startsWith("select id from recursos")) {
      return [recursoDisponivel ? [{ id: 777 }] : []];
    }
    if (s.startsWith("insert into recursos_pendentes")) return [{ affectedRows: 1 }];

    if (s.startsWith("insert into roadmaps"))       return [{ insertId: proximoId++ }];
    if (s.startsWith("insert into roadmap_fases")) {
      if (falharNoInsertDeFase) throw new Error("falha simulada ao gravar a fase");
      return [{ insertId: proximoId++ }];
    }
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

// ── projeto_habilidades: gravado na geração (e no roadmap-modelo / regeneração, que
// passam pelo mesmo salvarFasesEEtapas), validado contra a tabela de skills ──
describe("projeto_habilidades na geração", () => {
  const insertsDeFase = (handler) =>
    handler.mock.calls.filter(([sql]) => /insert into roadmap_fases/i.test(sql));
  // INSERT INTO roadmap_fases (roadmap_id, ordem, nome, objetivo, projeto_enunciado, projeto_habilidades, ...)
  const habilidadesGravadas = (call) => call[1][5];

  test("salva as habilidades do projeto de cada fase (JSON em TEXT)", async () => {
    const { handler } = instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas"] });

    const r = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    const inserts = insertsDeFase(handler);
    expect(inserts.length).toBe(r.fases.length);
    for (const [i, call] of inserts.entries()) {
      expect(JSON.parse(habilidadesGravadas(call))).toEqual(r.fases[i].projeto.habilidades);
      expect(r.fases[i].projeto.habilidades.length).toBeGreaterThan(0);
    }
    expect(new Set(inserts.flatMap(c => JSON.parse(habilidadesGravadas(c))))).toEqual(new Set(["Python", "Pandas"]));
  });

  test("roadmap-modelo por área (trilha estática, origem 'modelo') também salva", async () => {
    const { handler } = instalarFakeDb();

    const r = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    expect(r.origem).toBe("modelo");
    const inserts = insertsDeFase(handler);
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    expect(inserts.every(c => Array.isArray(JSON.parse(habilidadesGravadas(c))))).toBe(true);
  });

  test("nome de habilidade desconhecido é descartado com aviso, e a geração continua", async () => {
    const aviso = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["Python", "Pandas"], catalogoDeSkills: ["Python"],
    });

    const r = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(connection.commit).toHaveBeenCalledTimes(1);
    const todas = insertsDeFase(handler).flatMap(c => (habilidadesGravadas(c) ? JSON.parse(habilidadesGravadas(c)) : []));
    expect(todas).toContain("Python");
    expect(todas).not.toContain("Pandas");
    expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/descartadas.*Pandas/));
    // as etapas não são afetadas: a trilha continua tendo a etapa de Pandas
    expect(nomesDasEtapas(r)).toContain("Pandas");
    aviso.mockRestore();
  });

  test("fase cujas habilidades são todas desconhecidas grava NULL (a verificação cai nas etapas)", async () => {
    const aviso = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { handler } = instalarFakeDb({ habilidadesDaVaga: ["Pandas"], catalogoDeSkills: [] });

    await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(insertsDeFase(handler).every(c => habilidadesGravadas(c) === null)).toBe(true);
    aviso.mockRestore();
  });

  test("a regeneração também salva projeto_habilidades nas fases novas", async () => {
    const { handler } = instalarFakeDb({
      etapasConcluidas: [{ habilidade: "JavaScript", concluida_em: new Date("2026-01-01T00:00:00Z") }],
      roadmapExistente: {
        id: 42, usuario_id: 1, tipo_objetivo: "area", vaga_id: null,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      },
    });

    const r = await regenerarRoadmap(42);

    const inserts = insertsDeFase(handler);
    expect(inserts.length).toBe(r.fases.length);
    expect(inserts.every(c => JSON.parse(habilidadesGravadas(c)).length > 0)).toBe(true);
    // as etapas concluídas continuam preservadas pela regeneração
    expect(r.fases.flatMap(f => f.etapas).filter(e => e.habilidade === "JavaScript").every(e => e.status === "concluida")).toBe(true);
  });
});

// ── Regeneração preserva fases verificadas ──
describe("regenerarRoadmap — fases verificadas", () => {
  const ROADMAP_VAGA = {
    id: 50, usuario_id: 1, tipo_objetivo: "vaga", vaga_id: 10,
    area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
  };
  const normalizar = (sql) => sql.toLowerCase().replace(/\s+/g, " ").trim();
  const chamadas = (handler, prefixo) =>
    handler.mock.calls.filter(([sql]) => normalizar(sql).startsWith(prefixo));
  // INSERT INTO roadmap_etapas (fase_id, ordem, titulo, descricao, habilidade, ...)
  const habilidadesInseridas = (handler) => chamadas(handler, "insert into roadmap_etapas").map(c => c[1][4]);
  // INSERT INTO roadmap_fases (roadmap_id, ordem, nome, ...)
  const ordensInseridas = (handler) => chamadas(handler, "insert into roadmap_fases").map(c => c[1][1]);

  const VERIFICADA_HTML = {
    id: 900, ordem: 1, projeto_habilidades: JSON.stringify(["HTML"]), habilidadesDasEtapas: ["HTML"],
  };

  test("fase verificada continua intacta: não é apagada nem reescrita (só a ordem é recalculada)", async () => {
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS", "JavaScript"], roadmapExistente: ROADMAP_VAGA,
      fasesVerificadas: [VERIFICADA_HTML],
    });

    const r = await regenerarRoadmap(50);

    expect(r.fasesPreservadas).toBe(1);
    // o DELETE exclui as verificadas, e é o único DELETE
    const deletes = chamadas(handler, "delete from roadmap_fases");
    expect(deletes).toHaveLength(1);
    expect(normalizar(deletes[0][0])).toContain("projeto_status <> 'verificado'");
    // nada escreve status/repo/verificado_em/habilidades da fase verificada, nem apaga etapas dela
    const escritasNaFase = handler.mock.calls.map(([sql]) => normalizar(sql))
      .filter(sql => sql.startsWith("update roadmap_fases"));
    expect(escritasNaFase).toEqual(["update roadmap_fases set ordem = ? where id = ?"]);
    expect(chamadas(handler, "delete from roadmap_etapas")).toEqual([]);
    expect(chamadas(handler, "update roadmap_fases set ordem")[0][1]).toEqual([1, 900]); // mesma ordem de antes
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test("habilidades da fase verificada não reaparecem nas fases novas", async () => {
    const { handler } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS", "JavaScript"], roadmapExistente: ROADMAP_VAGA,
      fasesVerificadas: [VERIFICADA_HTML],
    });

    const r = await regenerarRoadmap(50);

    const inseridas = habilidadesInseridas(handler);
    expect(inseridas.length).toBeGreaterThan(0);
    expect(new Set(inseridas)).toEqual(new Set(["CSS", "JavaScript"]));
    expect(nomesDasEtapas(r)).not.toContain("HTML");
    // também vale para as habilidades só do projeto (projeto_habilidades), mesmo sem etapa
    const { handler: h2 } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS"], roadmapExistente: ROADMAP_VAGA,
      fasesVerificadas: [{ id: 901, ordem: 1, projeto_habilidades: JSON.stringify(["css"]), habilidadesDasEtapas: [] }],
    });
    await regenerarRoadmap(50);
    expect(habilidadesInseridas(h2)).toEqual(["HTML"]);
  });

  test("ordem final: verificadas primeiro (ordem relativa mantida), depois as novas", async () => {
    const { handler } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS", "JavaScript", "React"], roadmapExistente: ROADMAP_VAGA,
      // ordens com buraco e fora da ordem de id: a relativa (ordem) é que vale
      fasesVerificadas: [
        { id: 905, ordem: 4, projeto_habilidades: JSON.stringify(["CSS"]), habilidadesDasEtapas: ["CSS"] },
        { id: 902, ordem: 2, projeto_habilidades: JSON.stringify(["HTML"]), habilidadesDasEtapas: ["HTML"] },
      ],
    });

    const r = await regenerarRoadmap(50);

    // 902 (ordem 2) → 1; 905 (ordem 4) → 2
    expect(chamadas(handler, "update roadmap_fases set ordem").map(c => c[1])).toEqual([[1, 902], [2, 905]]);
    // novas começam depois das verificadas, em sequência, e o nome acompanha o número
    expect(ordensInseridas(handler)).toEqual(r.fases.map((_, i) => 3 + i));
    expect(r.fases[0].nome).toMatch(/^Fase 3:/);
    // as atualizações de ordem das verificadas vêm antes de inserir as novas
    const sqls = handler.mock.calls.map(([sql]) => normalizar(sql));
    const ultimaOrdem = sqls.lastIndexOf("update roadmap_fases set ordem = ? where id = ?");
    expect(ultimaOrdem).toBeLessThan(sqls.findIndex(sql => sql.startsWith("insert into roadmap_fases")));
  });

  test("tudo o que faltava já está coberto pelas verificadas → regenera sem fases novas", async () => {
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["HTML"], roadmapExistente: ROADMAP_VAGA, fasesVerificadas: [VERIFICADA_HTML],
    });

    const r = await regenerarRoadmap(50);

    expect(r.fases).toEqual([]);
    expect(r.fasesPreservadas).toBe(1);
    expect(r.versao).toBe(2);
    expect(chamadas(handler, "insert into roadmap_fases")).toEqual([]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test("fase em_revisao/pendente/nao_verificado continua sendo recriada como hoje", async () => {
    // nenhuma fase 'verificado': o roadmap inteiro é recriado, preservando etapas concluídas por habilidade
    const concluidaEm = new Date("2026-01-01T00:00:00Z");
    const { handler } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS"], roadmapExistente: ROADMAP_VAGA,
      etapasConcluidas: [{ habilidade: "HTML", concluida_em: concluidaEm }],
    });

    const r = await regenerarRoadmap(50);

    expect(r.fasesPreservadas).toBe(0);
    expect(chamadas(handler, "delete from roadmap_fases")).toHaveLength(1);
    expect(chamadas(handler, "update roadmap_fases set ordem")).toEqual([]);
    expect(new Set(habilidadesInseridas(handler))).toEqual(new Set(["HTML", "CSS"])); // HTML recriada
    expect(ordensInseridas(handler)[0]).toBe(1); // sem verificadas, a ordem começa em 1
    expect(r.fases.flatMap(f => f.etapas).find(e => e.habilidade === "HTML")).toMatchObject({
      status: "concluida", concluida_em: concluidaEm,
    });
  });

  test("a consulta das etapas concluídas ignora as fases verificadas (elas não são recriadas)", async () => {
    const { handler } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS"], roadmapExistente: ROADMAP_VAGA, fasesVerificadas: [VERIFICADA_HTML],
    });
    await regenerarRoadmap(50);
    const consulta = handler.mock.calls.map(([sql]) => normalizar(sql))
      .find(sql => sql.includes("from roadmap_etapas re") && sql.includes("join roadmap_fases"));
    expect(consulta).toContain("rf.projeto_status <> 'verificado'");
  });

  test("falha na geração (nada a estudar) → rollback e nada é apagado, mesmo com fase verificada", async () => {
    const { handler, connection } = instalarFakeDb({
      habilidadesDaVaga: ["JavaScript"], skillsDoUsuario: [{ skill_id: 1, confidence: 90 }],
      roadmapExistente: ROADMAP_VAGA,
      fasesVerificadas: [{ id: 903, ordem: 1, projeto_habilidades: null, habilidadesDasEtapas: ["HTML"] }],
    });

    await expect(regenerarRoadmap(50)).rejects.toThrow(/já atende/i);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(chamadas(handler, "delete from roadmap_fases")).toEqual([]);
    expect(chamadas(handler, "update roadmap_fases")).toEqual([]);
    expect(chamadas(handler, "update roadmaps")).toEqual([]);
  });

  test("falha ao gravar as fases novas (depois do DELETE) → rollback da transação inteira", async () => {
    const { connection } = instalarFakeDb({
      habilidadesDaVaga: ["HTML", "CSS"], roadmapExistente: ROADMAP_VAGA,
      fasesVerificadas: [VERIFICADA_HTML], falharNoInsertDeFase: true,
    });

    await expect(regenerarRoadmap(50)).rejects.toThrow(/falha simulada/);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});
