// Barra inferior do ADM (tablet/celular): variante própria, com rótulos legíveis
// (axe color-contrast no tema escuro: 2,78:1 com rgba(255,255,255,.32)) e item ativo
// na cor do admin (amarelo), não no verde-água da barra das empresas.
const fs = require('fs');
const path = require('path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('header do admin usa a variante bottom-nav--admin', () => {
  expect(ler('views/partials/header-admin.ejs')).toContain('class="bottom-nav bottom-nav--company bottom-nav--admin"');
});
test('rótulos com cor de texto legível e ativo amarelo', () => {
  const css = ler('public/css/header.css');
  expect(css).toMatch(/\.bottom-nav--admin \.bottom-nav-item \{[^}]*color: var\(--muted\)/);
  expect(css).toMatch(/\.bottom-nav--admin \.bottom-nav-item\.is-active \{[^}]*background: var\(--admin-dim\);[^}]*color: var\(--admin\)/);
});
