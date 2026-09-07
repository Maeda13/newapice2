// QA-023 — Parâmetro ?next= promete voltar à vaga após o login, mas é ignorado
// vaga-publica.ejs monta "Entrar para se candidatar" como
// /login?next=/vagas/${job.id}, mas login.ejs nunca lia ?next= e
// usersController.login() sempre redirecionava para /dashboard fixo.
// Corrigido: login.ejs reenvia `next` no corpo do POST; o controller usa
// como redirect quando é um path interno seguro (evita redirect aberto).
const fs = require('fs');
const path = require('path');

jest.mock('../../database/db', () => ({ query: jest.fn() }));
jest.mock('../../models/User', () => ({
  findByEmail: jest.fn(),
  findDevProfile: jest.fn().mockResolvedValue(null),
  findCompanyProfile: jest.fn().mockResolvedValue(null),
  findAdminProfile: jest.fn().mockResolvedValue(null),
}));
jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const User = require('../../models/User');
const usersController = require('../../controllers/usersController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('QA-023 — login.ejs reenvia o parâmetro next', () => {
  test('o body do fetch de login inclui next: params.get("next")', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', '..', 'views', 'login.ejs'), 'utf8');
    expect(content).toContain('body: JSON.stringify({ email, password: pass, next: params.get("next") })');
  });
});

describe('QA-023 — usersController.login() usa next como redirect quando é seguro', () => {
  const baseUser = { id: 1, email: 'dev@teste.com', password_hash: 'hash', type: 'dev', active: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
    User.findByEmail.mockResolvedValue(baseUser);
  });

  test('com next apontando pra um path interno, redireciona pra lá em vez do dashboard padrão', async () => {
    const req = { body: { email: 'dev@teste.com', password: '123456', next: '/vagas/42' }, session: {} };
    const res = mockRes();

    await usersController.login(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/vagas/42' }));
  });

  test('sem next, continua indo para o dashboard padrão do tipo de conta', async () => {
    const req = { body: { email: 'dev@teste.com', password: '123456' }, session: {} };
    const res = mockRes();

    await usersController.login(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/dashboard' }));
  });

  test('next apontando para fora do site é ignorado (não vira redirect aberto)', async () => {
    const req = { body: { email: 'dev@teste.com', password: '123456', next: 'https://evil.com/phish' }, session: {} };
    const res = mockRes();

    await usersController.login(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/dashboard' }));
  });

  test('next no formato "//evil.com" (protocol-relative) também é ignorado', async () => {
    const req = { body: { email: 'dev@teste.com', password: '123456', next: '//evil.com' }, session: {} };
    const res = mockRes();

    await usersController.login(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/dashboard' }));
  });
});
