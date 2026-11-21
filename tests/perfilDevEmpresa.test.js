// "Ver perfil" do dev (visão da empresa), padronizado com os protótipos de desktop,
// tablet e celular: hero com estatísticas, Habilidades (3 cartões), Tecnologias
// conhecidas, Repositórios e, se houver, Progresso em roadmaps.
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").split("\r\n").join("\n");
const VIEW = path.join(ROOT, "views", "perfil-dev-empresa.ejs");
const html = ejs.render(fs.readFileSync(VIEW, "utf8"), { devId: 7, currentPage: "empresa-devs", user: { type: "empresa", company: "Tech" } }, { views: [path.join(ROOT, "views")], filename: VIEW });
const fonte = ler("views/perfil-dev-empresa.ejs");
const css = ler("public/css/perfil-dev-empresa.css");

describe("perfil-dev-empresa.ejs — estrutura", () => {
  test("landmarks e headings: um h1 (nome), h2 por seção, h3 por repositório", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    expect(h2).toEqual(["Habilidades", "Tecnologias conhecidas", "Repositórios", "Progresso em roadmaps"]);
    expect(fonte).toContain('<h3 class="pde-repo__nome">');
  });

  test("Habilidades tem os 3 cartões do protótipo (sem inventar dado que o cadastro não coleta)", () => {
    for (const t of ["Língua estrangeira", "Escolaridade", "Instituição"]) expect(html).toContain(`<dt>${t}</dt><dd>Não informado</dd>`);
  });

  test("o hero mostra habilidades e dominadas (mesma regra do perfil do dev: confiança >= 60) e o botão de mensagem", () => {
    expect(fonte).toContain("s.confidence >= 60");
    expect(fonte).toContain("habilidades</span>");
    expect(fonte).toContain("dominadas</span>");
    expect(html).toContain('id="btn-contact"');
  });

  test("não exibe o e-mail do dev; mostra o @ do GitHub", () => {
    expect(fonte).not.toMatch(/dev\.email|\.email\b/);
    expect(fonte).toContain("`@${dev.github}`");
  });

  test("texto vindo do banco passa por escapeHtml e o link do repositório só aceita dono/nome válido", () => {
    expect(fonte).toContain("escapeHtml(r.name)");
    expect(fonte).toContain("escapeHtml(r.description)");
    expect(fonte).not.toMatch(/\$\{r\.(name|description|full_name)\}/);
    const re = /^[\w-][\w.-]*\/(?!\.+$)[\w.-]+$/;
    expect(re.test("igor/meu-projeto-web")).toBe(true);
    for (const ruim of ["../evil", "a/..", "javascript:alert(1)", "a b/c", "/x"]) expect(re.test(ruim)).toBe(false);
    expect(fonte).toContain('rel="noopener noreferrer"');
  });

  test("a ficha de cada tecnologia mantém o selo de origem e abre o detalhe por botão (teclado)", () => {
    expect(fonte).toMatch(/s\.source === "manual" \? "declarada" : "detectada no GitHub"/);
    expect(fonte).toContain('aria-expanded="false"');
  });
});

describe("perfil-dev-empresa.css — três formatos", () => {
  test("desktop: repositórios em 2 colunas; tablet (<1024px): 1 coluna", () => {
    expect(css).toContain(".pde-repos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
    const i = css.indexOf("@media (max-width: 1023.98px)");
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i, css.indexOf("@media (max-width: 767.98px)"))).toContain(".pde-repos { grid-template-columns: 1fr; }");
  });

  test("celular (<768px): hero centralizado e cartões em 1 coluna", () => {
    const i = css.indexOf("@media (max-width: 767.98px)");
    expect(i).toBeGreaterThan(-1);
    const m = css.slice(i);
    expect(m).toContain(".pde-hero { flex-direction: column; text-align: center;");
    expect(m).toContain(".pde-info { grid-template-columns: 1fr; }");
    expect(m).toContain(".pde-tech-lista { grid-template-columns: 1fr; }");
  });
});

describe("GET /api/empresa/dev/:id — campos novos (aditivos)", () => {
  const ctrl = ler("controllers/empresaController.js");
  const ini = ctrl.indexOf("getDevProfile: async");
  const bloco = ctrl.slice(ini, ctrl.indexOf("[GET /api/empresa/dev/:id]\", err.message", ini));

  test("devolve created_at e só repositórios públicos; não devolve e-mail", () => {
    expect(bloco).toContain("created_at:   desde");
    expect(bloco).toContain("is_public = 1");
    expect(bloco).not.toMatch(/email/i);
  });
});
