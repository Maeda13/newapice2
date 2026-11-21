// Gráficos dos relatórios de ADM nas cores do admin: amarelo (série 1) e cinza
// (série 2), com um cinza de outro tom para o "resto" (FREE). Sem roxo nem verde.
// Paletas validadas com o validate_palette.js do skill de dataviz (separação CVD e
// normal ΔE ≥ 14, contraste ≥ 3:1 contra o fundo de cada tema).
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/temas.css'), 'utf8').replace(/\r\n/g, '\n');
const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/admin-relatorio.js'), 'utf8');

const bloco = (sel) => {
  const i = css.indexOf('/* ═══ Gráficos do admin');
  const j = css.indexOf(`${sel} {`, i);
  return css.slice(j, css.indexOf('}', j));
};
const tok = (b, nome) => (b.match(new RegExp(`--grafico-${nome}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1]?.toUpperCase();

describe('cores dos gráficos do admin', () => {
  test.each([
    [':root', '#E2E52B', '#A1A1AA', '#6E6E78'],
    [':root[data-tema="claro"]', '#7A7C00', '#3F3F46', '#8E8E98'],
    [':root[data-tema="alto-contraste"]', '#FFFF00', '#FFFFFF', '#9E9E9E'],
  ])('%s: amarelo, cinza e cinza do FREE', (sel, devs, empresas, free) => {
    const b = bloco(sel);
    expect([tok(b, 'devs'), tok(b, 'empresas'), tok(b, 'free')]).toEqual([devs, empresas, free]);
  });
  test('fallback do JS (sem tema carregado) também é amarelo/cinza', () => {
    expect(js).toContain('corDoTema("--grafico-devs", "#E2E52B")');
    expect(js).toContain('corDoTema("--grafico-empresas", "#A1A1AA")');
    expect(js).toContain('corDoTema("--grafico-free", "#6E6E78")');
    expect(js).not.toMatch(/#8B5CF6|#0FA391/i);
  });
});

describe('medidores dos relatórios seguem a cor do gráfico do admin', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('barra dos cards (adc-split) e barras de preenchimento (add-fill-bar)', () => {
    expect(ler('public/css/admin-crescimento.css')).toMatch(/\.adc-split > span \{[^}]*background: var\(--grafico-devs\)/);
    expect(ler('public/css/admin-desempenho.css')).toMatch(/\.add-fill-bar \{[^}]*background: var\(--grafico-devs\)/);
  });
});

describe('Atividade das empresas: gráfico de série única em amarelo', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'views/admin-relatorio-empresas.ejs'), 'utf8');
  test('barras de candidaturas usam a cor principal (COR.devs = amarelo), não o cinza', () => {
    expect(s).toMatch(/base - y\(d\.candidaturas\), 4\), fill: COR\.devs \}/);
    expect(s).toMatch(/\[\[COR\.devs, "Candidaturas", d\.candidaturas\], \[COR\.empresas, "Vagas publicadas", d\.vagas\]\]/);
  });
});
