// QA-009 — Link de reset de senha usa o header Host da requisição
// `forgotPassword()` montava o link com `${req.protocol}://${req.get("host")}`.
// Se o proxy reverso repassar um header Host não confiável, o link enviado
// por e-mail apontaria para um domínio controlado por um atacante.
jest.mock('../../database/db', () => ({
  query: jest.fn().mockResolvedValue([{ insertId: 1 }]),
}));
jest.mock('../../models/User', () => ({
  findByEmail: jest.fn(),
}));
jest.mock('../../services/emailService', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const User = require('../../models/User');
const { sendPasswordResetEmail } = require('../../services/emailService');
const usersController = require('../../controllers/usersController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('QA-009 — link de reset de senha não confia no header Host', () => {
  const OLD_APP_URL = process.env.APP_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_URL = 'https://apice.dev';
  });

  afterAll(() => {
    process.env.APP_URL = OLD_APP_URL;
  });

  test('usa APP_URL para montar o link, ignorando um Host forjado', async () => {
    User.findByEmail.mockResolvedValue({ id: 1, email: 'dev@teste.com', password_hash: 'hash' });

    const req = {
      body: { email: 'dev@teste.com' },
      protocol: 'https',
      get: jest.fn().mockReturnValue('atacante.com'),
    };
    const res = mockRes();

    await usersController.forgotPassword(req, res);

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [, resetUrl] = sendPasswordResetEmail.mock.calls[0];
    expect(resetUrl.startsWith('https://apice.dev/redefinir-senha?token=')).toBe(true);
    expect(resetUrl).not.toContain('atacante.com');
  });
});
