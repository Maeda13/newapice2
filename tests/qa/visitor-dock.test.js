const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const ROOT = path.join(__dirname, '..', '..');

describe('Menu flutuante do visitante (mobile, igual ao de dev/empresa)', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(ROOT, 'views', 'partials', 'header.ejs'), {});
  });
  test('reusa a barra .bottom-nav--dev com os 3 links e nome acessível', () => {
    expect(html).toMatch(/<nav class="bottom-nav bottom-nav--dev[^"]*"[^>]*aria-label="[^"]+"/);
    for (const href of ['/para-devs', '/para-empresas', '/sobre']) {
      expect(html).toContain('class="bottom-nav-item" data-path="' + href + '"');
    }
  });
  test('ícones decorativos e sem links de conta dentro da barra', () => {
    expect(html.match(/<svg[^>]*aria-hidden="true"/g).length).toBeGreaterThanOrEqual(3);
    const start = html.indexOf('<nav class="bottom-nav');
    const nav = html.slice(start, html.indexOf('</nav>', start));
    expect(nav).not.toMatch(/\/login|\/cadastro/);
  });
  test('a barra só aparece no mobile (display:none acima de 860px)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public/css/header.css'), 'utf8');
    expect(css).toMatch(/\.bottom-nav\s*\{\s*display:\s*none/);
    expect(css).toMatch(/max-width:\s*860px\)\s*\{[^@]*\.bottom-nav\s*\{\s*display:\s*flex/);
  });
});
