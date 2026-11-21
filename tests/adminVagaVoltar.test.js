// Admin → detalhe da vaga aberto a partir de um relatório: "Voltar" retorna ao
// relatório, não à lista de vagas. O destino vem de ?voltar= e só aceita caminhos
// internos do admin (sem redirecionamento aberto).
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { voltarAdmin } = require('../services/voltarAdmin');

const job = { id: 7, title: 'Vaga', company: 'X', level: 'junior', active: 1, created_at: '2026-10-15', total_candidaturas: 0 };
const render = (locals) => ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-vaga.ejs'),
  { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-vagas', job, skills: [], ...locals });

describe('voltarAdmin', () => {
  test.each([
    ['/admin/relatorios/desempenho-das-vagas', '/admin/relatorios/desempenho-das-vagas'],
    ['/admin/relatorios/compatibilidade-de-matchs', '/admin/relatorios/compatibilidade-de-matchs'],
    [undefined, '/admin/vagas'], ['', '/admin/vagas'],
    ['https://evil.com', '/admin/vagas'], ['//evil.com/admin/x', '/admin/vagas'], ['/admin//evil.com', '/admin/vagas'],
    ['/admin/x"><script>', '/admin/vagas'], ['/vagas', '/admin/vagas'], [['/admin/a', '/admin/b'], '/admin/vagas'],
  ])('%j → %s', (v, esperado) => expect(voltarAdmin(v, '/admin/vagas')).toBe(esperado));
});

describe('detalhe da vaga', () => {
  test('vindo de um relatório: os dois "voltar" levam ao relatório', async () => {
    const html = await render({ voltar: '/admin/relatorios/desempenho-das-vagas', currentPage: 'admin-relatorios' });
    expect(html).toContain('href="/admin/relatorios/desempenho-das-vagas" class="adj-back"');
    expect(html).toContain('href="/admin/relatorios/desempenho-das-vagas">Voltar ao relatório</a>');
    expect(html).not.toContain('Voltar para a lista');
  });
  test('sem origem: continua voltando para a lista de vagas', async () => {
    const html = await render({});
    expect(html).toContain('href="/admin/vagas" class="adj-back"');
    expect(html).toContain('Voltar para a lista');
  });
  test.each([['admin-relatorio-desempenho.ejs', 'desempenho-das-vagas'], ['admin-relatorio-matchs.ejs', 'compatibilidade-de-matchs']])(
    '%s: o link da vaga leva a origem', (f, slug) => {
      const s = fs.readFileSync(path.join(__dirname, '..', 'views', f), 'utf8');
      expect(s).toContain(`?voltar=/admin/relatorios/${slug}`);
    });
  test('rota passa a origem validada para a página', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(s).toMatch(/voltarAdmin\(req\.query\.voltar, "\/admin\/vagas"\)/);
  });
});
