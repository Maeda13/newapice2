// QA-020 — As páginas mais importantes para SEO só existem depois de um
// fetch no navegador. vagas.ejs, vaga-publica.ejs e insights-mercado.ejs
// eram cascas vazias (skeletons/"Carregando...") no HTML inicial; todo o
// conteúdo (título, descrição, h1, lista de vagas, resumo de insights) só
// existia depois de um fetch no navegador — invisível a um crawler sem JS.
// Corrigido buscando os dados no servidor (server.js) e renderizando o
// essencial via EJS, mantendo o enriquecimento client-side pro resto.
// Depois, vagas.ejs e vaga-publica.ejs foram refeitas e passaram a montar a
// página INTEIRA no servidor (services/vagasPublicas.js): não existe mais
// skeleton nem estado de carregamento. Os testes delas usam o serviço de
// verdade com um banco falso.
jest.mock('../../database/db', () => ({ query: jest.fn() }));
jest.mock('../../services/geminiClient', () => ({ askGeminiJSON: jest.fn() }));

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { listarVitrine, detalheDaVaga } = require('../../services/vagasPublicas');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');

function render(view, locals) {
  const filePath = path.join(VIEWS_DIR, `${view}.ejs`);
  return ejs.render(fs.readFileSync(filePath, 'utf8'), locals, {
    views: [VIEWS_DIR],
    filename: filePath,
  });
}

/** Banco falso com as tabelas que o serviço das vagas lê. */
function bancoFalso({ jobs = [], perfis = [], skills = [] } = {}) {
  return {
    query: async (sql, params) => {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (q.startsWith('select * from jobs where id = ?')) return [jobs.filter(j => j.id === params[0])];
      if (q.startsWith('select * from jobs')) return [jobs];
      if (q.includes('from user_company_profiles')) return [perfis];
      if (q.includes('from job_skills')) return [skills];
      return [[]];
    },
  };
}

describe('QA-020 — vaga-publica.ejs renderiza a vaga no servidor', () => {
  const job = {
    id: 42, company_id: 9, title: 'Dev Backend Pleno', description: 'Descrição real da vaga.',
    company: 'Acme Corp', level: 'pleno', active: 1,
  };
  const conn = bancoFalso({ jobs: [job] });
  const pagina = async (id) => {
    const dados = await detalheDaVaga(conn, id, undefined);
    return { dados, html: render('vaga-publica', { jobId: id, dados, viewer: 'visitante', origem: 'https://exemplo.com', currentPage: 'vagas' }) };
  };

  test('com a vaga encontrada: título, h1, descrição, meta description e canonical vêm da vaga', async () => {
    const { html } = await pagina(42);

    expect(html).toContain('<title>Dev Backend Pleno — Ápice</title>');
    expect(html).toContain('<h1 class="vaga-titulo" id="vaga-titulo">Dev Backend Pleno</h1>');
    expect(html).toContain('Descrição real da vaga.');
    expect(html).toMatch(/<meta name="description" content="Dev Backend Pleno na Acme Corp/);
    expect(html).toContain('<link rel="canonical" href="https://exemplo.com/vagas/42" />');
  });

  test('com a vaga encontrada: o conteúdo já vem pronto, sem estado de carregamento nem fetch da vaga', async () => {
    const { html } = await pagina(42);

    expect(html).toMatch(/<article class="vaga-artigo"/);
    expect(html).not.toMatch(/state-loading|Carregando/);
    expect(html).not.toContain('id="state-error"');
    // o único fetch da página é o POST da candidatura; a vaga não é buscada no navegador
    expect(html).not.toMatch(/fetch\(`\/api\/vagas\/\$\{[^}]+\}`/);
  });

  test('sem a vaga (não encontrada): título genérico, noindex e o estado de erro', async () => {
    const { dados, html } = await pagina(999);

    expect(dados).toBeNull();
    expect(html).toContain('<title>Ápice — Vaga</title>');
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toMatch(/<section[^>]*id="state-error"[^>]*>\s*<h1[^>]*>Vaga não encontrada<\/h1>/);
    expect(html).not.toContain('vaga-artigo');
  });
});

describe('QA-020 — vagas.ejs renderiza a lista de vagas no servidor', () => {
  test('com vagas cadastradas: cards reais aparecem, sem skeletons', async () => {
    const vagas = await listarVitrine(bancoFalso({
      jobs: [{ id: 5, company_id: 9, title: 'Frontend Júnior', company: 'Foo Ltda', level: 'junior', description: 'Vaga de frontend.', active: 1 }],
    }));
    const html = render('vagas', { vagas, viewer: 'visitante', currentPage: 'vagas' });

    expect(html).toContain('<h2 class="vagas-card__titulo" id="vaga-5-titulo">Frontend Júnior</h2>');
    expect(html).toContain('href="/vagas/5"');
    expect(html).toContain('Foo Ltda');
    expect(html).toMatch(/id="vagas-contador"[^>]*>1 vaga encontrada</);
    expect(html).not.toContain('skeleton');
  });

  test('sem vagas: mostra o aviso de lista vazia (não há skeleton: nada é carregado depois)', async () => {
    const vagas = await listarVitrine(bancoFalso());
    const html = render('vagas', { vagas, viewer: 'visitante', currentPage: 'vagas' });

    expect(html).toContain('Nenhuma vaga aberta no momento');
    expect(html).toMatch(/id="vagas-contador"[^>]*>0 vagas encontradas</);
    expect(html).not.toContain('id="vagas-grade"');
    expect(html).not.toContain('skeleton');
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
