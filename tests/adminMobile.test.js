// tests/adminMobile.test.js
// Painel do administrador no celular: dashboard, filtros, tabelas, relatórios e
// barra inferior. Os CSS do admin não tinham nenhuma regra para tela pequena
// (grades de 2 e 3 colunas espremiam os cartões e quebravam o texto na vertical).
const fs = require("fs");
const path = require("path");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
// Corpo do primeiro @media com esta condição (balanceando as chaves).
function media(css, condicao) {
  const i = css.indexOf(`@media (${condicao})`);
  if (i === -1) return null;
  let n = 0, j = css.indexOf("{", i);
  const ini = j + 1;
  for (; j < css.length; j++) {
    if (css[j] === "{") n++;
    else if (css[j] === "}" && --n === 0) break;
  }
  return css.slice(ini, j);
}

describe("1. dashboard em uma coluna", () => {
  const css = ler("public/css/admin-dashboard.css");
  test("o layout vira uma coluna e os cartões de métrica ficam em largura total", () => {
    expect(media(css, "max-width: 900px")).toMatch(/\.adm-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(media(css, "max-width: 700px")).toMatch(/\.adm-stats \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  test("a tabela de devs recentes vira cartões com rótulos", () => {
    expect(media(css, "max-width: 700px")).toMatch(/td\[data-label\]::before \{ content: attr\(data-label\)/);
    const v = ler("views/admin-dashboard.ejs");
    for (const r of ["E-mail", "Nível", "Cadastro"]) expect(v).toContain(`data-label="${r}"`);
  });
});

describe("2. filtros dentro da caixa", () => {
  const css = media(ler("public/css/admin-vagas.css"), "max-width: 700px");
  test("os grupos quebram linha, ocupam a caixa e têm o título numa linha própria", () => {
    expect(css).toMatch(/\.adv-group \{[^}]*flex-wrap: wrap;[^}]*flex: 1 1 100%;[^}]*min-width: 0/);
    expect(css).toMatch(/\.adv-group-title \{ flex-basis: 100%/);
  });
  test("a busca e a ordenação cabem na largura da tela", () => {
    expect(css).toMatch(/\.adv-search \{ flex-basis: 100%; min-width: 0; \}/);
    expect(css).toMatch(/\.adv-sort-btn \{ min-width: 0; width: 100%; \}/);
  });
});

describe("3. tabelas viram cartões com todas as colunas e ações", () => {
  test("o CSS das listas transforma cada linha em cartão, com rótulos e ações visíveis", () => {
    const css = media(ler("public/css/admin-vagas.css"), "max-width: 700px");
    expect(css).toMatch(/\.adv-table td\[data-label\]::before \{ content: attr\(data-label\)/);
    expect(css).toMatch(/\.adv-table td:last-child \{ justify-content: flex-end/);
  });
  test.each([
    ["views/admin-usuarios.ejs", ["E-mail", "Nível", "Plano", "Atividade"]],
    ["views/admin-empresas.ejs", ["E-mail", "Setor", "Vagas", "Plano", "Atividade"]],
    ["views/admin-vagas.ejs", ["Empresa", "Nível", "Local", "Candidatos", "Expiração"]],
  ])("%s: cada célula tem o seu rótulo", (v, rotulos) => {
    const html = ler(v);
    for (const r of rotulos) expect(html).toContain(`data-label="${r}"`);
  });
});

describe("4. relatórios empilhados", () => {
  test("os indicadores ficam um embaixo do outro no celular", () => {
    const css = ler("public/css/admin-crescimento.css");
    expect(media(css, "max-width: 860px")).toMatch(/\.adc-kpis \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(media(css, "max-width: 600px")).toMatch(/\.adc-kpis \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  test("barras de preenchimento e de relatório não estouram a largura", () => {
    expect(media(ler("public/css/admin-desempenho.css"), "max-width: 600px")).toMatch(/\.add-fill-row \{ grid-template-columns: minmax\(0, 1fr\) auto/);
    expect(media(ler("public/css/admin-relatorios.css"), "max-width: 600px")).toMatch(/\.adr-bar-label \{ width: auto/);
  });
  test.each([
    ["public/css/admin-vaga.css", /\.adj-stats \{ grid-template-columns: repeat\(2/],
    ["public/css/admin-usuario.css", /\.adu-skills \{ grid-template-columns: minmax\(0, 1fr\)/],
    ["public/css/admin-categorias.css", /\.adk-cols \{ grid-template-columns: minmax\(0, 1fr\)/],
  ])("%s também tem regra para o celular", (f, re) => {
    expect(media(ler(f), "max-width: 700px")).toMatch(re);
  });
});

describe("5. barra inferior no padrão do protótipo", () => {
  const css = ler("public/css/header.css");
  const bloco = css.slice(css.indexOf("ADMIN NO CELULAR"));
  test("ancorada na base, largura total, fundo preto e cantos de cima arredondados", () => {
    expect(bloco).toMatch(/\.bottom-nav--company\.bottom-nav--admin \{[^}]*left: 0; right: 0; bottom: 0; transform: none; max-width: none/);
    expect(bloco).toMatch(/background: var\(--sup-000000\)/);
    expect(bloco).toMatch(/border-radius: 28px 28px 0 0/);
  });
  test("itens iguais, rótulo branco e ativo amarelo (cor do admin)", () => {
    expect(bloco).toMatch(/\.bottom-nav-item \{\s*flex: 1 1 0; min-width: 0; min-height: 56px/);
    expect(bloco).toMatch(/\.bottom-nav-item\.is-active \{ background: transparent; color: var\(--admin\)/);
  });
  test("o conteúdo não fica escondido atrás da barra", () => {
    expect(bloco).toMatch(/body:has\(\.bottom-nav--admin\) \{ padding-bottom: calc\(92px/);
  });
});
