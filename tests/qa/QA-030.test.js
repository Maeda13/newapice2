// QA-030 — Seis parciais e dois arquivos CSS/JS nunca são usados — e têm
// bugs próprios. `partials/navbar-*.ejs`, `partials/sidebar-*.ejs`,
// `partials/topbar.ejs`, `navbar.css`, `sidebar.css`, `sidebar.js` eram um
// segundo sistema de navegação completo, substituído pelo header horizontal
// atual (header.ejs/header-dev.ejs etc.) mas nunca removido — confirmado que
// nenhum arquivo `.ejs` chamava `include(...)` para eles, e nenhuma view
// carregava os dois arquivos CSS/JS associados. Removidos com confirmação
// do usuário (o próprio achado pede essa confirmação antes de excluir).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const removedFiles = [
  'views/partials/navbar-company.ejs',
  'views/partials/navbar-dev.ejs',
  'views/partials/navbar-public.ejs',
  'views/partials/sidebar-company.ejs',
  'views/partials/sidebar-dev.ejs',
  'views/partials/topbar.ejs',
  'public/css/navbar.css',
  'public/css/sidebar.css',
  'public/js/sidebar.js',
];

describe('QA-030 — parciais e CSS/JS de navegação mortos foram removidos', () => {
  test.each(removedFiles)('%s não existe mais', (relPath) => {
    expect(fs.existsSync(path.join(ROOT, relPath))).toBe(false);
  });

  test('nenhuma view referencia os arquivos removidos', () => {
    const viewsDir = path.join(ROOT, 'views');
    const allEjs = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ejs')) allEjs.push(full);
      }
    })(viewsDir);

    const needles = [
      'navbar-company', 'navbar-dev', 'navbar-public',
      'sidebar-company', 'sidebar-dev', 'topbar',
      'navbar.css', 'sidebar.css', 'sidebar.js',
    ];

    for (const file of allEjs) {
      const content = fs.readFileSync(file, 'utf8');
      for (const needle of needles) {
        expect(content).not.toContain(needle);
      }
    }
  });
});
