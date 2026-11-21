// Admin: o anel de foco é amarelo (cor do admin), não o roxo do resto do site.
const fs = require('fs');
const path = require('path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('foco amarelo nas páginas de ADM', () => {
  test('temas.css troca a cor de foco pela do admin quando a página tem o header de admin', () => {
    const css = ler('public/css/temas.css');
    const regra = css.indexOf(':root:has(.site-header--admin) { --cor-foco: var(--admin); }');
    expect(regra).toBeGreaterThan(-1);
    // depois dos blocos de tema, para valer também no claro e no alto contraste (mesma especificidade)
    expect(regra).toBeGreaterThan(css.lastIndexOf(':root[data-tema="alto-contraste"] {'));
  });
  test('header de admin tem a classe usada no seletor', () => {
    expect(ler('views/partials/header-admin.ejs')).toContain('site-header--admin');
  });
  test('contornos de foco próprios do admin não usam mais o roxo', () => {
    expect(ler('public/css/admin-dashboard.css')).not.toMatch(/table-wrap\)\[tabindex\]:focus-visible \{[^}]*accent/);
    expect(ler('views/admin-configuracoes-catalogo.ejs')).not.toMatch(/\.catalog-back:focus-visible \{[^}]*accent/);
  });
});
