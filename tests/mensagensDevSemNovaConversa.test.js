const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe('mensagens do dev: sem o botão "Nova conversa"', () => {
  test("a view não tem o botão nem o listener dele", () => {
    const view = read("views/mensagens.ejs");
    expect(view).not.toMatch(/id="btnNewConv"/);
    expect(view).not.toMatch(/btnNewConv/);
    expect(view).not.toMatch(/class="msg-new-btn"/);
  });

  test("o estado vazio não manda clicar em um botão que não existe", () => {
    expect(read("views/mensagens.ejs")).not.toMatch(/Clique em “Nova conversa”/);
  });

  test("o painel vazio não manda começar uma conversa nova", () => {
    expect(read("views/mensagens.ejs")).not.toMatch(/comece uma nova/);
  });

  test("nenhum CSS sobrou para o botão", () => {
    expect(read("public/css/mensagens.css")).not.toMatch(/msg-new-btn/);
    expect(read("public/css/mensagens-desktop.css")).not.toMatch(/msg-new-btn/);
  });
});
