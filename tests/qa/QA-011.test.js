// QA-011 — Logout aceito via GET
// `router.get("/logout", ...)` permitia que qualquer `<img src="/auth/logout">`
// em site de terceiros derrubasse a sessão do usuário (CSRF via GET). Trocado
// para POST, com os links "Sair" virando formulários com botão de submit.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const readFile = relPath => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('QA-011 — logout exige POST', () => {
  test('routes/auth.js registra /logout como POST, não GET', () => {
    const content = readFile('routes/auth.js');
    expect(content).toMatch(/router\.post\(\s*"\/logout"/);
    expect(content).not.toMatch(/router\.get\(\s*"\/logout"/);
  });

  const viewsWithLogout = [
    'views/partials/header-dev.ejs',
    'views/partials/header-company.ejs',
    'views/partials/header-admin.ejs',
    'views/perfil-dev.ejs',
    'views/perfil-empresa.ejs',
  ];

  test.each(viewsWithLogout)('%s não tem mais <a href="/auth/logout">', (file) => {
    const content = readFile(file);
    expect(content).not.toMatch(/<a\s+[^>]*href="\/auth\/logout"/);
  });

  test.each(viewsWithLogout)('%s envia o logout via <form method="POST">', (file) => {
    const content = readFile(file);
    expect(content).toMatch(/<form\s+method="POST"\s+action="\/auth\/logout">/);
  });
});
