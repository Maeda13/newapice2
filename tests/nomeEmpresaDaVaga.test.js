// Vaga de empresa com nome fantasia vazio ('') saía sem nome de empresa
// (jobs.company = ''), e o Admin mostrava "—" na lista de vagas e nos rankings.
const fs = require('fs');
const path = require('path');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const empresaController = require('../controllers/empresaController');
const adminController = require('../controllers/adminController');

const chamar = async (handler, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ session: { user: { id: 5, type: 'empresa' } }, body, params: {} }, res);
  return res;
};
const fakeDb = (perfil) => jest.fn(async (sql) => {
  if (/user_subscriptions|subscriptions|annual_payments|COUNT\(\*\)/i.test(sql)) return [[{ total: 0 }]];
  if (/user_company_profiles/i.test(sql)) return [[perfil]];
  if (/insert into jobs/i.test(sql)) return [{ insertId: 1 }];
  return [[]];
});
const empresaGravada = () => db.query.mock.calls.find(([s]) => /insert into jobs/i.test(s))[1][1];

describe('nome da empresa gravado na vaga', () => {
  test('nome fantasia vazio usa a razão social', async () => {
    db.query = fakeDb({ nome_fantasia: '', razao_social: 'Aura LTDA' });
    expect((await chamar(empresaController.createJob, { title: 'Vaga', level: 'estagio' })).statusCode).toBe(201);
    expect(empresaGravada()).toBe('Aura LTDA');
  });
  test('nome fantasia só com espaços também cai na razão social', async () => {
    db.query = fakeDb({ nome_fantasia: '   ', razao_social: 'Aura LTDA' });
    await chamar(empresaController.createJob, { title: 'Vaga', level: 'estagio' });
    expect(empresaGravada()).toBe('Aura LTDA');
  });
  test('nome fantasia preenchido continua valendo', async () => {
    db.query = fakeDb({ nome_fantasia: 'Aura', razao_social: 'Aura LTDA' });
    await chamar(empresaController.createJob, { title: 'Vaga', level: 'estagio' });
    expect(empresaGravada()).toBe('Aura');
  });
});

describe('Admin lê o nome do perfil quando jobs.company está vazio', () => {
  const FALLBACK = /COALESCE\(NULLIF\(TRIM\(j\.company\), ''\), NULLIF\(TRIM\(p\.nome_fantasia\), ''\), p\.razao_social\) AS company/;
  test('GET /api/admin/jobs', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    await adminController.getJobs({}, { json() {}, status() { return this; } });
    expect(db.query.mock.calls[0][0]).toMatch(FALLBACK);
  });
  test.each([['services/relatorioDesempenho.js'], ['services/relatorioMatchs.js'], ['server.js']])('%s', (f) => {
    expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).toMatch(FALLBACK);
  });
});
