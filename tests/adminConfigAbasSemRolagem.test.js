// Configurações → Categorias e vagas / Administração e segurança: a barra de abas
// não rola (a linha da aba ativa em bottom:-1px + overflow-x:auto criava uma barra
// de rolagem de 1px; no celular as 5 abas rolavam de lado). Agora as abas quebram linha.
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/admin-categorias.css'), 'utf8');
const regra = (sel) => {
  const i = css.indexOf(`${sel} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

test('barra de abas sem overflow de rolagem e com quebra de linha', () => {
  const tabs = regra('.adk-tabs');
  expect(tabs).not.toMatch(/overflow/);
  expect(tabs).toMatch(/flex-wrap: wrap/);
});
test('linha da aba ativa fica dentro da aba (não passa 1px para fora)', () => {
  expect(regra('.adk-tab[aria-selected="true"]::after')).toMatch(/bottom: 0/);
});
test('as duas páginas usam essa barra de abas', () => {
  for (const v of ['admin-configuracoes-categorias.ejs', 'admin-configuracoes-seguranca.ejs']) {
    expect(fs.readFileSync(path.join(__dirname, '..', 'views', v), 'utf8')).toMatch(/class="adk-tabs/);
  }
});
