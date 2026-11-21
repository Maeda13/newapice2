// Perfil do dev/empresa aberto pelo ranking de um relatório: "Voltar" retorna ao
// relatório (mesma regra do detalhe da vaga, services/voltarAdmin).
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const render = (view, locals) => ejs.renderFile(path.join(__dirname, '..', 'views', view),
  { user: { name: 'Admin', type: 'admin' }, userId: 7, ...locals });

describe.each([
  ['admin-usuario.ejs', '/admin/usuarios', 'admin-usuarios', '/admin/relatorios/compatibilidade-de-matchs'],
  ['admin-empresa.ejs', '/admin/empresas', 'admin-empresas', '/admin/relatorios/atividade-das-empresas'],
])('%s', (view, lista, pagina, relatorio) => {
  test('vindo do relatório: Voltar leva ao relatório e o menu marca Relatórios', async () => {
    const html = await render(view, { currentPage: 'admin-relatorios', voltar: relatorio });
    expect(html).toContain(`href="${relatorio}" class="adj-back"`);
    expect(html).toMatch(/href="\/admin\/relatorios"\s+class="header-link is-active"/);
  });
  test('sem origem: volta para a lista, como antes', async () => {
    const html = await render(view, { currentPage: pagina });
    expect(html).toContain(`href="${lista}" class="adj-back"`);
  });
});

describe('links dos rankings e rotas', () => {
  test('ranking de matchs: perfil do dev leva a origem', () => {
    expect(ler('views/admin-relatorio-matchs.ejs')).toContain('href="/admin/usuarios/${Number(m.dev_user_id)}?voltar=/admin/relatorios/compatibilidade-de-matchs"');
  });
  test('ranking de empresas: perfil da empresa leva a origem', () => {
    expect(ler('views/admin-relatorio-empresas.ejs')).toContain('href="/admin/empresas/${Number(e.id)}?voltar=/admin/relatorios/atividade-das-empresas"');
  });
  test('rotas validam a origem', () => {
    const s = ler('server.js');
    expect(s).toMatch(/voltarAdmin\(req\.query\.voltar, "\/admin\/usuarios"\)/);
    expect(s).toMatch(/voltarAdmin\(req\.query\.voltar, "\/admin\/empresas"\)/);
  });
});
