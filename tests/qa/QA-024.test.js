// QA-024 — Item "Vagas" do menu não fica marcado como ativo
// <%- include('partials/header-dev') %> em vagas.ejs não passava
// { currentPage: 'vagas' }, diferente de todas as outras páginas dev —
// header-dev.ejs usa locals.currentPage pra marcar o item ativo do menu.
// Um dev logado em /vagas não via o item correspondente destacado.
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', 'vagas.ejs'),
  'utf8'
);

describe('QA-024 — vagas.ejs passa currentPage pro header-dev', () => {
  test('o include de header-dev passa { currentPage: \'vagas\' }', () => {
    expect(content).toContain("include('partials/header-dev', { currentPage: 'vagas' })");
  });
});
