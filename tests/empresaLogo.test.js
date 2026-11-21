// tests/empresaLogo.test.js
// Foto (logo) da empresa: envio em POST /api/empresa/logo, leitura pública em
// GET /api/fotos/:id, o logo_url no perfil e na sessão (cabeçalho) e o
// botão no Perfil e nas Configurações. A imagem vai para o banco (user_photos),
// não para o disco: o disco do Render é apagado (services/fotoPerfil.js).
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn(),
  getUserPlan: jest.fn(),
  getPlanCodesBulk: jest.fn().mockResolvedValue({}),
}));
jest.mock("../models/User", () => ({ findByEmail: jest.fn(), findCompanyProfile: jest.fn() }));
jest.mock("bcrypt", () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const express = require("express");
const request = require("supertest");
const db = require("../database/db");
const User = require("../models/User");
const { getUserPlan } = require("../services/subscriptionService");
const { PLANS } = require("../config/plans");
const { tipoDaImagem, urlDaFoto: urlDoLogo, FOTO_MAX_BYTES: LOGO_MAX_BYTES } = require("../services/fotoPerfil");

const ROOT = path.join(__dirname, "..");
const VIEWS = path.join(ROOT, "views");
const EMPRESA = 5;

// Começo de arquivo de cada formato (o resto não importa para a conferência).
const resto = Buffer.alloc(32, 7);
const IMG = {
  png:  Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), resto]),
  jpeg: Buffer.concat([Buffer.from("ffd8ffe000104a464946", "hex"), resto]),
  gif:  Buffer.concat([Buffer.from("GIF89a", "latin1"), resto]),
  webp: Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1"), resto]),
};
const HTML_DISFARCADO = Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// Banco falso: guarda os logos e registra as consultas.
let logos, consultas, falharEm;
beforeEach(() => {
  jest.clearAllMocks();
  logos = new Map();
  consultas = [];
  falharEm = null;
  db.query.mockImplementation(async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    consultas.push({ sql: q, params });
    if (falharEm && falharEm.test(q)) throw new Error("falha simulada no banco");
    if (q.startsWith("INSERT INTO user_photos")) {
      logos.set(params[0], { mime: params[1], data: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE user_company_profiles SET logo_url = ?")) return [{ affectedRows: 1 }];
    if (q.startsWith("SELECT mime, data FROM user_photos WHERE user_id = ?")) {
      return [logos.has(params[0]) ? [logos.get(params[0])] : []];
    }
    // tabela antiga (routes/fotos.js lê dela só para o endereço antigo): aqui ela não existe
    if (q.startsWith("SELECT mime, data FROM company_logos")) {
      throw Object.assign(new Error("Table 'company_logos' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
    }
    throw new Error(`SQL inesperado no teste: ${q}`);
  });
});
const escritas = () => consultas.filter(c => /^(INSERT|UPDATE|DELETE)/i.test(c.sql));

function montarApp(user = { id: EMPRESA, type: "empresa", name: "Tech" }) {
  const sessao = { user: user ? { ...user } : null };
  const app = express();
  app.use((req, _res, next) => { req.session = sessao; next(); });
  app.use("/api/empresa", require("../routes/empresa"));
  app.use("/api/fotos", require("../routes/fotos"));
  return { app, sessao };
}
const enviar = (app, buf, opcoes = { filename: "logo.png", contentType: "image/png" }, campo = "logo") =>
  request(app).post("/api/empresa/logo").attach(campo, buf, opcoes);

describe("services/fotoPerfil — tipo pela assinatura do arquivo", () => {
  test.each([["png", "image/png"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"]])("%s", (fmt, mime) => {
    expect(tipoDaImagem(IMG[fmt])).toBe(mime);
  });

  test("HTML, SVG, arquivo curto e o que não é Buffer não passam", () => {
    expect(tipoDaImagem(HTML_DISFARCADO)).toBeNull();
    expect(tipoDaImagem(SVG)).toBeNull();
    expect(tipoDaImagem(IMG.png.subarray(0, 8))).toBeNull();
    expect(tipoDaImagem("GIF89a............")).toBeNull();
    expect(tipoDaImagem(undefined)).toBeNull();
  });

  test("endereço com versão (muda a cada envio)", () => {
    expect(urlDoLogo(5, 1763500000000)).toBe("/api/fotos/5?v=1763500000000");
  });
});

describe("POST /api/empresa/logo", () => {
  test("salva a imagem no banco, aponta logo_url para ela e põe a foto na sessão (cabeçalho)", async () => {
    const { app, sessao } = montarApp();
    const res = await enviar(app, IMG.png);

    expect(res.status).toBe(200);
    expect(res.body.logo).toMatch(/^\/api\/fotos\/5\?v=\d+$/);
    expect(logos.get(EMPRESA)).toEqual({ mime: "image/png", data: IMG.png });
    const update = consultas.find(c => c.sql.startsWith("UPDATE user_company_profiles SET logo_url"));
    expect(update.params).toEqual([res.body.logo, EMPRESA]);
    expect(sessao.user.avatar).toBe(res.body.logo);
  });

  test("o tipo vem dos bytes, não do nome nem do tipo informado pelo navegador", async () => {
    const { app } = montarApp();
    const res = await enviar(app, IMG.webp, { filename: "foto.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(logos.get(EMPRESA).mime).toBe("image/webp");
  });

  test("trocar a foto substitui a anterior (uma por empresa)", async () => {
    const { app } = montarApp();
    await enviar(app, IMG.png);
    await enviar(app, IMG.jpeg, { filename: "nova.jpg", contentType: "image/jpeg" });
    expect(logos.size).toBe(1);
    expect(logos.get(EMPRESA).mime).toBe("image/jpeg");
    expect(consultas.filter(c => c.sql.startsWith("INSERT INTO user_photos")).every(c => /ON DUPLICATE KEY UPDATE/.test(c.sql))).toBe(true);
  });

  test.each([
    ["HTML disfarçado de PNG", HTML_DISFARCADO, { filename: "logo.png", contentType: "image/png" }],
    ["SVG", SVG, { filename: "logo.svg", contentType: "image/svg+xml" }],
  ])("recusa %s, sem gravar nada", async (_nome, buf, opcoes) => {
    const { app, sessao } = montarApp();
    const res = await enviar(app, buf, opcoes);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Formato inválido. Use JPEG, PNG, WebP ou GIF.");
    expect(escritas()).toEqual([]);
    expect(sessao.user.avatar).toBeUndefined();
  });

  test("recusa arquivo acima de 2 MB", async () => {
    const { app } = montarApp();
    const grande = Buffer.concat([IMG.png, Buffer.alloc(LOGO_MAX_BYTES)]);
    const res = await enviar(app, grande);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Arquivo muito grande. Máximo 2 MB.");
    expect(escritas()).toEqual([]);
  });

  test("sem arquivo, ou o arquivo em outro campo", async () => {
    const { app } = montarApp();
    const vazio = await request(app).post("/api/empresa/logo").field("nada", "1");
    expect(vazio.status).toBe(400);
    expect(vazio.body.error).toBe("Nenhuma imagem enviada.");
    const outroCampo = await enviar(app, IMG.png, undefined, "avatar");
    expect(outroCampo.status).toBe(400);
    expect(escritas()).toEqual([]);
  });

  test("só empresa logada envia (dev: 403; sem login: 401)", async () => {
    const dev = await enviar(montarApp({ id: 9, type: "dev" }).app, IMG.png);
    expect(dev.status).toBe(403);
    const visitante = await enviar(montarApp(null).app, IMG.png);
    expect(visitante.status).toBe(401);
    expect(escritas()).toEqual([]);
  });

  test("falha no banco: 500 com mensagem e a foto da sessão não muda", async () => {
    const { app, sessao } = montarApp({ id: EMPRESA, type: "empresa", avatar: "/api/fotos/5?v=1" });
    falharEm = /^INSERT INTO user_photos/;
    const res = await enviar(app, IMG.png);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Não foi possível salvar a foto. Tente de novo.");
    expect(sessao.user.avatar).toBe("/api/fotos/5?v=1");
  });
});

describe("GET /api/fotos/:id", () => {
  test("devolve a imagem com o tipo certo, sem precisar de login (vitrine pública)", async () => {
    logos.set(EMPRESA, { mime: "image/png", data: IMG.png });
    const res = await request(montarApp(null).app).get("/api/fotos/5?v=123").buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(res.body, IMG.png)).toBe(0);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("sem a versão no endereço, guarda só por pouco tempo", async () => {
    logos.set(EMPRESA, { mime: "image/jpeg", data: IMG.jpeg });
    const res = await request(montarApp(null).app).get("/api/fotos/5");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  test("empresa sem foto, id inválido ou tipo fora da lista: 404", async () => {
    const { app } = montarApp(null);
    expect((await request(app).get("/api/fotos/77")).status).toBe(404);
    for (const id of ["abc", "0", "-3", "1.5"]) expect((await request(app).get(`/api/fotos/${id}`)).status).toBe(404);
    expect(consultas.filter(c => c.sql.startsWith("SELECT mime, data FROM user_photos"))).toHaveLength(1); // id inválido nem consulta o banco
    logos.set(EMPRESA, { mime: "text/html", data: HTML_DISFARCADO });
    expect((await request(app).get("/api/fotos/5")).status).toBe(404);
  });
});

describe("logo_url no perfil e na sessão", () => {
  test("GET /api/empresa/profile devolve o logo_url (vazio sem foto)", async () => {
    const controller = require("../controllers/empresaController");
    getUserPlan.mockResolvedValue(PLANS.empresa_free);
    const perfil = (extra) => db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
      if (s.startsWith("select id, email, created_at from users")) return [[{ id: EMPRESA, email: "a@b.c" }]];
      if (s.startsWith("select * from user_company_profiles")) return [[{ razao_social: "Tech LTDA", nome_fantasia: "Tech", ...extra }]];
      if (s.includes("count(*) as total")) return [[{ total: 0, ativas: 0 }]];
      if (s.includes("from jobs j")) return [[]];
      throw new Error(`SQL inesperado no teste: ${sql}`);
    });
    const chamar = async () => {
      const res = { status() { return res; }, json(b) { res.body = b; return res; } };
      await controller.getProfile({ session: { user: { id: EMPRESA, type: "empresa" } } }, res);
      return res.body;
    };
    perfil({});
    expect((await chamar()).logo_url).toBe("");
    perfil({ logo_url: "/api/fotos/5?v=9" });
    expect((await chamar()).logo_url).toBe("/api/fotos/5?v=9");
  });

  test("login de empresa põe a foto na sessão, para o cabeçalho mostrar", async () => {
    const usersController = require("../controllers/usersController");
    User.findByEmail.mockResolvedValue({ id: EMPRESA, email: "rh@tech.com", type: "empresa", password_hash: "x", active: 1 });
    const login = async (perfil) => {
      User.findCompanyProfile.mockResolvedValue(perfil);
      const req = { body: { email: "rh@tech.com", password: "senha-de-teste" }, session: {} };
      const res = { status() { return res; }, json() { return res; } };
      await usersController.login(req, res);
      return req.session.user;
    };
    expect((await login({ nome_fantasia: "Tech", razao_social: "Tech LTDA", logo_url: "/api/fotos/5?v=9" })).avatar).toBe("/api/fotos/5?v=9");
    expect((await login({ nome_fantasia: "Tech", razao_social: "Tech LTDA", logo_url: null })).avatar).toBeNull();
  });
});

describe("Configurações (perfil e configurações numa página): o logo é o botão da foto", () => {
  const usuario = { id: EMPRESA, type: "empresa", name: "Tech", email: "rh@tech.com" };
  test.each(["empresa-configuracoes.ejs"])("%s", async (view) => {
    const html = await ejs.renderFile(path.join(VIEWS, view), { user: usuario, currentPage: "empresa-config" }, { views: [VIEWS] });
    expect(html).toMatch(/<button type="button" class="pe-logo[^"]* pe-logo--botao" id="logo-btn" aria-label="Adicionar foto da empresa"/);
    expect(html).toContain('<span id="company-logo" data-logo-iniciais aria-hidden="true">?</span>');
    expect(html).toMatch(/<span class="pe-logo-badge" aria-hidden="true"><svg/);
    expect(html).toContain('<input type="file" id="logo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />');
    // o script da foto carrega antes do script da página, que o usa
    expect(html.indexOf('<script src="/js/logo-empresa.js"></script>')).toBeGreaterThan(-1);
    expect(html.indexOf('<script src="/js/logo-empresa.js"></script>')).toBeLessThan(html.indexOf("LogoEmpresa.iniciar("));
    expect(html).toMatch(/LogoEmpresa\.definir\(\$\("logo-btn"\), data\.logo_url\)/);
  });

  test("public/js/logo-empresa.js: envia no campo certo, não monta HTML com dados e respeita a CSP", () => {
    const js = fs.readFileSync(path.join(ROOT, "public", "js", "logo-empresa.js"), "utf8");
    expect(js).toContain('fetch("/api/empresa/logo", { method: "POST", body: dados })');
    expect(js).toContain('dados.append("logo", envio, "logo")');
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(js).not.toMatch(/createObjectURL/); // a CSP libera data: nas imagens, não blob:
    expect(js).toMatch(/readAsDataURL/);
    // mesmos tipos e limite do servidor
    expect(js).toContain('const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];');
    expect(js).toContain("const MAX_BYTES = 2 * 1024 * 1024;");
  });

  test("a tabela da foto é criada na subida, separada do resto das migrações", () => {
    const src = fs.readFileSync(path.join(ROOT, "database", "db.js"), "utf8");
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS user_photos \(/);
    expect(src).toMatch(/FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    // isolada como todas as outras (tests/dbMigracoes.test.js): se falhar, só ela fica de fora
    expect(src).toMatch(/await migracao\.query\(`\s*CREATE TABLE IF NOT EXISTS user_photos/);
  });
});
