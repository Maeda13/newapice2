// Mensagens da empresa: "›" ao lado do nome do candidato abre o pop-up "Participantes desta
// conversa" (Você, candidato, ações da conversa e atendimento), igual ao da página do dev.
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").split("\r\n").join("\n");
const VIEW = path.join(ROOT, "views", "empresa-mensagens.ejs");
const html = ejs.render(fs.readFileSync(VIEW, "utf8"), { currentPage: "empresa-mensagens", user: { type: "empresa", company: "Tech Solutions", name: "Tech" } }, { views: [path.join(ROOT, "views")], filename: VIEW });
const fonte = ler("views/empresa-mensagens.ejs");
const css = ler("public/css/mensagens.css");

describe("empresa-mensagens.ejs — botão › e pop-up", () => {
  test("a › fica depois do nome, é um botão nativo com nome acessível e avisa que abre um diálogo", () => {
    expect(html).toMatch(/id="threadHeaderInfo"[\s\S]*?<button class="msg-thread-part-btn" id="threadPartBtn" type="button" aria-haspopup="dialog" aria-label="Participantes e ações da conversa">/);
  });

  test("o pop-up é um <dialog> modal com título, Você, o candidato, as duas ações e o atendimento", () => {
    expect(html).toContain('<dialog class="msg-part" id="modalParticipantes" aria-labelledby="partTitulo">');
    expect(html).toContain("Participantes desta conversa");
    expect(html).toMatch(/<span>Você<\/span>/);
    expect(html).toContain('id="partDevNome"');
    for (const t of ["Ações da conversa", "Marcar como não lida", "Favoritar", "Atendimento", "Acesse a Central de Ajuda"]) expect(html).toContain(t);
    expect(html).toContain('href="/para-empresas#faq-title" target="_blank" rel="noopener"');
    expect(html).toContain('aria-label="Fechar"');
  });

  test("abrir usa showModal() (foco preso e Esc nativos) e o foco volta ao botão ao fechar", () => {
    expect(fonte).toContain('$("modalParticipantes").showModal();');
    expect(fonte).toContain("focoAntesDoPopup = document.activeElement;");
    expect(fonte).toContain('$("modalParticipantes").addEventListener("close", () => { focoAntesDoPopup?.focus?.(); });');
    expect(fonte).toContain('$("threadPartBtn").addEventListener("click", abrirParticipantes);');
  });

  test("favoritar e marcar como não lida usam a API compartilhada, e o nome do candidato é escrito com textContent", () => {
    expect(fonte).toContain("`/api/messages/conversations/${activeConversationId}/${acao}`");
    expect(fonte).toContain('patchConversa("favorite", { favorite: novo })');
    expect(fonte).toContain('patchConversa("unread")');
    expect(fonte).toContain('$("partDevNome").textContent = nomeDoDev(activeConversation);');
  });

  test("conversa favorita ganha a estrela na lista", () => {
    expect(fonte).toContain('c.favorite ? \'<span class="msg-conv-fav" role="img" aria-label="Favorita">★</span>\' : ""');
  });
});

describe("mensagens.css — a › da empresa", () => {
  const i = css.indexOf('/* "›" ao lado do nome do candidato');
  const bloco = css.slice(i);

  test("só aparece na página da empresa, em todos os tamanhos (sem @media), e some o ícone de info duplicado", () => {
    expect(i).toBeGreaterThan(-1);
    expect(bloco).toContain(".msg-thread-part-btn { display: none; }");
    expect(bloco).toContain(".msg-page--company .msg-thread-part-btn {\n  display: flex;");
    expect(bloco).not.toContain("@media");
    expect(bloco).toContain(".msg-page--company .msg-thread-header-clickable > svg { display: none; }");
  });
});
