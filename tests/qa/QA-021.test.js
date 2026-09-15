// QA-021 — Página de insights sem canonical, Open Graph ou Twitter Card
// insights-mercado.ejs é pública e indexável (robots: index, follow), mas
// não tinha <link rel="canonical">, og:* nem twitter:* — inconsistente com
// index.ejs/vagas.ejs/vaga-publica.ejs, que têm todas essas tags. Corrigido
// adicionando o mesmo bloco já usado em vagas.ejs, adaptado ao conteúdo.
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', 'insights-mercado.ejs'),
  'utf8'
);

describe('QA-021 — insights-mercado.ejs tem canonical, Open Graph e Twitter Card', () => {
  test('tem <link rel="canonical">', () => {
    expect(content).toMatch(/<link rel="canonical" href="[^"]+"/);
  });

  test('tem as tags Open Graph essenciais', () => {
    expect(content).toMatch(/<meta property="og:type"\s+content="website"/);
    expect(content).toMatch(/<meta property="og:title"\s+content="[^"]+"/);
    expect(content).toMatch(/<meta property="og:description"\s+content="[^"]+"/);
    expect(content).toMatch(/<meta property="og:url"\s+content="[^"]+"/);
  });

  test('tem as tags Twitter Card essenciais', () => {
    expect(content).toMatch(/<meta name="twitter:card"\s+content="[^"]+"/);
    expect(content).toMatch(/<meta name="twitter:title"\s+content="[^"]+"/);
    expect(content).toMatch(/<meta name="twitter:description"\s+content="[^"]+"/);
  });
});
