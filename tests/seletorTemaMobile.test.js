// tests/seletorTemaMobile.test.js
// Seletor de acessibilidade (tema e tamanho do texto) no cabeçalho do celular: o
// painel se ancorava no botão, que fica no meio da barra, e saía da tela pela
// esquerda (até 162px fora, em 360px). Agora ele se ancora no cabeçalho (sticky),
// logo abaixo, com margem dos dois lados, e rola por dentro se não couber.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "temas.css"), "utf8");
const bloco = (() => {
  const i = css.indexOf("@media (max-width: 767.98px) {\n  .tema__painel { right: -8px; }".replace(/\n/g, css.includes("\r\n") ? "\r\n" : "\n"));
  expect(i).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("/* Tamanho do texto:", i));
})();

test("no celular, o seletor do cabeçalho deixa de ser a referência de posição do painel", () => {
  expect(bloco).toMatch(/\.site-header \.tema:not\(\.tema--embutido\):not\(\.tema--flutuante\) \{ position: static; \}/);
});

test("o painel fica abaixo do cabeçalho, com 12px de margem dos dois lados e no máximo 420px", () => {
  const painel = bloco.match(/\.site-header \.tema:not\(\.tema--embutido\):not\(\.tema--flutuante\) \.tema__painel \{([^}]*)\}/)[1];
  for (const re of [/top: calc\(100% \+ 8px\)/, /left: 12px/, /right: 12px/, /width: auto/, /min-width: 0/, /max-width: 420px/, /margin-left: auto/]) {
    expect(painel).toMatch(re);
  }
});

test("rola por dentro quando a tela é baixa ou o texto está ampliado", () => {
  expect(bloco).toMatch(/max-height: calc\(100dvh - var\(--header-h, 64px\) - 24px\);\s*overflow-y: auto;/);
});

test("o seletor dentro do menu do usuário e o flutuante (login) não mudam", () => {
  expect(bloco).not.toMatch(/\.tema--embutido \.tema__painel|\.tema--flutuante \.tema__painel/);
});
