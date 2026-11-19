const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const mensagens = read("public/css/mensagens.css");
const mobile = read("public/css/mentor-mobile.css");
const view = read("views/mentor.ejs");

describe("mentor no celular/tablet: lista → conversa, como o chat de mensagens", () => {
  test("a regra de ≤720px que esconde .msg-thread não atinge o .mentor-layout (tela preta)", () => {
    expect(mensagens).toMatch(/\.msg-layout:not\(\.mentor-layout\) > \.msg-thread\s*\{\s*display:\s*none/);
  });

  test("mentor.ejs carrega mentor-mobile.css depois do mentor-desktop.css", () => {
    expect(view.indexOf('href="/css/mentor-mobile.css"')).toBeGreaterThan(view.indexOf('href="/css/mentor-desktop.css"'));
  });

  test("mobile: a lista é a tela inicial e o chat só aparece com .show-thread", () => {
    expect(mobile).toMatch(/@media \(max-width: 1023px\)/);
    expect(mobile).toMatch(/\.mentor-layout:not\(\.show-thread\):has\(> #mentorChat:not\(\[hidden\]\)\) > \.mentor-sidebar \{ display: flex; \}/);
    expect(mobile).toMatch(/\.mentor-layout:not\(\.show-thread\):has\(> #mentorChat:not\(\[hidden\]\)\) > #mentorChat \{ display: none; \}/);
    expect(mobile).toMatch(/\.mentor-layout\.show-thread > #mentorChat:not\(\[hidden\]\) \{[^}]*position: fixed/);
  });

  test("a altura desconta a barra inferior fixa (≤860px)", () => {
    expect(mobile).toMatch(/@media \(max-width: 860px\) \{\s*\.msg-layout\.mentor-layout \{\s*height: calc\(100dvh - var\(--header-h\) - 92px/);
  });

  test("o chat tem botão de voltar, escondido fora do celular/tablet", () => {
    expect(view).toMatch(/<button type="button" class="mentor-voltar" id="btn-mentor-voltar" aria-label="Voltar para as conversas">/);
    expect(mobile).toMatch(/^\.mentor-voltar \{ display: none; \}/m);
  });

  test("o JS abre o chat ao escolher conversa / Nova conversa e volta à lista", () => {
    expect(view).toMatch(/function abrirChatNaTela\(\)[\s\S]*classList\.add\("show-thread"\)/);
    expect(view).toMatch(/function voltarParaLista\(\)[\s\S]*classList\.remove\("show-thread"\)/);
    expect(view).toMatch(/btn-mentor-voltar"\)\.addEventListener\("click", voltarParaLista\)/);
    // não abre mais a conversa mais recente sozinho: começa na lista
    expect(view).not.toMatch(/const ultima = /);
  });
});
