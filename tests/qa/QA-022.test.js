// QA-022 — Canonical/og:url fixos em "apice.dev" — domínio de produção não
// confirmável pelo repositório. Não verificável só pelo código; confirmado
// com o time que o domínio real de produção é
// https://newapice22.onrender.com — og:url, canonical e as duas URLs do
// JSON-LD em index.ejs foram atualizadas para refletir isso.
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', 'index.ejs'),
  'utf8'
);

describe('QA-022 — index.ejs aponta para o domínio real de produção', () => {
  test('não sobra nenhuma referência ao domínio antigo "apice.dev"', () => {
    expect(content).not.toContain('apice.dev');
  });

  test('og:url e canonical usam o domínio de produção confirmado', () => {
    expect(content).toContain('<meta property="og:url"         content="https://newapice22.onrender.com/" />');
    expect(content).toContain('<link rel="canonical" href="https://newapice22.onrender.com/" />');
  });

  test('as duas URLs do JSON-LD (WebApplication) usam o domínio de produção', () => {
    expect(content).toContain('"url": "https://newapice22.onrender.com",');
    expect(content).toContain('"url": "https://newapice22.onrender.com"');
  });
});
