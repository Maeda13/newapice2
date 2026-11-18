// tests/matchFormula.test.js
// Fórmula do match (services/matchCalculator.js), a mesma no site todo:
//   Skills      = skills da vaga que o dev tem ÷ total de skills da vaga
//   Senioridade = 100 / 55 / 10 (nível do dev vs nível da vaga)
//   Match       = Skills × 70% + Senioridade × 30%
// "Tem a skill": no perfil (confiança > 0), num módulo concluído do roadmap,
// ou com um nome equivalente (React = React.js, REST API = APIs REST).
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));

const db = require("../database/db");
const {
  computeSkillsScore, computeSeniorityScore, computeMatch,
  PESOS_MATCH, FAIXAS_MATCH, faixaDoMatch, chaveSkill, possuiSkill, temAlgumaSkill, carregarPerfis,
} = require("../services/matchCalculator");

const skill = (skill_id, name, importance = "obrigatoria") => ({ skill_id, name, importance });
// Vaga da Fuse: Python, UiPath e JavaScript
const VAGA = [skill(1, "Python"), skill(2, "UiPath"), skill(3, "JavaScript")];

beforeEach(() => jest.clearAllMocks());

describe("chaveSkill: mesmo nome escrito de jeitos diferentes", () => {
  test.each([
    ["React", "React.js"], ["React", "ReactJS"], ["react", "REACT"],
    ["Node", "Node.js"], ["Node.js", "NodeJS"],
    ["REST API", "APIs REST"], ["REST API", "RESTful"],
    ["JavaScript", "JS"], ["TypeScript", "TS"],
    ["Express", "Express.js"], ["HTML", "HTML5"],
    ["Automação", "automacao"],
  ])("%s = %s", (a, b) => {
    expect(chaveSkill(a)).toBe(chaveSkill(b));
  });

  test.each([["Java", "JavaScript"], ["C", "C#"], ["C#", "C++"], ["Python", "Python Data"], ["React", "React Native"]])(
    "%s ≠ %s", (a, b) => { expect(chaveSkill(a)).not.toBe(chaveSkill(b)); }
  );
});

describe("computeSkillsScore: skills que o dev tem ÷ total da vaga", () => {
  test("1 de 3 → 33; 2 de 3 → 67; 3 de 3 → 100", () => {
    expect(computeSkillsScore({ 3: 40 }, VAGA)).toBe(33);
    expect(computeSkillsScore({ 1: 10, 3: 90 }, VAGA)).toBe(67);
    expect(computeSkillsScore({ 1: 1, 2: 1, 3: 1 }, VAGA)).toBe(100);
  });

  test("a confiança não muda a conta: ter a skill (confiança > 0) basta", () => {
    expect(computeSkillsScore({ 3: 5 }, VAGA)).toBe(computeSkillsScore({ 3: 100 }, VAGA));
    expect(computeSkillsScore({ 3: 0 }, VAGA)).toBe(0);
  });

  test("obrigatória e desejável contam igual", () => {
    const vaga = [skill(1, "A", "obrigatoria"), skill(2, "B", "desejavel")];
    expect(computeSkillsScore({ 1: 50 }, vaga)).toBe(50);
    expect(computeSkillsScore({ 2: 50 }, vaga)).toBe(50);
  });

  test("conta pelo nome normalizado (skill duplicada no catálogo, módulo do roadmap)", () => {
    const perfil = { porId: {}, porNome: new Set([chaveSkill("Python"), chaveSkill("javascript")]) };
    expect(computeSkillsScore(perfil, VAGA)).toBe(67);
    const vagaRest = [skill(9, "REST API")];
    expect(computeSkillsScore({ porId: {}, porNome: new Set([chaveSkill("APIs REST")]) }, vagaRest)).toBe(100);
  });

  test("vaga sem skills cadastradas → 100 (não penaliza)", () => {
    expect(computeSkillsScore({ 1: 10 }, [])).toBe(100);
  });
});

describe("computeSeniorityScore", () => {
  test.each([
    // [nível do dev, nível da vaga, nota]
    ["iniciante",     "estagio", 100],
    ["intermediario", "junior",  100],
    ["avancado",      "pleno",   100],
    ["avancado",      "estagio", 100], // dev acima da vaga
    ["iniciante",     "junior",   55], // um nível abaixo
    ["intermediario", "pleno",    55],
    ["iniciante",     "pleno",    10], // dois níveis abaixo
  ])("dev %s × vaga %s → %i", (nivel, level, esperado) => {
    expect(computeSeniorityScore(nivel, level)).toBe(esperado);
  });

  test("nível desconhecido (do dev ou da vaga) → 100", () => {
    expect(computeSeniorityScore("guru", "junior")).toBe(100);
    expect(computeSeniorityScore(undefined, "junior")).toBe(100);
    expect(computeSeniorityScore("iniciante", "senior")).toBe(100);
  });
});

describe("computeMatch: skills × 70% + senioridade × 30%", () => {
  test("os pesos ficam numa constante só e somam 1", () => {
    expect(PESOS_MATCH).toEqual({ skills: 0.7, senioridade: 0.3 });
    expect(Object.isFrozen(PESOS_MATCH)).toBe(true);
  });

  test("1 de 3 skills, nível certo → round(33 × 0,7 + 100 × 0,3) = 53", () => {
    expect(computeMatch({ 3: 40 }, VAGA, "iniciante", "estagio")).toBe(53);
  });

  test("todas as skills, dois níveis abaixo → round(70 + 3) = 73", () => {
    expect(computeMatch({ 1: 1, 2: 1, 3: 1 }, VAGA, "iniciante", "pleno")).toBe(73);
  });

  test("dev sem nenhuma skill → 0 (mesmo com o nível certo)", () => {
    expect(computeMatch({}, VAGA, "iniciante", "estagio")).toBe(0);
    expect(computeMatch({ 1: 0 }, VAGA, "iniciante", "estagio")).toBe(0);
    expect(temAlgumaSkill({})).toBe(false);
  });

  test("dev com skills, mas nenhuma da vaga → só a senioridade (30)", () => {
    expect(computeMatch({ 99: 80 }, VAGA, "iniciante", "estagio")).toBe(30);
  });

  test("sem nível do dev, a senioridade não penaliza", () => {
    expect(computeMatch({ 1: 1, 2: 1, 3: 1 }, VAGA, undefined, "pleno")).toBe(100);
    expect(computeMatch({ 1: 1, 2: 1, 3: 1 }, VAGA, null, "pleno")).toBe(100);
  });

  test("teto de 100", () => {
    expect(computeMatch({ 1: 500, 2: 500, 3: 500 }, VAGA, "avancado", "estagio")).toBe(100);
  });
});

describe("faixas de cor do match", () => {
  test.each([
    [0, "muito-baixo"], [10, "muito-baixo"], [19, "muito-baixo"],
    [20, "baixo"], [37, "baixo"], [39, "baixo"],
    [40, "medio"], [60, "medio"], [69, "medio"],
    [70, "alto"], [100, "alto"],
  ])("%i%% → %s", (pct, faixa) => {
    expect(faixaDoMatch(pct)).toBe(faixa);
  });

  test("as faixas cobrem 0 a 100 sem buraco", () => {
    expect(FAIXAS_MATCH.map(f => f.ate)).toEqual([19, 39, 69, 100]);
    expect(faixaDoMatch(-5)).toBe("muito-baixo");
    expect(faixaDoMatch(150)).toBe("alto");
  });
});

describe("carregarPerfis: perfil + módulos concluídos no roadmap", () => {
  function fakeDb({ skills = [], etapas = [], roadmapsFalham = false } = {}) {
    db.query.mockImplementation(async (sql, params) => {
      const s = sql.toLowerCase();
      if (s.includes("from user_skills")) return [skills.filter(r => params[0].includes(String(r.github_id)))];
      if (s.includes("from roadmaps r")) {
        if (roadmapsFalham) throw Object.assign(new Error("fora do ar"), { code: "ECONNRESET" });
        return [etapas.filter(e => params[0].includes(e.usuario_id))];
      }
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
  }

  test("junta as skills do perfil (por id e por nome) e as habilidades dos módulos concluídos", async () => {
    fakeDb({
      skills: [{ github_id: 500, skill_id: 3, confidence: 40, name: "JavaScript" }],
      etapas: [{ usuario_id: 7, habilidade: "Python" }],
    });
    const perfis = await carregarPerfis(db, [{ chave: 500, usuarioId: 7 }]);
    const p = perfis.get("500");
    expect(p.porId).toEqual({ 3: 40 });
    expect([...p.porNome].sort()).toEqual(["javascript", "python"]);
    expect(possuiSkill(p, skill(1, "Python"))).toBe(true);   // só pelo roadmap
    expect(possuiSkill(p, skill(2, "UiPath"))).toBe(false);
    expect(computeSkillsScore(p, VAGA)).toBe(67);
    // a consulta do roadmap só olha módulos concluídos
    expect(db.query.mock.calls.find(([sql]) => /from roadmaps r/i.test(sql))[0]).toMatch(/re\.status = 'concluida'/);
  });

  test("dev sem nada no perfil → perfil vazio (match 0)", async () => {
    fakeDb();
    const perfis = await carregarPerfis(db, [{ chave: 501, usuarioId: 8 }]);
    expect(computeMatch(perfis.get("501"), VAGA, "iniciante", "estagio")).toBe(0);
  });

  test("falha ao ler os roadmaps não derruba o match: segue só com o perfil", async () => {
    const erro = jest.spyOn(console, "error").mockImplementation(() => {});
    fakeDb({ skills: [{ github_id: 500, skill_id: 3, confidence: 40, name: "JavaScript" }], roadmapsFalham: true });
    const perfis = await carregarPerfis(db, [{ chave: 500, usuarioId: 7 }]);
    expect(computeSkillsScore(perfis.get("500"), VAGA)).toBe(33);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  test("sem devs → nenhuma consulta", async () => {
    fakeDb();
    expect((await carregarPerfis(db, [])).size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});
