// QA-020 — As páginas mais importantes para SEO só existem depois de um
// fetch no navegador. vagas.ejs, vaga-publica.ejs e insights-mercado.ejs
// eram cascas vazias (skeletons/"Carregando...") no HTML inicial; todo o
// conteúdo (título, descrição, h1, lista de vagas, resumo de insights) só
// existia depois de um fetch no navegador — invisível a um crawler sem JS.
// Corrigido buscando os dados no servidor (server.js) e renderizando o
// essencial via EJS, mantendo o enriquecimento client-side pro resto.
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');

function render(view, locals) {
  const filePath = path.join(VIEWS_DIR, `${view}.ejs`);
  return ejs.render(fs.readFileSync(filePath, 'utf8'), locals, {
    views: [VIEWS_DIR],
    filename: filePath,
  });
}

describe('QA-020 — vaga-publica.ejs renderiza a vaga no servidor', () => {
  const job = { id: 42, title: 'Dev Backend Pleno', description: 'Descrição real da vaga.', company: 'Acme Corp' };

  test('com a vaga encontrada: título, h1, descrição e meta description vêm da vaga', () => {
    const html = render('vaga-publica', { jobId: 42, job, currentPage: 'vagas' });

    expect(html).toContain('<title>Dev Backend Pleno — Ápice</title>');
    expect(html).toContain('<h1 class="vaga-title">Dev Backend Pleno</h1>');
    expect(html).toContain('Descrição real da vaga.');
    expect(html).toMatch(/<meta name="description" content="Dev Backend Pleno na Acme Corp/);
  });

  test('com a vaga encontrada: #state-content já vem visível (sem hidden) e #state-loading vem hidden', () => {
    const html = render('vaga-publica', { jobId: 42, job, currentPage: 'vagas' });

    expect(html).toMatch(/<div id="state-content" >/);
    expect(html).toMatch(/id="state-loading"[^>]*hidden>/);
  });

  test('sem a vaga (não encontrada): título genérico e #state-loading continua visível', () => {
    const html = render('vaga-publica', { jobId: 999, job: null, currentPage: 'vagas' });

    expect(html).toContain('<title>Ápice — Vaga</title>');
    expect(html).toMatch(/<div id="state-content" hidden>/);
    expect(html).toMatch(/id="state-loading"[^>]*aria-live="polite" >/);
  });
});

describe('QA-020 — vagas.ejs renderiza a lista de vagas no servidor', () => {
  test('com vagas cadastradas: cards reais aparecem, sem skeletons', () => {
    const jobs = [{ id: 5, title: 'Frontend Júnior', company: 'Foo Ltda', level: 'junior', description: 'Vaga de frontend.' }];
    const html = render('vagas', { jobs, currentPage: 'vagas' });

    expect(html).toContain('<a href="/vagas/5" class="job-title">Frontend Júnior</a>');
    expect(html).toContain('Foo Ltda');
    expect(html).not.toContain('skeleton-card');
  });

  test('sem vagas: mantém os skeletons de carregamento', () => {
    const html = render('vagas', { jobs: [], currentPage: 'vagas' });
    expect(html).toContain('skeleton-card');
  });
});

describe('QA-020 — insights-mercado.ejs renderiza o resumo cacheado no servidor', () => {
  test('com insights cacheados: conteúdo visível de cara, sem "Carregando..."', () => {
    const insights = {
      resumo: 'Resumo de teste sobre tecnologias em alta.',
      gerado_em: '2024-01-15T00:00:00.000Z',
      tecnologias_top: [{ nome: 'Node.js', vagas: 3 }],
    };
    const html = render('insights-mercado', { insights, currentPage: 'insights-mercado' });

    expect(html).toContain('Resumo de teste sobre tecnologias em alta.');
    expect(html).toContain('Node.js');
    expect(html).toMatch(/<div id="state-content" >/);
    expect(html).toMatch(/id="state-loading" hidden>/);
  });

  test('sem insights cacheados: mantém o estado de carregamento', () => {
    const html = render('insights-mercado', { insights: null, currentPage: 'insights-mercado' });
    expect(html).toMatch(/<div id="state-loading" >/);
    expect(html).toMatch(/<div id="state-content" hidden>/);
  });
});
