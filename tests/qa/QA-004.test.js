// QA-004 — Token OAuth do GitHub fica disponível para qualquer template por padrão
// O middleware global `res.locals.user = req.session?.user ?? null;` expunha o
// objeto de sessão inteiro, incluindo `accessToken` do GitHub, para todo
// template EJS renderizado.
const { exposeUser } = require('../../middlewares/auth');

function mockRes() {
  return { locals: {} };
}

describe('QA-004 — middleware exposeUser não vaza accessToken para res.locals.user', () => {
  test('remove accessToken mas mantém os demais campos do usuário', () => {
    const req = {
      session: {
        user: {
          id: 1,
          name: 'Dev Teste',
          type: 'dev',
          accessToken: 'gho_supersecreto123',
        },
      },
    };
    const res = mockRes();
    const next = jest.fn();

    exposeUser(req, res, next);

    expect(res.locals.user).not.toHaveProperty('accessToken');
    expect(res.locals.user).toMatchObject({ id: 1, name: 'Dev Teste', type: 'dev' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('define res.locals.user como null quando não há sessão', () => {
    const req = { session: null };
    const res = mockRes();
    const next = jest.fn();

    exposeUser(req, res, next);

    expect(res.locals.user).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
