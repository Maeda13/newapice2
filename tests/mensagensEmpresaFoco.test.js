// Mensagens da empresa: o campo de digitar usa a cor da empresa no foco (o anel global do
// tema, temas.css, é lilás no Padrão e azul no Claro). A regra vale em todos os tamanhos
// (fica fora de qualquer @media) e não muda a página do dev.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "mensagens.css"), "utf8").split("\r\n").join("\n");
const i = css.indexOf("Campos de digitar da empresa");
const bloco = css.slice(i, css.indexOf('/* "›" ao lado do nome', i) > -1 ? css.indexOf('/* "›" ao lado do nome', i) : undefined);

describe("mensagens.css — foco do campo de digitar na empresa", () => {
  test("o anel de foco do campo de mensagem e da busca usa --brand-company, com prioridade sobre o global", () => {
    expect(i).toBeGreaterThan(-1);
    expect(bloco).toContain(".msg-page--company .msg-thread-input textarea:focus-visible");
    expect(bloco).toContain(".msg-page--company .msg-search-row input:focus-visible");
    expect(bloco).toContain("outline-color: var(--brand-company) !important;");
  });

  test("vale em todos os tamanhos (sem @media) e só na empresa (escopo .msg-page--company)", () => {
    expect(bloco).not.toContain("@media");
    for (const linha of bloco.split("\n").filter(l => /^\.msg-page|^\.msg-/.test(l))) expect(linha).toMatch(/^\.msg-page--company /);
  });

  test("a borda do campo no foco também é a cor da empresa, não a do dev", () => {
    expect(bloco).toContain(".msg-page--company .msg-thread-input textarea:focus");
    expect(bloco).toContain("border-color: var(--brand-company);");
    expect(css).not.toMatch(/\.msg-page--company[^{]*\{[^}]*7c3aed/);
  });
});
