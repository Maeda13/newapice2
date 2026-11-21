// Admin → perfil do dev/empresa: o card de plano mostra o ciclo real (mensal, anual
// ou liberado pelo admin) e a data certa, em vez de "plano mensal" para todo PRO.
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');

const app = express();
app.get('/users/:id', adminController.getUserDetail);
app.get('/empresas/:id', adminController.getEmpresaDetail);

const dev = [{ id: 7, email: 'a@b.com', active: 1, created_at: '2026-02-13', tem_senha: 1, visto_ha_segundos: 60,
  nome: 'Igor', sobrenome: 'G', nivel: 'junior', github_login: null, github_id: null, avatar_url: null }];
const mockDev = (cobranca) => {
  db.query = jest.fn()
    .mockResolvedValueOnce([dev])              // usuário
    .mockResolvedValueOnce([[]])               // skills
    .mockResolvedValueOnce([[]])               // declarações
    .mockResolvedValueOnce([[]])               // repositórios
    .mockResolvedValueOnce([[{ plan_code: 'dev_pro' }]]) // plano atual
    .mockResolvedValueOnce([cobranca])         // origem do plano
    .mockResolvedValue([[]]);
};

describe('ciclo do plano no perfil (admin)', () => {
  test('plano anual: ciclo anual e válido até, sem "próxima cobrança"', async () => {
    mockDev([{ ciclo: 'anual', status: 'approved', proxima: null, ate: '2027-05-01' }]);
    const r = await request(app).get('/users/7');
    expect(r.body.plan).toMatchObject({ code: 'dev_pro', ciclo: 'anual', next_payment_date: null, valido_ate: '2027-05-01' });
  });
  test('mensal ativa: próxima cobrança', async () => {
    mockDev([{ ciclo: 'mensal', status: 'authorized', proxima: '2026-12-10', ate: null }]);
    const r = await request(app).get('/users/7');
    expect(r.body.plan).toMatchObject({ ciclo: 'mensal', next_payment_date: '2026-12-10', valido_ate: null });
  });
  test('mensal cancelada mas paga: acesso até, sem próxima cobrança', async () => {
    mockDev([{ ciclo: 'mensal', status: 'cancelled', proxima: '2026-12-10', ate: '2026-12-01' }]);
    const r = await request(app).get('/users/7');
    expect(r.body.plan).toMatchObject({ ciclo: 'mensal', next_payment_date: null, valido_ate: '2026-12-01' });
  });
  test('liberado pelo admin: ciclo manual', async () => {
    mockDev([{ ciclo: 'manual', status: 'active', proxima: null, ate: null }]);
    const r = await request(app).get('/users/7');
    expect(r.body.plan).toMatchObject({ ciclo: 'manual', next_payment_date: null, valido_ate: null });
  });
  test('plano gratuito: não consulta cobrança', async () => {
    db.query = jest.fn().mockResolvedValueOnce([dev]).mockResolvedValue([[]]);
    const r = await request(app).get('/users/7');
    expect(r.body.plan).toMatchObject({ code: 'dev_free', ciclo: 'gratuito' });
  });
  test('empresa PRO anual', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 5, email: 'rh@x.com', active: 1, created_at: '2026-02-13', razao_social: 'X', nome_fantasia: 'X' }]])
      .mockResolvedValueOnce([[]])                                        // vagas
      .mockResolvedValueOnce([[{ plan_code: 'empresa_premium' }]])        // plano atual
      .mockResolvedValueOnce([[{ ciclo: 'anual', status: 'approved', proxima: null, ate: '2027-01-02' }]])
      .mockResolvedValue([[]]);
    const r = await request(app).get('/empresas/5');
    expect(r.body.plan).toMatchObject({ code: 'empresa_premium', ciclo: 'anual', valido_ate: '2027-01-02' });
  });
  test.each(['admin-usuario.ejs', 'admin-empresa.ejs'])('%s não fixa "plano mensal" para todo plano pago', (f) => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'views', f), 'utf8');
    expect(s).not.toMatch(/=== "(dev_pro|empresa_premium)" \? "plano mensal"/);
    expect(s).toContain('CICLO_LABEL[p.ciclo]');
    expect(s).toContain('valido_ate');
  });
});
