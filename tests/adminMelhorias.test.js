// tests/adminMelhorias.test.js
// Quatro pontos de melhoria do painel administrativo:
// 1. mudança de plano: janela do site (escolher as contas), não confirm() do navegador;
// 2. perfil de dev/empresa: botão "Suspender conta" ao lado de "Excluir conta" e
//    legenda nos ícones do topo;
// 3. Usuários, Empresas e Vagas: ordenação sem "Todos" e grupos de filtro com título;
// 4. menu "Remover administrador" proporcional à tabela.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("1. mudança de plano usa a janela do site", () => {
  test.each(["views/admin-usuarios.ejs", "views/admin-empresas.ejs"])("%s não usa confirm() e carrega a janela", (v) => {
    const html = ler(v);
    expect(html).not.toMatch(/\bconfirm\(/);
    expect(html).toContain('<script src="/js/admin-plano-contas.js"></script>');
    expect(html).toMatch(/await AdminPlanoContas\.escolher\(/);
  });

  // DOM mínimo: o bastante para a janela montar, marcar e fechar.
  function navegador() {
    let doc;
    const criar = (tag) => {
      const el = {
        tag, children: [], listeners: {}, _checked: false, className: "", disabled: false, textContent: "", open: false,
        attrs: {}, get checked() { return this._checked; }, set checked(v) { this._checked = v; },
        append(...n) { this.children.push(...n); }, remove() { this.removed = true; doc.body.children = doc.body.children.filter((c) => c !== this); },
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
        emit(t, e = {}) { (this.listeners[t] ?? []).forEach((f) => f({ target: this, ...e })); },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.emit("close"); },
        querySelectorAll(sel) {
          const achar = (n) => n.children.flatMap((c) => (typeof c === "object" ? [c, ...achar(c)] : []));
          const todos = achar(this);
          if (sel === "input:checked") return todos.filter((c) => c.tag === "input" && c.checked);
          return todos;
        },
      };
      return el;
    };
    doc = { createElement: criar, body: criar("body"), activeElement: null, contains: () => false };
    const ctx = vm.createContext({ document: doc, window: {}, Number, String });
    vm.runInContext(ler("public/js/admin-plano-contas.js"), ctx);
    return { doc, janela: ctx.window.AdminPlanoContas };
  }
  const contas = [{ id: 11, rotulo: "a@x.com (e-mail e senha)" }, { id: 12, rotulo: "b@x.com (entra pelo GitHub)" }];
  const opcoes = { titulo: "t", intro: "Esta pessoa tem outras contas.", plano: "PRO", contas };
  const achar = (el, texto) => el.querySelectorAll().find((c) => c.textContent === texto);

  test("lista as contas, todas marcadas, e aplica nas marcadas", async () => {
    const { doc, janela } = navegador();
    const p = janela.escolher(opcoes);
    const dlg = doc.body.children[0];
    expect(dlg.open).toBe(true);
    expect(dlg.querySelectorAll("input:checked").map((i) => i.value)).toEqual(["11", "12"]);
    dlg.querySelectorAll().find((c) => c.tag === "input" && c.value === "12").checked = false;
    achar(dlg, "Aplicar nas marcadas").emit("click");
    expect(await p).toEqual([11]);
    expect(dlg.removed).toBe(true);
  });

  test("'Só nesta conta' e fechar (Esc) aplicam apenas na conta alterada", async () => {
    const { doc, janela } = navegador();
    const p = janela.escolher(opcoes);
    achar(doc.body.children[0], "Só nesta conta").emit("click");
    expect(await p).toEqual([]);
    const p2 = janela.escolher(opcoes);
    doc.body.children[0].close(); // Esc
    expect(await p2).toEqual([]);
  });

  test("com tudo desmarcado, 'Aplicar' fica desabilitado", () => {
    const { doc, janela } = navegador();
    janela.escolher(opcoes);
    const dlg = doc.body.children[0];
    dlg.querySelectorAll().filter((c) => c.tag === "input").forEach((i) => { i.checked = false; });
    dlg.querySelectorAll().find((c) => c.tag === "fieldset").emit("change");
    expect(dlg.querySelectorAll().find((c) => c.className === "adv-btn adv-btn--primary").disabled).toBe(true);
  });

  test("o texto das contas entra como texto (nunca como HTML)", () => {
    const js = ler("public/js/admin-plano-contas.js");
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

describe("2. suspender no perfil e legenda dos ícones", () => {
  test("o botão 'Suspender conta' fica junto de 'Excluir conta'", () => {
    const p = ler("views/partials/admin-excluir-conta.ejs");
    expect(p).toMatch(/id="btn-suspender-conta"[\s\S]*id="btn-excluir-conta"/);
    expect(p).toContain("Suspender conta");
  });

  test.each([
    ["views/admin-empresa.ejs", "co.active"],
    ["views/admin-usuario.ejs", "dev.active"],
  ])("%s: o botão e o ícone do topo fazem a mesma coisa, e os ícones têm legenda", (v, ativo) => {
    const html = ler(v);
    expect(html).toMatch(/for \(const id of \["btn-status", "btn-suspender-conta"\]\)/);
    expect(html).toContain(`$("btn-suspender-conta-texto").textContent = ${ativo} ? "Suspender conta" : "Reativar conta"`);
    expect(html).toContain(`st.dataset.tip = ${ativo} ? "Suspender conta" : "Reativar conta"`);
    expect(html).toContain('data-tip="Enviar e-mail"');
    expect(html).toContain('data-tip="Editar"');
  });

  test("a legenda aparece no hover e no foco do teclado", () => {
    const css = ler("public/css/admin-usuarios.css");
    expect(css).toMatch(/\.adv-icon-btn\[data-tip\]:hover::after, \.adv-icon-btn\[data-tip\]:focus-visible::after/);
  });
});

describe("3. ordenação e filtros", () => {
  test.each(["views/admin-usuarios.ejs", "views/admin-empresas.ejs", "views/admin-vagas.ejs"])("%s: a ordenação só tem opções que ordenam", (v) => {
    const html = ler(v);
    const lista = html.match(/<ul class="adv-listbox"[\s\S]*?<\/ul>/)[0];
    const valores = [...lista.matchAll(/data-v="(\w+)"/g)].map((m) => m[1]);
    expect(valores).toEqual(expect.arrayContaining(["recentes", "antigos", "az"]));
    expect(valores).not.toEqual(expect.arrayContaining(["todos"]));
    expect(valores).not.toEqual(expect.arrayContaining(["todas"]));
    expect(lista).not.toMatch(/>Todos?<|>Todas?</);
    expect(html).toMatch(/sort: "recentes"/);
    expect(html).toContain('<span id="sort-label">Mais recentes</span>');
    expect(html).toMatch(/antigos: +\(a, b\) => new Date\(a\.created_at\) - new Date\(b\.created_at\)/);
  });

  test.each([
    ["views/admin-usuarios.ejs", ["Plano", "Nível"]],
    ["views/admin-empresas.ejs", ["Vagas", "Situação"]],
    ["views/admin-vagas.ejs", ["Status", "Nível"]],
  ])("%s: cada grupo de filtro tem título", (v, titulos) => {
    const html = ler(v);
    for (const t of titulos) expect(html).toContain(`<span class="adv-group-title" aria-hidden="true">${t}</span>`);
  });
});

describe("3b. sem botão de filtro 'Todos'", () => {
  test.each(["views/admin-usuarios.ejs", "views/admin-empresas.ejs", "views/admin-vagas.ejs"])("%s: sem chip Todos/Todas; clicar no marcado o desmarca", (v) => {
    const html = ler(v);
    expect(html).not.toMatch(/class="adv-chip"[^>]*data-v="todas?os?"/);
    expect(html).not.toMatch(/>Todos?<\/button>|>Todas<\/button>/);
    expect(html).toMatch(/=== btn\.dataset\.v \? "todas"|"todos"/);
  });
});

describe("4. menu 'Remover administrador'", () => {
  const css = ler("public/css/admin-seguranca.css");
  test("botões baixos, como as linhas da tabela", () => {
    const m = css.match(/\.ads-danger, \.ads-cancel \{[^}]*min-height: (\d+)px/);
    expect(Number(m[1])).toBeLessThanOrEqual(36);
  });
  test("a posição do menu acompanha a largura nova", () => {
    const largura = Number(css.match(/\.ads-sheet \{[^}]*width: (\d+)px/)[1]);
    expect(ler("views/admin-configuracoes-seguranca.ejs")).toContain(`r.right + window.scrollX - ${largura}, 12`);
  });
});
