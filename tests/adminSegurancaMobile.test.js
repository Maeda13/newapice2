// Configurações → Administração e segurança no celular: sem rolagem horizontal.
// As tabelas (acessos e histórico) tinham ~510px numa tela de 375px; agora, até 600px,
// cada linha vira um bloco com o nome da coluna (data-label) acima do valor, e os
// filtros de período quebram linha.
const fs = require('fs');
const path = require('path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const view = ler('views/admin-configuracoes-seguranca.ejs');
const css = ler('public/css/admin-seguranca.css');

test('células das duas tabelas levam o nome da coluna em data-label', () => {
  ['E-mail', 'Último acesso', 'Administrador', 'Ação realizada', 'Detalhes'].forEach(rotulo =>
    expect(view).toContain(`data-label="${rotulo}"`));
});

test('até 600px a tabela vira blocos empilhados, com o rótulo antes do valor', () => {
  const i = css.indexOf('@media (max-width: 600px)');
  expect(i).toBeGreaterThan(-1);
  const bloco = css.slice(i);
  expect(bloco).toMatch(/\.ads-table tr[^{]*\{[^}]*display: block/);
  expect(bloco).toMatch(/\[data-label\]::before \{[^}]*content: attr\(data-label\)/);
  expect(bloco).toMatch(/\.ads-table thead \{[^}]*clip/); // cabeçalho só para leitor de tela
});

test('filtros de período quebram linha', () => {
  expect(css).toMatch(/\.ads-chips \{[^}]*flex-wrap: wrap/);
});

test('no celular as abas quebram o texto em vez de cortar "Histórico de atividades"', () => {
  expect(css.slice(css.indexOf('@media (max-width: 600px)'))).toMatch(/\.ads-tabs \.adk-tab \{[^}]*white-space: normal/);
});
