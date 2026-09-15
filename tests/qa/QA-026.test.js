// QA-026 — dev.css anula o espaço reservado por header.css para a barra de
// navegação inferior. Os dois definiam `body { padding-bottom: ... }` dentro
// do mesmo `@media (max-width: 860px)`; dev.css era carregado depois em
// toda página e reduzia o valor pra `env(safe-area-inset-bottom, 0px)`,
// baseado na premissa desatualizada de que "páginas dev usam drawer, não
// bottom-nav" — header-dev.ejs/header-company.ejs renderizam a .bottom-nav.
// Corrigido removendo a regra de dev.css, deixando header.css como única
// fonte desse valor.
const fs = require('fs');
const path = require('path');

const devCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'dev.css'),
  'utf8'
);
const headerCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'header.css'),
  'utf8'
);

describe('QA-026 — dev.css não anula mais o padding-bottom reservado pelo bottom-nav', () => {
  test('dev.css não define mais body { padding-bottom: ... } dentro de @media (max-width: 860px)', () => {
    expect(devCss).not.toMatch(/body\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom/);
  });

  test('header.css continua reservando o espaço da .bottom-nav (calc(80px + ...))', () => {
    expect(headerCss).toMatch(/body\s*\{\s*padding-bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
  });
});
