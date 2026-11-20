// Badge azul numa etapa concluída (roadmap/detalhe) no tema claro: o texto precisa de >= 4.5:1
// (WCAG AA) sobre o fundo roxo translúcido da etapa. Antes: #0760cf sobre #dad9f2 = 4.23:1.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "..", "public", "css", "trilha.css"), "utf8");

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

describe("badge-blue em etapa concluída (tema claro)", () => {
  // fundo medido pelo axe-core: etapa concluída (--accent-dim sobre o fundo claro) + badge translúcido
  const FUNDO = "#dad9f2";

  test("o tema claro sobrescreve a cor do badge só dentro da etapa concluída", () => {
    expect(css).toMatch(/:root\[data-tema="claro"\] \.rm-etapa--concluida \.badge-blue \{ color: #[0-9a-f]{6}; \}/i);
  });

  test("a cor usada atinge 4.5:1 sobre o fundo da etapa concluída", () => {
    const cor = css.match(/:root\[data-tema="claro"\] \.rm-etapa--concluida \.badge-blue \{ color: (#[0-9a-f]{6}); \}/i)[1];
    expect(contraste(cor, FUNDO)).toBeGreaterThanOrEqual(4.5);
  });

  test("a cor antiga não atingia (documenta o motivo da regra)", () => {
    expect(contraste("#0760cf", FUNDO)).toBeLessThan(4.5);
  });
});
