// /empresa/vagas no tablet (768–1023px): lista de cards no lugar da tabela, com a
// pílula "Vagas", busca, botões e o filtro Todas/Ativas/Pausadas mantido.
// Celular e desktop continuam com a tabela.
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const VIEW = path.join(ROOT, "views", "empresa-vagas.ejs");
const html = ejs.render(fs.readFileSync(VIEW, "utf8"), { user: { type: "empresa", company: "Tech" } }, { views: [path.join(ROOT, "views")], filename: VIEW });
const fonte = ler("views/empresa-vagas.ejs");
const css = ler("public/css/empresa-vagas.css");

describe("empresa-vagas.ejs — marcação", () => {
  test("um só h1; o texto extra do desktop fica num span que o tablet esconde (vira só 'Vagas')", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="page-title"><span class="vt-desktop">Gerenciar </span>Vagas</h1>');
  });

  test("filtro Todas / Ativas / Pausadas continua, com a busca e a lista de cards", () => {
    for (const f of ["todas", "ativas", "pausadas"]) expect(html).toContain(`data-f="${f}"`);
    expect(html).toContain('id="q-vagas"');
    expect(html).toContain('id="jobs-cards"');
    expect(html).toContain('id="jobs-table"'); // a tabela segue existindo para celular e desktop
    expect(html).toContain("Adicionar vaga");
  });

  test("a busca tem nome acessível e os cards não interpolam texto cru de usuário", () => {
    expect(html).toMatch(/id="q-vagas"[\s\S]*?aria-label="Buscar vagas"/);
    const bloco = fonte.slice(fonte.indexOf("function renderCards"), fonte.indexOf("function formatDate"));
    expect(bloco).toContain("escapeHtml(job.title)");
    expect(bloco).not.toMatch(/\$\{job\.title\}/);
    expect(bloco).not.toMatch(/onclick=/);
  });

  test("card ativo: Gerenciar vaga, Editar e Desativar; inativo: Reativar vaga, Editar e Excluir", () => {
    const bloco = fonte.slice(fonte.indexOf("function renderCards"), fonte.indexOf("function formatDate"));
    for (const t of ["Candidatos inscritos:", "Matches:", "Gerenciar vaga", "Reativar vaga", "Desativar", "Excluir", "Editar", "Área:", "Período:"]) {
      expect(bloco).toContain(t);
    }
    expect(bloco).toContain("/candidaturas");
  });
});

describe("empresa-vagas.css — cards no tablet e no celular; desktop continua com a tabela", () => {
  const i = css.indexOf("@media (max-width: 1023.98px)");
  const j = css.indexOf("@media (max-width: 767.98px)");
  const fora = css.slice(0, i), tablet = css.slice(i, j), celular = css.slice(j);

  test("os blocos do tablet (até 1023px) e do celular (até 767px) existem e fecham", () => {
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    for (const bloco of [tablet, celular]) {
      expect((bloco.match(/\{/g) || []).length).toBe((bloco.match(/\}/g) || []).length);
    }
  });

  test("celular: 1 coluna, status em barra cheia e Editar/Desativar lado a lado", () => {
    expect(celular).toContain("#content:not([hidden]) { grid-template-columns: 1fr;");
    expect(celular).toContain(".btn-nova-vaga, .link-vitrine { grid-column: 1 / -1; }");
    expect(celular).toContain("display: grid; grid-template-columns: 1fr 1fr; gap: 8px;");
    expect(celular).toContain(".vt-card__status { grid-column: 1 / -1;");
  });

  test("fora do tablet os cards e o texto do tablet ficam escondidos", () => {
    expect(fora).toMatch(/\.vt-tablet, \.vt-cards, \.vt-busca__ico \{ display: none; \}/);
  });

  test("no tablet a tabela some e os cards aparecem", () => {
    expect(tablet).toMatch(/\.jobs-table \{ display: none !important; \}/);
    expect(tablet).toMatch(/\.vt-cards \{ display: flex;/);
    expect(tablet).toMatch(/\.vt-desktop \{ display: none; \}/);
  });
});

describe("GET /api/empresa/dashboard", () => {
  test("devolve o fim do período da vaga (expires_at), usado no card do tablet", () => {
    const ctrl = ler("controllers/empresaController.js");
    const ini = ctrl.indexOf("getDashboard: async");
    const sel = ctrl.slice(ini, ctrl.indexOf("FROM jobs j", ini));
    expect(sel).toContain("j.expires_at");
    expect(sel).toContain("total_matches");
  });
});
