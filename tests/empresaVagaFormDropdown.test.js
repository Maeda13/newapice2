// Formulário de vaga: o dropdown de skills (que passa da borda do cartão) não pode
// ficar por baixo do cartão seguinte ("Adicionais"). Cada .form-section é uma camada
// própria por causa da animação (transform), então o cartão em uso sobe de z-index.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "empresa-vaga-form.css"), "utf8").split("\r\n").join("\n");

describe("empresa-vaga-form.css — empilhamento do dropdown de skills", () => {
  test("o cartão é posicionado (z-index só vale assim) e sobe quando em foco ou com dropdown aberto", () => {
    expect(css).toContain(".form-section { position: relative; }");
    expect(css).toContain(".form-section:focus-within,\n.form-section:has(.skill-dropdown:not([hidden])) { z-index: 10; }");
  });

  test("o z-index do cartão em uso fica acima do dropdown local (50 só vale dentro do cartão) e abaixo do toast", () => {
    const toast = Number(css.match(/position: fixed; bottom: 24px; right: 24px; z-index: (\d+)/)[1]);
    expect(10).toBeLessThan(toast);
  });

  test("a regra vem antes da animação por posição, e a animação continua desligada com 'reduzir movimento'", () => {
    expect(css.indexOf(".form-section { position: relative; }")).toBeLessThan(css.indexOf(".form-section:nth-of-type(2)"));
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {\n  .form-section { animation: none; }");
  });
});
