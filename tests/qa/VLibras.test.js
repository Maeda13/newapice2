// VLibras — widget de tradução para Libras em todas as páginas.
// O parcial views/partials/vlibras.ejs traz o markup oficial e é incluído ao
// fim do <body> de todas as páginas; a CSP em server.js libera apenas os
// domínios que o widget usa (vlibras.gov.br e o jsDelivr, para onde o
// vlibras.gov.br redireciona os assets), diretiva por diretiva.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..', '..');
const VIEWS_DIR = path.join(ROOT, 'views');
const serverContent = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Todas as views de página (tudo em views/ exceto partials/), inclusive as
// de subpastas (ex.: roadmap/). Uma view nova sem o widget falha este teste.
const listViews = (dir, prefix = '') =>
  fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) return entry.name === 'partials' ? [] : listViews(dir, rel);
    return entry.name.endsWith('.ejs') ? [rel] : [];
  });
const PAGES = listViews(VIEWS_DIR);

const directive = name => {
  const m = serverContent.match(new RegExp(name + ':\\s*\\[([^\\]]*)\\]'));
  return m ? m[1] : null;
};

describe('VLibras — parcial', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(VIEWS_DIR, 'partials', 'vlibras.ejs'), {});
  });

  test('traz o markup oficial (vw, botão de acesso e wrapper do plugin)', () => {
    expect(html).toMatch(/<div vw class="enabled">/);
    expect(html).toMatch(/vw-access-button/);
    expect(html).toMatch(/vw-plugin-wrapper/);
  });

  test('carrega o plugin de vlibras.gov.br e inicializa o Widget', () => {
    expect(html).toMatch(/src="https:\/\/vlibras\.gov\.br\/app\/vlibras-plugin\.js"/);
    expect(html).toMatch(/new window\.VLibras\.Widget\("https:\/\/vlibras\.gov\.br\/app"\)/);
  });

  test('não quebra a página se o script externo falhar (checa window.VLibras)', () => {
    expect(html).toMatch(/window\.VLibras && window\.VLibras\.Widget/);
  });
});

describe('VLibras — todas as views incluem o parcial', () => {
  test.each(PAGES)('%s inclui o parcial vlibras antes de </body>', (file) => {
    const content = fs.readFileSync(path.join(VIEWS_DIR, file), 'utf8');
    // views em subpasta precisam do caminho relativo correto (../partials/...)
    const prefix = path.dirname(file) === '.' ? '' : '../'.repeat(path.dirname(file).split(path.sep).length);
    const include = `include('${prefix}partials/vlibras')`;
    expect(content.split(include).length - 1).toBe(1);
    expect(content.indexOf(include)).toBeLessThan(content.lastIndexOf('</body>'));
    expect(fs.existsSync(path.join(VIEWS_DIR, path.dirname(file), prefix, 'partials', 'vlibras.ejs'))).toBe(true);
  });
});

describe('VLibras — CSP em server.js', () => {
  test.each([
    ['scriptSrc', ['https://vlibras.gov.br', 'https://cdn.jsdelivr.net']],
    ['imgSrc',    ['https://vlibras.gov.br', 'https://cdn.jsdelivr.net']],
    ['fontSrc',   ['https://vlibras.gov.br', 'https://cdn.jsdelivr.net']],
    ['connectSrc', ['https://vlibras.gov.br']],
    ['frameSrc',  ['https://vlibras.gov.br']],
  ])('%s libera os domínios do widget', (name, domains) => {
    const d = directive(name);
    expect(d).not.toBeNull();
    domains.forEach(domain => expect(d).toContain(domain));
  });

  test("frameSrc continua permitindo 'self'", () => {
    expect(directive('frameSrc')).toMatch(/'self'/);
  });

  test('não afrouxa além do necessário (sem curinga nem https: genérico)', () => {
    ['scriptSrc', 'imgSrc', 'fontSrc', 'connectSrc', 'frameSrc'].forEach(name => {
      const d = directive(name);
      expect(d).not.toMatch(/'\*'|"\*"|\bhttps:["']|\*\./);
    });
  });

  test("script-src não ganha 'unsafe-eval'", () => {
    expect(directive('scriptSrc')).not.toMatch(/unsafe-eval/);
  });
});
