// tests/fotoPerfil.test.js
// Foto de perfil vista por OUTROS usuários: a do dev vai para o banco
// (user_photos, como o logo da empresa), a do GitHub fica salva no perfil, uma
// foto antiga em disco que sumiu vira null (iniciais em vez de imagem quebrada),
// e as telas que mostram dev ou empresa usam a foto.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/githubAnalyzer", () => ({ analisarGitHub: jest.fn(), matchSkillsFromGitHub: jest.fn().mockResolvedValue() }));

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const db = require("../database/db");
const { fotoPublica, salvarFoto } = require("../services/fotoPerfil");

const ROOT = path.join(__dirname, "..");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(32, 7)]);

let fotos, consultas;
beforeEach(() => {
  jest.clearAllMocks();
  fotos = new Map();
  consultas = [];
  db.query.mockImplementation(async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    consultas.push({ sql: q, params });
    if (q.startsWith("INSERT INTO user_photos")) { fotos.set(params[0], { mime: params[1], data: params[2] }); return [{}]; }
    if (q.startsWith("SELECT mime, data FROM user_photos")) return [fotos.has(params[0]) ? [fotos.get(params[0])] : []];
    if (q.startsWith("UPDATE user_dev_profiles SET avatar_url")) return [{ affectedRows: 1 }];
    throw new Error(`SQL inesperado no teste: ${q}`);
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("fotoPublica", () => {
  test("foto no banco e do GitHub passam; foto antiga em disco só se o arquivo existir", () => {
    expect(fotoPublica("/api/fotos/5?v=1")).toBe("/api/fotos/5?v=1");
    expect(fotoPublica("https://avatars.githubusercontent.com/u/1?v=4")).toBe("https://avatars.githubusercontent.com/u/1?v=4");
    expect(fotoPublica("/uploads/avatars/999999.jpg")).toBeNull(); // sumiu (o disco do Render é apagado)
    expect(fotoPublica("/uploads/../../.env")).toBeNull();
    expect(fotoPublica(null)).toBeNull();
    expect(fotoPublica("")).toBeNull();
  });

  test("salvarFoto grava a imagem e devolve o endereço público; arquivo que não é imagem não grava", async () => {
    expect(await salvarFoto(db, 7, PNG)).toMatch(/^\/api\/fotos\/7\?v=\d+$/);
    expect(fotos.get(7).mime).toBe("image/png");
    expect(await salvarFoto(db, 7, Buffer.from("<html>nao sou imagem</html>"))).toBeNull();
  });
});

describe("foto do dev (POST /api/user/avatar) vai para o banco, não para o disco", () => {
  const controller = require("../controllers/profileController");
  const montar = (user = { id: 9, type: "dev" }) => {
    const sessao = { user };
    const app = express();
    app.use((req, _res, next) => { req.session = sessao; next(); });
    app.post("/avatar", controller.handleAvatarUpload, controller.saveAvatar);
    app.use("/api/fotos", require("../routes/fotos"));
    return { app, sessao };
  };

  test("salva em user_photos, grava o avatar_url /api/fotos/<id> e qualquer um consegue ver", async () => {
    const { app, sessao } = montar();
    const res = await request(app).post("/avatar").attach("avatar", PNG, { filename: "eu.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.avatar).toMatch(/^\/api\/fotos\/9\?v=\d+$/);
    expect(consultas.find(c => c.sql.startsWith("UPDATE user_dev_profiles SET avatar_url")).params).toEqual([res.body.avatar, 9]);
    expect(sessao.user.avatar).toBe(res.body.avatar);

    const visto = await request(app).get(res.body.avatar).buffer(true); // sem login
    expect(visto.status).toBe(200);
    expect(visto.headers["content-type"]).toBe("image/png");
  });

  test("arquivo disfarçado de imagem é recusado e nada é gravado", async () => {
    const { app } = montar();
    const res = await request(app).post("/avatar").attach("avatar", Buffer.from("<script>alert(1)</script>"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(fotos.size).toBe(0);
  });

  test("nada mais é gravado em public/uploads", () => {
    const src = ler("controllers/profileController.js");
    expect(src).not.toMatch(/diskStorage|uploads\/avatars|UPLOAD_DIR/);
    expect(src).toMatch(/multer\.memoryStorage\(\)/);
  });
});

describe("foto do GitHub vira a foto do perfil", () => {
  test("no login com GitHub, sem foto salva (ou com a antiga em disco que sumiu), a do GitHub é gravada", () => {
    const src = ler("controllers/authController.js");
    expect(src).toMatch(/if \(!fotoPublica\(devProfile\.avatar_url\) && githubUser\.avatar_url\)/);
    expect(src).toMatch(/UPDATE user_dev_profiles SET avatar_url = \? WHERE user_id = \?/);
  });
});

describe("as telas mostram a foto de quem é visto de fora", () => {
  test.each([
    ["views/empresa-desenvolvedores.ejs", "dev.avatar_url"],
    ["views/empresa-candidaturas.ejs", "app.avatar_url"],
    ["views/empresa-mensagens.ejs", "c.dev_avatar_url"],
    ["views/empresa-mensagens.ejs", "activeConversation.dev_avatar_url"],
    ["views/empresa-mensagens.ejs", "data.avatar_url"],
    ["views/mensagens.ejs", "c.company_logo_url"],
    ["views/mensagens.ejs", "activeConversation.company_logo_url"],
    ["views/mensagens.ejs", "data.logo_url"],
  ])("%s usa %s", (tela, campo) => {
    const html = ler(tela);
    expect(html).toContain(`data-foto="\${escapeHtml(${campo} || "")}"`);
    expect(html).toContain('<script src="/js/foto-perfil.js"></script>');
  });

  test("as APIs mandam a foto (já sem as que sumiram)", () => {
    const empresa = ler("controllers/empresaController.js");
    expect(empresa).toMatch(/avatar_url:\s+fotoPublica\(dev\.avatar_url\)/);   // lista de devs e perfil do dev
    expect(empresa).toMatch(/avatar_url: fotoPublica\(a\.avatar_url\)/);        // candidaturas
    expect(empresa).toMatch(/logo_url: fotoPublica\(profile\.logo_url\)/);      // perfil público da empresa
    const mensagens = ler("controllers/messagesController.js");
    expect(mensagens).toMatch(/dev_avatar_url: fotoPublica\(r\.dev_avatar_url\)/);
    expect(mensagens).toMatch(/company_logo_url: fotoPublica\(r\.company_logo_url\)/);
    expect(ler("controllers/adminController.js")).toMatch(/fotoPublica\(/);
  });

  test("foto-perfil.js: imagem só entra depois de carregar (senão ficam as iniciais), sem HTML montado", () => {
    const js = ler("public/js/foto-perfil.js");
    expect(js).toMatch(/addEventListener\("load"/);
    expect(js).toMatch(/MutationObserver/);
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  test.each([
    ["views/admin-dashboard.ejs", "safeUrl(d.avatar_url)"], ["views/admin-dashboard.ejs", "safeUrl(e.logo_url)"],
    ["views/admin-usuarios.ejs", "safeUrl(u.avatar_url)"], ["views/admin-usuario.ejs", "safeUrl(dev.avatar_url)"],
    ["views/admin-empresas.ejs", "safeUrl(e.logo_url)"], ["views/admin-empresa.ejs", "safeUrl(co.logo_url)"],
    ["views/admin-relatorio-empresas.ejs", "safeUrl(e.logo_url)"], ["views/admin-relatorio-matchs.ejs", "safeUrl(m.avatar_url)"],
    ["views/admin-relatorio-planos.ejs", "safeUrl(a.avatar_url)"], ["views/mensagens.ejs", "logo"],
  ])("%s mostra a foto (%s) quando ela carrega", (tela, campo) => {
    const html = ler(tela);
    expect(html).toContain(`data-foto="\${escapeHtml(${campo} || "")}"`);
    expect(html).toContain("/js/foto-perfil.js");
    expect(html).not.toMatch(/<img class="ad[mu]-avatar" src=/); // nada de <img> direto, que quebra
  });

  test("cabeçalhos de dev e empresa: iniciais sempre, foto quando carrega", () => {
    for (const p of ["views/partials/header-dev.ejs", "views/partials/header-company.ejs"]) {
      const html = ler(p);
      expect(html).toContain("/js/foto-perfil.js");
      expect(html).toMatch(/data-foto="<%= user\.avatar \|\| '' %>"/);
      expect(html).not.toMatch(/<img src="<%= user\.avatar %>"/);
    }
  });

  test("admin recebe o logo das empresas", () => {
    expect(ler("controllers/adminController.js")).toMatch(/logo_url: fotoPublica\(r\.logo_url\)/);
    expect(ler("services/relatorioEmpresas.js")).toMatch(/logo_url: fotoPublica\(e\.logo_url\)/);
  });

  test("perfil do dev visto pela empresa volta para as iniciais se a foto falhar", () => {
    expect(ler("views/perfil-dev-empresa.ejs")).toMatch(/avatarImg\.addEventListener\("error"/);
  });
});
