// tests/mentorCelular.test.js
// Mentor no celular (< 768px) conforme o protótipo: cartão com cabeçalho (☰, ícone e
// "Mentor"), estado vazio "Por onde começamos?" em degradê, balões e campo em pílula;
// o histórico abre numa gaveta pelo ☰. O tablet (768–1023px) e o desktop não mudam.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const view = ler("views/mentor.ejs");
const css = ler("public/css/mentor-mobile.css");
const celular = css.slice(css.indexOf("CELULAR (< 768px)"));

describe("marcação", () => {
  test("cabeçalho do chat com ☰ (controla a gaveta), ícone e título", () => {
    expect(view).toMatch(/<button type="button" class="mentor-menu-btn" id="btn-mentor-menu" aria-label="Abrir histórico de conversas" aria-expanded="false" aria-controls="mentorSidebar">/);
    expect(view).toContain('<aside class="mentor-sidebar" id="mentorSidebar"');
    expect(view).toContain('<h2 class="mentor-cab-titulo">Mentor</h2>');
    expect(view).toContain('<button type="button" class="mentor-menu-fundo" id="mentorMenuFundo" tabindex="-1" aria-hidden="true"></button>');
  });
});

describe("CSS", () => {
  test("os elementos novos só aparecem abaixo de 768px", () => {
    expect(css).toMatch(/\.mentor-menu-btn, \.mentor-cab-icone, \.mentor-cab-titulo, \.mentor-menu-fundo \{ display: none; \}/);
    expect(celular).toMatch(/@media \(max-width: 767\.98px\) \{/);
    // o modelo lista → conversa do tablet continua (bloco ≤1023px intacto)
    expect(css).toMatch(/\.mentor-layout:not\(\.show-thread\):has\(> #mentorChat:not\(\[hidden\]\)\) > #mentorChat \{ display: none; \}/);
  });
  test("o chat é um cartão sempre na tela; o fundo fica numa regra fraca para o degradê vencer", () => {
    expect(celular).toMatch(/border: 2px solid var\(--lin-1c1c1c\); border-radius: 10px;/);
    expect(celular).toMatch(/#mentorChat \{ background: var\(--sup-000000\); \}/);
    expect(celular).toMatch(/#mentorChat\.mentor-chat--vazio \{\s*background:\s*radial-gradient/);
  });
  test("histórico em gaveta pela esquerda, fechada fora da tela e invisível ao teclado", () => {
    expect(celular).toMatch(/> \.mentor-sidebar \{[^}]*position: fixed;[^}]*transform: translateX\(-105%\); visibility: hidden;/);
    expect(celular).toMatch(/\.mentor-layout\.menu-aberto[^{]*> \.mentor-sidebar \{\s*transform: none; visibility: visible;/);
  });
  test("o anel de foco vai na pílula e na busca da gaveta, também no celular", () => {
    const temas = ler("public/css/temas.css");
    expect(temas).toMatch(/@media \(max-width: 767\.98px\) \{\s*:is\(\.mentor-busca, #mentorChat \.msg-thread-input\):has\(:is\(input, textarea\):focus-visible\)/);
  });
  test("tema claro: halo do protótipo e ícone preto também no celular", () => {
    const temas = ler("public/css/temas.css");
    const bloco = temas.slice(temas.indexOf("/* Celular (< 768px, mentor-mobile.css)"));
    expect(bloco).toMatch(/\[data-tema="claro"\] #mentorChat\.mentor-chat--vazio \{\s*background:\s*radial-gradient\(ellipse 44% 22% at 50% 50%, #869fd3/);
    expect(bloco).toMatch(/\[data-tema="claro"\] \.mentor-cab-icone \{ background: #000000;/);
  });
});

describe("comportamento da gaveta (script da página no vm)", () => {
  function pagina({ celular = true, desktop = false } = {}) {
    const script = view.slice(view.indexOf("<script>\n  const $ = id") >= 0 ? view.indexOf("<script>\n  const $ = id") : view.indexOf("<script>\r\n  const $ = id"));
    const codigo = script.slice(script.indexOf("\n") + 1, script.indexOf("</script>"));
    const classes = new Set();
    const els = {};
    const el = (id) => (els[id] ??= {
      id, value: "", placeholder: "Pergunte algo...", hidden: false, innerHTML: "", textContent: "", disabled: false,
      attrs: {}, listeners: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, focus() { foco = id; }, requestSubmit() {},
      insertAdjacentHTML() {}, querySelector: () => null, scrollTop: 0, scrollHeight: 0, files: [],
    });
    let foco = null;
    const layout = { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} } };
    const media = (q) => ({ matches: q.includes("767.98") ? celular : q.includes("1024") ? desktop : q.includes("720") ? celular : false, addEventListener() {} });
    const docListeners = {};
    const ctx = vm.createContext({
      window: { matchMedia: media }, document: {
        getElementById: el, querySelector: (s) => (s === ".mentor-layout" ? layout : null),
        addEventListener: (t, f) => { (docListeners[t] ??= []).push(f); }, createElement: () => ({ set textContent(v) { this.innerHTML = String(v); } }),
      },
      fetch: async () => ({ ok: true, status: 200, json: async () => [] }), setTimeout, clearTimeout, console,
      AbortController: class { abort() {} }, FormData: class {},
    });
    vm.runInContext(codigo, ctx);
    return { els, classes, docListeners, foco: () => foco };
  }

  test("☰ abre e fecha a gaveta, atualiza aria-expanded e o rótulo", () => {
    const p = pagina();
    const btn = p.els["btn-mentor-menu"];
    btn.listeners.click[0]();
    expect(p.classes.has("menu-aberto")).toBe(true);
    expect(btn.attrs["aria-expanded"]).toBe("true");
    expect(btn.attrs["aria-label"]).toBe("Fechar histórico de conversas");
    expect(p.foco()).toBe("mentorBusca");
    btn.listeners.click[0]();
    expect(p.classes.has("menu-aberto")).toBe(false);
    expect(btn.attrs["aria-expanded"]).toBe("false");
    expect(p.foco()).toBe("btn-mentor-menu");
  });

  test("tocar no fundo e Esc fecham a gaveta", () => {
    const p = pagina();
    p.els["btn-mentor-menu"].listeners.click[0]();
    p.els.mentorMenuFundo.listeners.click[0]();
    expect(p.classes.has("menu-aberto")).toBe(false);
    p.els["btn-mentor-menu"].listeners.click[0]();
    p.docListeners.keydown.forEach(f => f({ key: "Escape" }));
    expect(p.classes.has("menu-aberto")).toBe(false);
  });

  test("'Nova conversa' no celular fecha a gaveta e não usa a tela cheia do tablet", () => {
    const p = pagina();
    p.els["btn-mentor-menu"].listeners.click[0]();
    p.els["btn-mentor-nova"].listeners.click[0]();
    expect(p.classes.has("menu-aberto")).toBe(false);
    expect(p.classes.has("show-thread")).toBe(false);
  });

  test("no tablet, 'Nova conversa' continua abrindo a conversa em tela cheia", () => {
    const p = pagina({ celular: false });
    p.els["btn-mentor-nova"].listeners.click[0]();
    expect(p.classes.has("show-thread")).toBe(true);
  });
});
