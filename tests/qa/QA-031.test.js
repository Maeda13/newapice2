// QA-031 — Páginas de erro 404/500 carregam um CSS que não define os
// estilos que elas usam. Ambas usam `.btn-primary`, `.btn-ghost` e
// `var(--font-mono)`, mas só carregam design-system.css — que tem apenas
// tokens/reset, sem nenhuma dessas três definições. Corrigido definindo
// `.btn-primary`/`.btn-ghost` e `--font-mono` diretamente no `<style>`
// inline que essas páginas já têm, já que são páginas isoladas sem outro
// CSS de página carregado.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-031 — 404.ejs e 500.ejs definem os estilos que usam', () => {
  test.each(['404.ejs', '500.ejs'])('%s define .btn-primary no <style> inline', (file) => {
    const content = readView(file);
    expect(content).toMatch(/<style>[\s\S]*\.btn-primary\s*\{[\s\S]*\}[\s\S]*<\/style>/);
  });

  test.each(['404.ejs', '500.ejs'])('%s define .btn-ghost no <style> inline', (file) => {
    const content = readView(file);
    expect(content).toMatch(/<style>[\s\S]*\.btn-ghost\s*\{[\s\S]*\}[\s\S]*<\/style>/);
  });

  test.each(['404.ejs', '500.ejs'])('%s define a variável --font-mono usada por .error-code', (file) => {
    const content = readView(file);
    expect(content).toMatch(/--font-mono:\s*[^;]+;/);
  });
});
