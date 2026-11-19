const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "public/css/repositorios.css"), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 700px)"));

describe('repositórios: pop-up "Editar repositório" no celular', () => {
  test("fica centralizado na tela (não como bottom sheet)", () => {
    expect(mobile).toMatch(/#modal-edit\.modal-backdrop \{ align-items: center; padding: 16px; \}/);
    expect(mobile).toMatch(/#modal-edit \.modal \{[^}]*border-radius: 18px/);
    expect(mobile).toMatch(/#modal-edit \.modal \{[^}]*max-height: calc\(100dvh - 32px\)/);
  });

  test('"Adicionar repositório" continua como folha inferior', () => {
    expect(mobile).toMatch(/\.modal-backdrop \{ align-items: flex-end; padding: 0; \}/);
  });
});
