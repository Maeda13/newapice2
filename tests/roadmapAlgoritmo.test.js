// tests/roadmapAlgoritmo.test.js
// Geração do roadmap SEM IA: services/roadmapAlgoritmo.js é uma função pura
// (gap → fases/etapas/projetos), personalizada pela vaga. Lê o catálogo de
// passos de data/roadmaps-modelo/*.json de verdade (dado estático do repo).
const { montarFases } = require("../services/roadmapAlgoritmo");

const req = (habilidade, extra = {}) => ({
  habilidade, importancia: "obrigatoria", ordem: null,
  nivel_atual: null, nivel_esperado: null, tem_gap: true, ...extra,
});
const gapVaga = (requisitos, extra = {}) => ({
  tipo: "vaga", vagaId: 1, area: "front-end", nivelVaga: "junior", vagaTitulo: "Dev Front", requisitos, ...extra,
});
const etapasDe = (r) => r.fases.flatMap(f => f.etapas);
const skillsDe = (r) => [...new Set(etapasDe(r).map(e => e.habilidade))];

describe("montarFases — o que entra na trilha", () => {
  test("só entram skills com gap; quem o usuário já tem fica de fora", () => {
    const r = montarFases(gapVaga([
      req("HTML", { tem_gap: false, nivel_atual: "intermediario" }),
      req("CSS"),
    ]));
    expect(skillsDe(r)).toEqual(["CSS"]);
  });

  test("sem nenhum gap → erro claro (nada a estudar)", () => {
    expect(() => montarFases(gapVaga([req("HTML", { tem_gap: false })])))
      .toThrow(/já atende|nada a estudar/i);
  });

  test("é determinístico: mesma entrada, mesma trilha", () => {
    const g = gapVaga([req("React"), req("JavaScript"), req("CSS")]);
    expect(montarFases(g)).toEqual(montarFases(g));
  });
});

describe("montarFases — personalização pela vaga", () => {
  const reqs = () => [req("JavaScript"), req("React")];

  test("vaga de nível mais alto exige mais passos por skill obrigatória", () => {
    const n = (nivelVaga) => etapasDe(montarFases(gapVaga(reqs(), { nivelVaga }))).length;
    expect(n("estagio")).toBeLessThan(n("junior"));
    expect(n("junior")).toBeLessThanOrEqual(n("pleno"));
  });

  test("skill desejável entra só no passo inicial e na fase final 'Diferenciais'", () => {
    const r = montarFases(gapVaga([
      req("JavaScript"), req("React"),
      req("TypeScript", { importancia: "desejavel" }),
    ], { nivelVaga: "pleno" }));
    const ultima = r.fases[r.fases.length - 1];
    expect(ultima.nome).toMatch(/Diferenciais/);
    expect(ultima.etapas.map(e => e.habilidade)).toEqual(["TypeScript"]);
    expect(etapasDe(r).filter(e => e.habilidade === "TypeScript")).toHaveLength(1);
    // obrigatórias nunca ficam depois das desejáveis
    const idxTs = etapasDe(r).findIndex(e => e.habilidade === "TypeScript");
    expect(etapasDe(r).slice(idxTs).every(e => e.habilidade === "TypeScript")).toBe(true);
  });

  test("respeita learn_order definido na vaga", () => {
    const r = montarFases(gapVaga([
      req("React", { ordem: 2 }), req("HTML", { ordem: 1 }),
    ], { nivelVaga: "estagio" }));
    expect(skillsDe(r)).toEqual(["HTML", "React"]);
  });

  test("sem learn_order, usa a ordem canônica dos modelos (fundamentos antes do framework)", () => {
    const r = montarFases(gapVaga([req("React"), req("HTML"), req("JavaScript")], { nivelVaga: "estagio" }));
    expect(skillsDe(r)).toEqual(["HTML", "JavaScript", "React"]);
  });

  test("o nível que o usuário já tem pula os passos iniciais", () => {
    const do_zero = etapasDe(montarFases(gapVaga([req("JavaScript")], { nivelVaga: "pleno" })));
    const parcial = etapasDe(montarFases(gapVaga([
      req("JavaScript", { nivel_atual: "iniciante" }),
    ], { nivelVaga: "pleno" })));
    expect(parcial.length).toBeLessThan(do_zero.length);
    expect(parcial[0].titulo).toBe(do_zero[1].titulo);
  });

  test("skill fora do catálogo ganha passos genéricos (nunca fica sem etapa)", () => {
    const r = montarFases(gapVaga([req("Figma")], { nivelVaga: "junior" }));
    const e = etapasDe(r);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every(x => x.habilidade === "Figma" && x.horas_estimadas > 0 && x.titulo && x.descricao)).toBe(true);
  });
});

describe("montarFases — estrutura (compatível com a gravação em roadmap_fases/etapas)", () => {
  const grande = () => gapVaga(
    ["HTML", "CSS", "JavaScript", "React", "TypeScript", "Git", "Node.js", "SQL"].map(h => req(h)),
    { nivelVaga: "pleno" },
  );

  test("toda fase tem nome, objetivo, 1 projeto com habilidades e no máximo 6 etapas", () => {
    const r = montarFases(grande());
    expect(r.fases.length).toBeGreaterThan(1);
    for (const f of r.fases) {
      expect(f.nome).toBeTruthy();
      expect(f.objetivo).toBeTruthy();
      expect(f.etapas.length).toBeGreaterThanOrEqual(1);
      expect(f.etapas.length).toBeLessThanOrEqual(6);
      expect(f.projeto.enunciado).toBeTruthy();
      expect(f.projeto.habilidades.length).toBeGreaterThan(0);
      expect(f.projeto.enunciado).not.toMatch(/https?:\/\//); // recursos vêm da tabela curada
    }
  });

  test("toda etapa traz titulo, descricao, habilidade, horas e o nível-alvo do passo", () => {
    for (const e of etapasDe(montarFases(grande()))) {
      expect(typeof e.titulo).toBe("string");
      expect(typeof e.descricao).toBe("string");
      expect(typeof e.habilidade).toBe("string");
      expect(Number.isFinite(e.horas_estimadas) && e.horas_estimadas > 0).toBe(true);
      expect(["iniciante", "intermediario", "avancado"]).toContain(e.nivel_atual);
    }
  });

  test("o projeto da fase cobre as habilidades das etapas dela", () => {
    for (const f of montarFases(grande()).fases) {
      expect(new Set(f.projeto.habilidades)).toEqual(new Set(f.etapas.map(e => e.habilidade)));
    }
  });
});

describe("montarFases — objetivo por área", () => {
  test("usa nivel_esperado da área como profundidade", () => {
    const r = montarFases({
      tipo: "area", area: "front-end",
      requisitos: [
        { habilidade: "JavaScript", nivel_atual: null, nivel_esperado: "intermediario", tem_gap: true },
        { habilidade: "Git",        nivel_atual: null, nivel_esperado: "iniciante",     tem_gap: true },
      ],
    });
    const e = etapasDe(r);
    expect(e.filter(x => x.habilidade === "JavaScript").length).toBe(2);
    expect(e.filter(x => x.habilidade === "Git").length).toBe(1);
  });
});
