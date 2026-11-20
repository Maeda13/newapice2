// tests/destinoAposLogin.test.js
// Botões e links que pedem conta levam a pessoa para a página que ela queria
// depois de entrar ou criar a conta (?next=), e quem já tem sessão vai direto.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../models/User", () => ({
  findByEmail: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(3),
  createDevProfile: jest.fn(), createCompanyProfile: jest.fn(), cnpjExists: jest.fn().mockResolvedValue(false),
  criarContaComPerfil: jest.fn().mockResolvedValue(3),
}));
jest.mock("bcrypt", () => ({ hash: jest.fn().mockResolvedValue("hash"), compare: jest.fn() }));

const fs = require("fs");
const path = require("path");
const { redirectIfAuth } = require("../middlewares/auth");
const usersController = require("../controllers/usersController");

const ler = rel => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const redirecionado = (user, query = {}) => {
  let destino = null, seguiu = false;
  redirectIfAuth({ session: user ? { user } : {}, query }, { redirect: u => { destino = u; } }, () => { seguiu = true; });
  return seguiu ? "mostra a página" : destino;
};

describe("quem já tem sessão em /login ou /cadastro", () => {
  test("vai para o destino pedido", () => {
    expect(redirecionado({ type: "dev" }, { next: "/planos" })).toBe("/planos");
    expect(redirecionado({ type: "empresa" }, { next: "/planos?tipo=empresa" })).toBe("/planos?tipo=empresa");
  });
  test("sem destino, para a página inicial da conta", () => {
    expect(redirecionado({ type: "dev" })).toBe("/dashboard");
    expect(redirecionado({ type: "empresa" })).toBe("/empresa/dashboard");
  });
  test("destino externo é ignorado", () => {
    expect(redirecionado({ type: "dev" }, { next: "//evil.com" })).toBe("/dashboard");
    expect(redirecionado({ type: "dev" }, { next: "https://evil.com" })).toBe("/dashboard");
  });
  test("visitante vê a página", () => {
    expect(redirecionado(null, { next: "/planos" })).toBe("mostra a página");
  });
  test("/cadastro também redireciona quem está logado", () => {
    expect(ler("server.js")).toMatch(/app\.get\("\/cadastro", redirectIfAuth,/);
  });
});

describe("cadastro volta para a página que pediu a conta", () => {
  const cadastrar = async (body) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await usersController.register({ body: { type: "dev", email: "a@b.com", password: "senha-de-teste-1", nome: "A", ...body }, session: {} }, res);
    return res.body;
  };
  test("com next seguro, o redirect é ele", async () => {
    expect((await cadastrar({ next: "/planos" })).redirect).toBe("/planos");
  });
  test("sem next ou com next externo, o de sempre", async () => {
    expect((await cadastrar({})).redirect).toBe("/dashboard");
    expect((await cadastrar({ next: "//evil.com" })).redirect).toBe("/dashboard");
  });
  test("a tela de cadastro manda o next e leva o destino ao GitHub e ao 'Entrar'", () => {
    const tela = ler("views/cadastro.ejs");
    expect(tela).toMatch(/next: new URLSearchParams\(location\.search\)\.get\("next"\)/);
    expect(tela).toMatch(/github\.href = `\/auth\/github\?next=\$\{encodeURIComponent\(destino\)\}`/);
    expect(tela).toMatch(/closest\('a\[href\^="\/login"\]'\)/);
  });
});

describe("links que pedem conta", () => {
  test("login leva o destino para 'Criar conta grátis' e abre a aba de empresa para destinos da empresa", () => {
    const tela = ler("views/login.ejs");
    expect(tela).toMatch(/closest\('a\[href\^="\/cadastro"\]'\)/);
    expect(tela).toMatch(/\[\?&\]tipo=empresa/);
  });
  // O pagamento do PRO (/planos/<código>/assinar) faz o próprio login e volta para ele;
  // o período (mensal/anual) segue a escolha do card (public/js/plano-toggle.js).
  test("Fazer upgrade vai direto para o pagamento do PRO (e não para o cadastro)", () => {
    const { cardsPlano } = require("../services/planoCards");
    for (const [view, code] of [["views/para-devs.ejs", "dev_pro"], ["views/para-empresas.ejs", "empresa_premium"]]) {
      expect(ler(view).match(/include\("partials\/plano-cards"/g)).toHaveLength(3);
      const [mensal, anual] = cardsPlano(code);
      expect(mensal.href).toBe(`/planos/${code}/assinar`);
      expect(anual.href).toBe(`/planos/${code}/assinar?periodo=anual`);
      expect(ler(view)).not.toMatch(/href="\/cadastro"[^>]*>Fazer upgrade/);
    }
    expect(ler("views/partials/plano-cards.ejs")).toContain(">Fazer upgrade</a>");
  });
  test("sessão expirada no meio da página volta para ela depois do login", () => {
    for (const v of ["empresa-dashboard", "empresa-desenvolvedores", "empresa-matchs", "empresa-perfil", "empresa-configuracoes", "perfil-dev-empresa", "progresso"]) {
      const tela = ler(`views/${v}.ejs`);
      expect([v, /location\.href = "\/login";/.test(tela)]).toEqual([v, false]);
      expect(tela).toMatch(/next=\$\{encodeURIComponent\(location\.pathname \+ location\.search\)\}/);
    }
  });
});
