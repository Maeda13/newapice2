// QA-022 — Canonical/og:url fixos em "apice.dev" — domínio de produção não
// confirmável pelo repositório. Não verificável só pelo código; confirmado
// com o time que o domínio real de produção é
// https://newapice22.onrender.com — og:url, canonical e as duas URLs do
// JSON-LD em index.ejs foram atualizadas para refletir isso.
// vagas.ejs tem o mesmo hardcode de "apice.dev" (og:url/canonical), fora do
// campo "Arquivos" original do achado mas mesma causa raiz — corrigido junto
// a pedido do usuário.
const fs = require('fs');
const path = require('path');

const readView = name => fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', name),
  'utf8'
);

const indexContent = readView('index.ejs');
const vagasContent = readView('vagas.ejs');

describe('QA-022 — index.ejs aponta para o domínio real de produção', () => {
  test('não sobra nenhuma referência ao domínio antigo "apice.dev"', () => {
    expect(indexContent).not.toContain('apice.dev');
  });

  test('og:url e canonical usam o domínio de produção confirmado', () => {
    expect(indexContent).toContain('<meta property="og:url"         content="https://newapice22.onrender.com/" />');
    expect(indexContent).toContain('<link rel="canonical" href="https://newapice22.onrender.com/" />');
  });

  test('as duas URLs do JSON-LD (WebApplication) usam o domínio de produção', () => {
    expect(indexContent).toContain('"url": "https://newapice22.onrender.com",');
    expect(indexContent).toContain('"url": "https://newapice22.onrender.com"');
  });
});

describe('QA-022 — vagas.ejs aponta para o domínio real de produção', () => {
  test('não sobra nenhuma referência ao domínio antigo "apice.dev"', () => {
    expect(vagasContent).not.toContain('apice.dev');
  });

  test('og:url e canonical usam o domínio de produção confirmado', () => {
    expect(vagasContent).toContain('<meta property="og:url"         content="https://newapice22.onrender.com/vagas" />');
    expect(vagasContent).toContain('<link rel="canonical" href="https://newapice22.onrender.com/vagas" />');
  });
});
