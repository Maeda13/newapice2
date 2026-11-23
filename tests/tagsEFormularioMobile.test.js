// tests/tagsEFormularioMobile.test.js
// 1. Cards de vagas: a tag de habilidade mostra só a palavra-chave (o nome completo
//    vai no title), em uma linha só; o dado salvo e o match não mudam.
// 2. "Novo roadmap" no celular: o <select> da vaga não alarga a página.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));

const fs = require("fs");
const path = require("path");
const { abreviarHabilidade } = require("../services/vagasPublicas");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("abreviarHabilidade", () => {
  test.each([
    ["Google Cloud Platform", "GCP"],
    ["Excel / Google Sheets Avançado", "Excel"],
    ["Linux / Shell Script", "Linux"],
    ["Testes Automatizados", "Testes"],
    ["Prototipação e Wireframing", "Protótipos"],
    ["Design Systems", "Design System"],
    ["Amazon Web Services", "AWS"],
  ])("%s → %s (mapa)", (nome, curto) => expect(abreviarHabilidade(nome)).toBe(curto));

  test.each(["Python", "SQL", "Git", "Docker", "Figma", "Node.js", "JavaScript", "HTML", "TypeScript", "CI/CD", "UX/UI"])(
    "nome curto %s fica igual", (n) => expect(abreviarHabilidade(n)).toBe(n));

  test("fora do mapa: trecho antes de ' / ', ' e ' ou '(' e, se passar de 12 caracteres, a primeira palavra relevante", () => {
    expect(abreviarHabilidade("Redes e Segurança da Informação (Cybersecurity)")).toBe("Redes");
    expect(abreviarHabilidade("Banco de Dados / Modelagem")).toBe("Banco");
    expect(abreviarHabilidade("Pensamento Crítico")).toBe("Pensamento");
    expect(abreviarHabilidade("Resiliência sob Pressão")).toBe("Resiliência");
    expect(abreviarHabilidade("Programação Orientada a Objetos")).toBe("Programação");
  });

  test("vazio e palavra gigante não quebram", () => {
    expect(abreviarHabilidade("")).toBe("");
    expect(abreviarHabilidade(null)).toBe("");
    expect(abreviarHabilidade("Supercalifragilisticoespialidoso")).toBe("Supercalifr…");
  });
});

describe("tags dos cards", () => {
  test("o card mostra a abreviação e põe o nome completo no title", () => {
    const v = ler("views/vagas.ejs");
    expect(v).toContain('title="<%= vaga.skillsCompletas[i] %>"');
    expect(v).toContain('<li class="vagas-card__chip" title="<%= c %>">');
    const s = ler("services/vagasPublicas.js");
    expect(s).toMatch(/skills: lista\.slice\(0, 3\)\.map\(abreviarHabilidade\)/);
    expect(s).toMatch(/skillsCompletas: lista\.slice\(0, 3\)/);
    expect(s).toMatch(/busca: normalizar\(\[titulo, job\.title, empresa\.nome, resumo, \.\.\.lista\]/); // a busca usa o nome completo
  });
  test("CSS: tags em uma linha (nowrap + reticências), container flex-wrap", () => {
    const css = ler("public/css/vagas.css");
    const chip = css.match(/\.vagas-card__chip \{([^}]*)\}/)[1];
    expect(chip).toMatch(/white-space: nowrap/);
    expect(chip).toMatch(/overflow: hidden/);
    expect(chip).toMatch(/text-overflow: ellipsis/);
    expect(chip).toMatch(/max-width: 100%/);
    expect(css.match(/\.vagas-card__chips \{([^}]*)\}/)[1]).toMatch(/display: flex;\s*flex-wrap: wrap/);
  });
});

describe("Novo roadmap no celular", () => {
  const css = ler("public/css/trilha.css");
  test("o select ocupa no máximo a largura do container e corta o texto com reticências", () => {
    const sel = css.match(/\.rm-select \{([^}]*)\}/)[1];
    for (const re of [/width: 100%/, /max-width: 100%/, /min-width: 0/, /box-sizing: border-box/, /text-overflow: ellipsis/, /white-space: nowrap/, /overflow: hidden/]) expect(sel).toMatch(re);
  });
  test("fieldset e campo têm min-width: 0 (o fieldset usa min-content por padrão)", () => {
    expect(css.match(/\.rm-fieldset \{([^}]*)\}/)[1]).toMatch(/min-width: 0/);
    expect(css.match(/\.rm-field \{([^}]*)\}/)[1]).toMatch(/min-width: 0/);
  });
});
