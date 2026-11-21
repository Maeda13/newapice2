// A foto de perfil (dev) e o logo (empresa) aparecem em toda página logada, não só nas que
// carregavam o public/js/foto-perfil.js por conta própria.
//
// Bug: os cabeçalhos de dev e de empresa marcavam a foto com data-foto, mas quem troca as
// iniciais pela imagem é o foto-perfil.js, e nenhum cabeçalho o carregava. Só mensagens,
// candidaturas, lista de desenvolvedores e o admin tinham o script; no dashboard, vagas,
// roadmap, perfil, configurações etc. ficavam as iniciais, mesmo com a foto salva.
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VIEWS = path.join(ROOT, "views");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").split("\r\n").join("\n");
const render = (parcial, user) => ejs.renderFile(path.join(VIEWS, "partials", parcial), { user, currentPage: "" }, { views: [VIEWS] });

describe("cabeçalhos carregam o foto-perfil.js", () => {
  test.each([
    ["header-dev.ejs", { type: "dev", name: "Igor", avatar: "/api/fotos/10?v=1" }],
    ["header-company.ejs", { type: "empresa", name: "Tech", company: "Tech", avatar: "/api/fotos/20?v=1" }],
  ])("%s: a foto vai no data-foto e o script que a aplica vem junto", async (parcial, user) => {
    const html = await render(parcial, user);
    expect(html).toContain(`data-foto="${user.avatar}"`);
    expect(html).toContain('<script src="/js/foto-perfil.js" defer></script>');
  });

  test("todas as páginas de dev e de empresa usam um desses cabeçalhos (e por isso ganham o script)", () => {
    const usaCabecalho = /include\(['"]partials\/header-(dev|company)['"]/;
    for (const v of ["dashboard", "progresso", "vagas", "perfil-dev", "repositorios", "mensagens", "mentor",
                     "empresa-dashboard", "empresa-vagas", "empresa-matchs", "empresa-configuracoes", "perfil-dev-empresa"]) {
      expect([v, usaCabecalho.test(ler(`views/${v}.ejs`))]).toEqual([v, true]);
    }
  });
});

describe("public/js/foto-perfil.js", () => {
  const js = ler("public/js/foto-perfil.js");

  test("carregado duas vezes (cabeçalho + página), a segunda cópia não faz nada", () => {
    expect(js).toMatch(/if \(window\.FotoPerfil\) return;/);
    expect(js.indexOf("if (window.FotoPerfil) return;")).toBeLessThan(js.indexOf("function aplicarEm"));
  });

  test("a guarda funciona de verdade: duas execuções criam um só observador", () => {
    const observadores = [];
    const janela = {};
    const doc = { readyState: "complete", body: {}, querySelectorAll: () => [], addEventListener() {} };
    class FakeObserver { constructor() { observadores.push(this); } observe() {} }
    const rodar = new Function("window", "document", "MutationObserver", js);
    rodar(janela, doc, FakeObserver);
    rodar(janela, doc, FakeObserver);
    expect(observadores).toHaveLength(1);
    expect(typeof janela.FotoPerfil.aplicar).toBe("function");
  });
});

describe("pop-up de participantes mostra a foto da outra parte", () => {
  test("mensagens (dev): o logo da empresa entra pelo data-foto", () => {
    const v = ler("views/mensagens.ejs");
    expect(v).toContain('if (activeConversation.company_logo_url) avatar.setAttribute("data-foto", activeConversation.company_logo_url);');
    expect(v).toContain('$("partEmpresaAvatar").replaceWith(avatar);');
  });

  test("mensagens (empresa): a foto do dev entra pelo data-foto", () => {
    const v = ler("views/empresa-mensagens.ejs");
    expect(v).toContain('if (activeConversation.dev_avatar_url) avatar.setAttribute("data-foto", activeConversation.dev_avatar_url);');
    expect(v).toContain('$("partDevAvatar").replaceWith(avatar);');
  });
});
