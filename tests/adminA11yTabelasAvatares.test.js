// Admin: tabelas com rolagem horizontal alcançáveis pelo teclado e iniciais do
// avatar de empresa legíveis em todo tema (axe: scrollable-region-focusable,
// color-contrast, landmark-unique).
const fs = require('fs');
const path = require('path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const paginas = ['admin-dashboard', 'admin-relatorio-crescimento', 'admin-relatorio-desempenho', 'admin-relatorio-empresas',
  'admin-relatorio-matchs', 'admin-relatorio-planos', 'admin-relatorio-uso'];

describe('tabelas roláveis do admin', () => {
  test.each(paginas)('%s: todo wrapper de tabela é focável e tem nome próprio', (p) => {
    const s = ler(`views/${p}.ejs`);
    const wraps = [...s.matchAll(/<div class="ad[mc]-table-wrap"[^>]*>/g)].map(m => m[0]);
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) {
      expect(w).toContain('tabindex="0"');
      expect(w).toContain('role="region"');
      expect(w).toMatch(/aria-label="[^"]+ \(tabela\)"/); // nome diferente do título da seção (landmark-unique)
    }
    const nomes = wraps.map(w => w.match(/aria-label="([^"]+)"/)[1]);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
  test('foco visível nas tabelas focáveis', () => {
    expect(ler('public/css/admin-dashboard.css')).toMatch(/\.adc-table-wrap\)\[tabindex\]:focus-visible \{ outline: 2px/);
  });
});

describe('avatar de empresa (paleta fixa)', () => {
  test('iniciais usam a cor fixa escura, não o token que vira cinza no tema claro', () => {
    expect(ler('public/css/admin-usuarios.css')).toMatch(/\.adu-logo \{ color: var\(--avatar-texto-escuro\)/);
    expect(ler('public/css/admin-empresa.css')).toMatch(/\.ade-logo \{ color: var\(--avatar-texto-escuro\)/);
    expect(ler('public/css/temas.css')).toMatch(/\[data-tema="alto-contraste"\] :is\([^)]*\.adu-logo[^)]*\.ade-logo/);
  });
});
