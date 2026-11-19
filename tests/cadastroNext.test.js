const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe("cadastro: ?next= leva para a página pedida após o registro", () => {
  test("cadastro.ejs reenvia next no POST e no botão do GitHub", () => {
    const v = read("views/cadastro.ejs");
    expect(v).toMatch(/payload\.next\s*=\s*nextParam/);
    expect(v).toMatch(/\/auth\/github\?next=/);
  });

  test("register() usa next só quando é path interno seguro", () => {
    const c = read("controllers/usersController.js");
    const reg = c.slice(c.indexOf("register: async"), c.indexOf("login: async"));
    expect(reg).toMatch(/startsWith\("\/"\)/);
    expect(reg).toMatch(/!next\.startsWith\("\/\/"\)/);
    expect(reg).toMatch(/isSafeNext \? next/);
  });
});

describe("Fazer upgrade (Para Devs / Para Empresas) → login → /planos", () => {
  test.each([
    ["views/para-devs.ejs", /href="\/login\?next=%2Fplanos" class="pd-btn pd-btn--primary">Fazer upgrade/g],
    ["views/para-empresas.ejs", /href="\/login\?tipo=empresa&amp;next=%2Fplanos" class="pd-btn pd-btn--primary">Fazer upgrade/g],
  ])("%s: todos os botões de upgrade levam ao login com next=/planos", (file, re) => {
    const v = read(file);
    expect(v.match(re)).toHaveLength(2);
    expect(v).not.toMatch(/href="\/cadastro[^"]*" class="pd-btn pd-btn--primary">Fazer upgrade/);
  });

  test("login.ejs repassa o next para o link de cadastro", () => {
    const v = read("views/login.ejs");
    expect(v).toMatch(/\/cadastro\$\{nextQs\}/);
  });
});

describe("quem já está logado e chega com ?next=", () => {
  const { redirectIfAuth, redirectToNextIfAuth } = require("../middlewares/auth");
  const run = (mw, user, next) => {
    const res = { redirect: jest.fn() };
    const cb = jest.fn();
    mw({ session: { user }, query: { next } }, res, cb);
    return { res, cb };
  };

  test("home: 'Analisar meu github' leva ao /perfil do dev", () => {
    expect(read("views/index.ejs")).toMatch(/href="\/cadastro\?next=%2Fperfil" class="btn-primary btn-primary--purple"/);
  });

  test("logado com next seguro vai para o next (login e cadastro)", () => {
    expect(run(redirectIfAuth, { type: "dev" }, "/perfil").res.redirect).toHaveBeenCalledWith("/perfil");
    expect(run(redirectToNextIfAuth, { type: "dev" }, "/perfil").res.redirect).toHaveBeenCalledWith("/perfil");
  });

  test("next externo é ignorado", () => {
    expect(run(redirectIfAuth, { type: "dev" }, "//evil.com").res.redirect).toHaveBeenCalledWith("/dashboard");
    const r = run(redirectToNextIfAuth, { type: "dev" }, "https://evil.com");
    expect(r.res.redirect).not.toHaveBeenCalled();
    expect(r.cb).toHaveBeenCalled();
  });

  test("visitante e logado sem next seguem o fluxo normal no cadastro", () => {
    expect(run(redirectToNextIfAuth, null, "/perfil").cb).toHaveBeenCalled();
    expect(run(redirectToNextIfAuth, { type: "dev" }, undefined).cb).toHaveBeenCalled();
  });
});
