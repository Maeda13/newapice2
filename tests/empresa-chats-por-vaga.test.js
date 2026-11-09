// Chats por vaga (empresa): botão "Chats de vagas" em /empresa/mensagens,
// página /empresa/mensagens/vagas com as vagas ativas e a contagem de
// conversas de cada uma, e filtro ?vaga=ID na página de mensagens.
// Também cobre o cabeçalho novo da empresa (CTA "Criar vaga", Candidatos,
// Mensagens).
jest.mock('../database/db', () => ({ query: jest.fn() }));

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const empresaController = require('../controllers/empresaController');

const ROOT = path.join(__dirname, '..');
const VIEWS_DIR = path.join(ROOT, 'views');

function render(view, locals = {}) {
  const filePath = path.join(VIEWS_DIR, `${view}.ejs`);
  return ejs.render(fs.readFileSync(filePath, 'utf8'), locals, {
    views: [VIEWS_DIR],
    filename: filePath,
  });
}
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('GET /api/empresa/jobs/chats — getJobChats', () => {
  beforeEach(() => db.query.mockReset());

  test('lista só vagas ativas da própria empresa e conta conversas dela', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 7, title: 'Estágio Dev Software', active: 1, created_at: '2026-10-20T10:00:00Z', total_conversas: '3' },
    ]]);
    const res = mockRes();

    await empresaController.getJobChats({ session: { user: { id: 55 } } }, res);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/j\.company_id = \?/);
    expect(sql).toMatch(/j\.active = 1/);
    expect(sql).toMatch(/FROM conversations c/);
    expect(params).toEqual([55]);
    expect(res.json).toHaveBeenCalledWith([
      { id: 7, title: 'Estágio Dev Software', active: true, created_at: '2026-10-20T10:00:00Z', total_conversas: 3 },
    ]);
  });

  test('erro de banco devolve 500 sem vazar a mensagem', async () => {
    db.query.mockRejectedValueOnce(new Error('boom'));
    const res = mockRes();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await empresaController.getJobChats({ session: { user: { id: 55 } } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/boom/);
    console.error.mockRestore();
  });
});

describe('rotas', () => {
  test('/api/empresa/jobs/chats exige conta de empresa', () => {
    expect(read('routes/empresa.js')).toMatch(/router\.get\("\/jobs\/chats",\s+isEmpresa, empresaController\.getJobChats\)/);
  });

  test('/empresa/mensagens/vagas exige conta de empresa e renderiza a view nova', () => {
    expect(read('server.js')).toMatch(
      /app\.get\("\/empresa\/mensagens\/vagas", requireCompany[\s\S]*?res\.render\("empresa-mensagens-vagas"/
    );
  });
});

describe('páginas', () => {
  test('empresa-mensagens tem o botão "Chats de vagas" acima da lista, apontando pra página nova', () => {
    const html = render('empresa-mensagens', { currentPage: 'empresa-mensagens' });

    expect(html).toMatch(/<a href="\/empresa\/mensagens\/vagas" class="msg-vagas-btn">Chats de vagas<\/a>/);
    expect(html.indexOf('msg-vagas-btn')).toBeLessThan(html.indexOf('id="convList"'));
  });

  test('empresa-mensagens filtra por ?vaga=ID usando job_id da conversa', () => {
    const src = read('views/empresa-mensagens.ejs');

    expect(src).toMatch(/new URLSearchParams\(location\.search\)\.get\("vaga"\)/);
    expect(src).toMatch(/c\.job_id !== vagaFilterId/);
  });

  test('empresa-mensagens-vagas: busca, h1, estado vazio como irmão da lista e link ?vaga=', () => {
    const html = render('empresa-mensagens-vagas', { currentPage: 'empresa-mensagens' });

    expect(html).toMatch(/<h1 class="chatv-pill">Chat<\/h1>/);
    expect(html).toMatch(/id="vagaSearch"[^>]*aria-label="Pesquisar vagas para chat"/);
    expect(html).toMatch(/<\/ul>\s*<p class="chatv-empty" id="vagaEmpty" role="status" hidden>/);
    expect(html).toContain('/empresa/mensagens?vaga=${encodeURIComponent(j.id)}');
    expect(html).toContain('Acessar chats');
  });

  test('empresa-mensagens-vagas escapa o título da vaga e usa /api/empresa/jobs/chats', () => {
    const html = render('empresa-mensagens-vagas', { currentPage: 'empresa-mensagens' });

    expect(html).toContain('<h2>${escapeHtml(j.title)}</h2>');
    expect(html).toContain('/api/empresa/jobs/chats');
    expect(html).toContain('<script src="/js/escape-html.js"></script>');
  });
});

describe('cabeçalho da empresa', () => {
  const html = render('partials/header-company', {
    currentPage: 'empresa-mensagens',
    user: { company: 'Tech Solutions', name: 'Tech Solutions' },
  });

  test('menu: Dashboard, Vagas, Candidatos e Mensagens', () => {
    for (const label of ['Dashboard', 'Vagas', 'Candidatos', 'Mensagens']) {
      expect(html).toMatch(new RegExp(`class="header-link[^"]*"[\\s\\S]*?>\\s*${label}\\b`));
    }
  });

  test('Mensagens marcado como página atual', () => {
    expect(html).toMatch(/href="\/empresa\/mensagens"\s+class="header-link is-active"\s+aria-current="page"/);
  });

  test('CTA "Criar vaga" leva a /empresa/vagas/nova', () => {
    expect(html).toMatch(/<a href="\/empresa\/vagas\/nova" class="header-cta-vaga">[\s\S]*?Criar vaga/);
  });

  test('bloco da empresa mostra o nome e o rótulo "Empresa"', () => {
    expect(html).toMatch(/<strong>Tech Solutions<\/strong>\s*<small>Empresa<\/small>/);
  });

  test('Matchs continua acessível pelo menu do usuário', () => {
    expect(html).toMatch(/role="menuitem" href="\/empresa\/matchs"/);
  });
});
