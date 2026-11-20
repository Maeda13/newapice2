// tests/loginChaveDoDev.test.js
// Os dados do dev (habilidades, progresso do roadmap, candidaturas, conversas,
// match) são gravados com a chave github_id ?? id da conta (getUserId nos
// controllers). O login com GitHub punha o github_id na sessão; o login por
// e-mail, não. Um dev com GitHub vinculado que entrava por e-mail lia e
// gravava tudo noutra chave: o que tinha salvo "sumia", e o que salvava
// sumia no próximo login com GitHub.
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../models/User", () => ({
  findByEmail: jest.fn(), findDevProfile: jest.fn(), findCompanyProfile: jest.fn(), findAdminProfile: jest.fn(),
}));
jest.mock("bcrypt", () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const User = require("../models/User");
const usersController = require("../controllers/usersController");

// a mesma conta que os controllers fazem para achar os dados do dev
const chaveDosDados = req => req.session.user.github_id ?? req.session.user.id;

async function entrarPorEmail(perfil) {
  User.findByEmail.mockResolvedValue({ id: 7, email: "ana@exemplo.com", type: "dev", password_hash: "hash", active: 1 });
  User.findDevProfile.mockResolvedValue(perfil);
  const req = { body: { email: "ana@exemplo.com", password: "senha-de-teste" }, session: {} };
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await usersController.login(req, res);
  expect(res.body).toMatchObject({ success: true });
  return req;
}

beforeEach(() => jest.clearAllMocks());

test("dev com GitHub vinculado que entra por e-mail usa a mesma chave do login com GitHub", async () => {
  const req = await entrarPorEmail({ nome: "Ana", sobrenome: "Lima", github_login: "ana-dev", github_id: 5551234, nivel: "junior", avatar_url: null });
  expect(req.session.user.github_id).toBe(5551234);
  expect(chaveDosDados(req)).toBe(5551234);
});

test("dev sem GitHub vinculado continua usando o id da conta", async () => {
  const req = await entrarPorEmail({ nome: "Bia", sobrenome: null, github_login: null, github_id: null, nivel: "iniciante", avatar_url: null });
  expect(req.session.user.github_id).toBeUndefined();
  expect(chaveDosDados(req)).toBe(7);
});
