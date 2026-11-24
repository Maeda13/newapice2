// O aumentar/diminuir texto (data-texto em <html>) tem que valer em TODAS as páginas:
// (1) toda página tem o seletor (no cabeçalho ou flutuante) e o tema-head;
// (2) nenhum CSS fixa font-size em px (não escalaria); (3) o --u das páginas desktop
// é multiplicado por --texto-escala.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const views = fs.readdirSync(path.join(ROOT, 'views')).filter(f => f.endsWith('.ejs'));
const cssFiles = fs.readdirSync(path.join(ROOT, 'public', 'css')).filter(f => f.endsWith('.css'));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test.each(views)('%s tem tema-head e o seletor de tema/texto', (f) => {
  const s = read('views', f);
  expect(s).toMatch(/tema-head/);
  expect(s).toMatch(/seletor-tema|partials\/header/);
});

test.each(['404', '500', 'login', 'cadastro', 'esqueci-senha', 'redefinir-senha'])('%s usa o seletor flutuante', (f) => {
  expect(read('views', f + '.ejs')).toMatch(/seletor-tema', \{ idTema: 'pagina', flutuante: true \}/);
});

test('nenhum font-size em px nos CSS (px não escala com o texto)', () => {
  const ruins = cssFiles.filter(f => /font-size:\s*[0-9.]+px/.test(read('public', 'css', f)));
  expect(ruins).toEqual([]);
});

test('font-size baseado em --u também multiplica --texto-escala', () => {
  const ruins = cssFiles.filter(f => /font-size:\s*calc\([0-9.]+ \* var\(--u\)\)/.test(read('public', 'css', f)));
  expect(ruins).toEqual([]);
});

test('temas.css define --texto-escala para os 5 níveis', () => {
  const css = read('public', 'css', 'temas.css');
  for (const [n, v] of [[0, '.875'], [2, '1.125'], [3, '1.25'], [4, '1.5']]) {
    expect(css).toContain(`:root[data-texto="${n}"]`);
    expect(css).toContain(`--texto-escala: ${v}`);
  }
});
