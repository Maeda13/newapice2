// tests/adminVagasLogo.test.js
// Admin → Vagas: o logo de cada empresa aparece na lista (coluna Empresa) e no
// selo da página da vaga, no lugar das iniciais; sem logo (ou se a imagem
// falhar), as iniciais continuam.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/fotoPerfil", () => ({
  fotoPublica: jest.fn((u) => (u && !u.startsWith("/uploads/") ? u : null)),
}));

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const db = require("../database/db");
const adminController = require("../controllers/adminController");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("GET /api/admin/jobs devolve o logo da empresa (sem os que sumiram do disco)", async () => {
  db.query.mockResolvedValue([[
    { id: 1, title: "A", company: "Azul", active: 1, total_candidaturas: 0, company_logo: "/api/fotos/2?v=1" },
    { id: 2, title: "B", company: "Verde", active: 1, total_candidaturas: 0, company_logo: "/uploads/logos/antigo.png" },
    { id: 3, title: "C", company: "Sem", active: 1, total_candidaturas: 0, company_logo: null },
  ]]);
  const res = { json: jest.fn() };
  await adminController.getJobs({}, res);
  expect(db.query.mock.calls[0][0]).toMatch(/p\.logo_url AS company_logo/);
  expect(res.json.mock.calls[0][0].map((j) => j.company_logo)).toEqual(["/api/fotos/2?v=1", null, null]);
});

test("a lista mostra o logo na coluna Empresa, com as iniciais como reserva", () => {
  const v = ler("views/admin-vagas.ejs");
  expect(v).toContain('data-foto="${escapeHtml(safeUrl(j.company_logo) || "")}"');
  expect(v).toContain('<script src="/js/foto-perfil.js"></script>');
});

test("o selo da página da vaga recebe o logo da empresa", async () => {
  const VIEWS = path.join(__dirname, "..", "views");
  const html = await ejs.renderFile(path.join(VIEWS, "admin-vaga.ejs"), {
    user: { type: "admin", name: "Admin" }, currentPage: "admin-vagas", voltar: "/admin/vagas", skills: [],
    job: { id: 1, title: "Vaga", company: "Lumin", company_logo: "/api/fotos/9?v=2", active: 1, level: "pleno", created_at: new Date(), expires_day: null },
  }, { views: [VIEWS] });
  expect(html).toContain('class="adj-logo-mark" data-foto="/api/fotos/9?v=2"');
  expect(html).toContain("/js/foto-perfil.js");
  expect(html).toMatch(/aria-hidden="true">L<\/span>/); // iniciais enquanto a foto não carrega
});

test("a rota da página da vaga busca o logo e filtra os que sumiram", () => {
  const s = ler("server.js");
  expect(s).toMatch(/p\.logo_url AS company_logo/);
  expect(s).toMatch(/rows\[0\]\.company_logo = require\("\.\/services\/fotoPerfil"\)\.fotoPublica\(rows\[0\]\.company_logo\)/);
});
