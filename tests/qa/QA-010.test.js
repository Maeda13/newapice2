// QA-010 — Vários campos de vaga não são validados no servidor apesar de
// terem enum no banco. `contract_type`, `english_level`, `modality`,
// `salary_min`/`salary_max`, `years_experience` e `max_candidates` eram
// aceitos sem checagem de enum/faixa — o MySQL rejeitava enums inválidos
// com um 500 genérico em vez de um 400 de validação, e valores numéricos
// inválidos (negativos, salary_min > salary_max) eram salvos silenciosamente.
const express = require('express');
const request = require('supertest');
const { validateCreateJob, validateUpdateJob } = require('../../validators/job.validator');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/jobs', validateCreateJob, (req, res) => res.status(201).json({ ok: true }));
  app.patch('/jobs/:id', validateUpdateJob, (req, res) => res.json({ ok: true }));
  return app;
}

const VALID_BASE = { title: 'Estágio Backend', level: 'estagio' };

describe('QA-010 — validação server-side dos campos de vaga', () => {
  const app = buildApp();

  test('aceita um payload totalmente válido', async () => {
    const res = await request(app).post('/jobs').send({
      ...VALID_BASE,
      contract_type: 'clt',
      modality: 'remoto',
      english_level: 'avancado',
      salary_min: 2000,
      salary_max: 4000,
      years_experience: 2,
      max_candidates: 50,
    });
    expect(res.status).toBe(201);
  });

  test('rejeita contract_type fora do enum', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, contract_type: 'invalido' });
    expect(res.status).toBe(400);
    expect(res.body.fields.some(f => f.field === 'contract_type')).toBe(true);
  });

  test('rejeita modality fora do enum', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, modality: 'hibrido-remoto' });
    expect(res.status).toBe(400);
  });

  test('rejeita english_level fora do enum', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, english_level: 'nativo' });
    expect(res.status).toBe(400);
  });

  test('rejeita salary_min negativo', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, salary_min: -100 });
    expect(res.status).toBe(400);
  });

  test('rejeita salary_max menor que salary_min', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, salary_min: 5000, salary_max: 1000 });
    expect(res.status).toBe(400);
  });

  test('rejeita years_experience negativo', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, years_experience: -1 });
    expect(res.status).toBe(400);
  });

  test('rejeita max_candidates negativo', async () => {
    const res = await request(app).post('/jobs').send({ ...VALID_BASE, max_candidates: -5 });
    expect(res.status).toBe(400);
  });

  test('PATCH também valida os campos quando enviados', async () => {
    const res = await request(app).patch('/jobs/1').send({ contract_type: 'invalido' });
    expect(res.status).toBe(400);
  });

  test('PATCH aceita atualização parcial válida', async () => {
    const res = await request(app).patch('/jobs/1').send({ salary_min: 1000, salary_max: 3000 });
    expect(res.status).toBe(200);
  });
});
