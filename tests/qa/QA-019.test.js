// QA-019 — Estados de erro sem aria-live, quebrando a própria convenção do código
// #state-loading tinha role="status" aria-live="polite", mas #state-error não
// tinha nada — apesar de roadmap.ejs (mesmo padrão de dois estados) usar
// aria-live="assertive" no seu próprio estado de erro. #modal-error também
// não tinha role/aria-live, enquanto o toast do mesmo arquivo usa
// aria-live="polite" corretamente.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-019 — estados de erro anunciados a leitores de tela', () => {
  test('vaga-publica.ejs: #state-error tem aria-live="assertive"', () => {
    const content = readView('vaga-publica.ejs');
    const tag = content.match(/<div[^>]*id="state-error"[^>]*>/)[0];
    expect(tag).toMatch(/aria-live="assertive"/);
  });

  test('repositorios.ejs: #modal-error tem role="alert"', () => {
    const content = readView('repositorios.ejs');
    const tag = content.match(/<div[^>]*id="modal-error"[^>]*>/)[0];
    expect(tag).toMatch(/role="alert"/);
  });
});
