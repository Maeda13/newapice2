// QA-002 — Mesmo padrão de XSS atinge páginas públicas e o cruzamento dev ↔ empresa
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-002 — páginas públicas e dev↔empresa escapam campos vulneráveis', () => {
  const cases = [
    {
      file: 'dashboard.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(job.title)', 'escapeHtml(job.company'],
    },
    {
      file: 'progresso.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(r.title)', 'escapeHtml(r.company'],
    },
    {
      file: 'empresa-desenvolvedores.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(dev.name)', 'escapeHtml(initials(dev.name))'],
    },
    {
      file: 'empresa-matchs.ejs',
      needsScriptTag: true,
      // Página refeita (cartões sem avatar de iniciais): nome do dev, título da vaga em cartões e grupos.
      mustContain: ['escapeHtml(m.dev)', 'escapeHtml(m.job)', 'escapeHtml(v.title)'],
    },
    {
      file: 'perfil-dev-empresa.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(dev.best_job)', 'escapeHtml(r.job_title)'],
    },
    {
      // já tinha escapeHtml() local — só faltava aplicar em alguns campos
      file: 'mensagens.ejs',
      needsScriptTag: false,
      mustContain: [
        'escapeHtml(c.company_name', 'escapeHtml(j.title)', 'escapeHtml(j.company',
        'escapeHtml(data.name)', 'escapeHtml(nomeDaEmpresa(activeConversation.company_name',
      ],
    },
    {
      file: 'empresa-mensagens.ejs',
      needsScriptTag: false,
      mustContain: [
        'escapeHtml(c.dev_name', 'escapeHtml(data.name)',
        'escapeHtml(activeConversation.dev_name',
      ],
    },
  ];

  test.each(cases.filter(c => c.needsScriptTag))('$file carrega /js/escape-html.js', ({ file }) => {
    expect(readView(file)).toMatch(/<script src="\/js\/escape-html\.js"><\/script>/);
  });

  test.each(cases)('$file escapa os campos vulneráveis', ({ file, mustContain }) => {
    const content = readView(file);
    for (const snippet of mustContain) {
      expect(content).toContain(snippet);
    }
  });
});

// vagas.ejs e vaga-publica.ejs agora montam tudo no servidor (EJS com <%= %>, que
// escapa) e o JS delas não monta HTML com dados. O teste renderiza as duas
// páginas pelo serviço de verdade com texto malicioso em todos os campos do banco.
jest.mock('../../database/db', () => ({ query: jest.fn() }));
jest.mock('../../services/geminiClient', () => ({ askGeminiJSON: jest.fn() }));

describe('QA-002 — vagas e vaga pública: o que vem do banco sai escapado no HTML do servidor', () => {
  const ejs = require('ejs');
  const { listarVitrine, detalheDaVaga } = require('../../services/vagasPublicas');
  const MAU = '<img src=x onerror=alert(1)>';
  const job = {
    id: 7, company_id: 3, company: MAU, title: MAU, short_title: MAU, summary: MAU, description: MAU,
    level: 'estagio', modality: 'hibrido', location: MAU, tags: MAU, area: 'back-end', active: 1,
    salary_min: 1000, salary_max: 2000, english_level: 'basico', responsibilities: `${MAU}: ${MAU}`, benefits: MAU,
    created_at: new Date('2026-10-15T12:00:00'), expires_at: new Date('2026-12-14T00:00:00'),
  };
  const conn = { query: async (sql) => {
    const q = sql.replace(/\s+/g, ' ').toLowerCase();
    if (q.includes('from jobs')) return [[job]];
    if (q.includes('from user_company_profiles')) return [[{ user_id: 3, nome_fantasia: MAU, logo_url: null }]];
    if (q.includes('from job_skills')) return [[{ job_id: 7, skill_id: 1, name: MAU }]];
    return [[]];
  } };
  const render = (view, locals) => ejs.renderFile(path.join(VIEWS_DIR, view), locals, { views: [VIEWS_DIR] });
  const semTagCrua = (html) => {
    expect(html).not.toContain(MAU);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  };

  test('vagas.ejs (cards, filtros e dados para a busca)', async () => {
    const vagas = await listarVitrine(conn);
    semTagCrua(await render('vagas.ejs', { vagas, viewer: 'visitante', currentPage: 'vagas' }));
  });

  test('vaga-publica.ejs (cabeçalho, chips, textos, dados e o JSON-LD)', async () => {
    const dados = await detalheDaVaga(conn, 7, undefined);
    const html = await render('vaga-publica.ejs', { jobId: 7, dados, viewer: 'visitante', origem: 'https://exemplo.com', currentPage: 'vagas' });
    semTagCrua(html);
    // no JSON-LD (que vai com <%- %>), o "<" sai como < e não fecha o <script>
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    expect(ld).not.toMatch(/</);
    expect(JSON.parse(ld).title).toBe(MAU);
  });

  test('o JS das duas páginas não monta HTML com dados (nada de innerHTML/outerHTML)', () => {
    for (const v of ['vagas.ejs', 'vaga-publica.ejs']) expect(readView(v)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});
