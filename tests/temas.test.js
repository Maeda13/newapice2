// tests/temas.test.js
// Temas de acessibilidade (Padrão, Claro, Alto contraste): public/css/temas.css,
// partials/tema-head.ejs (tema aplicado antes do CSS), partials/seletor-tema.ejs e
// public/js/tema.js.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const andar = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? andar(path.join(d, e.name)) : [path.join(d, e.name)]);
const views = andar(path.join(ROOT, "views")).filter(f => f.endsWith(".ejs") && !/[\\/]partials[\\/]/.test(f));
const temas = ler("public/css/temas.css");

// blocos de tokens de cada tema (o primeiro :root{} de tokens gerados é o padrão)
function blocos(seletor) {
  const re = new RegExp(seletor.replace(/[[\]"=]/g, m => "\\" + m) + "\\s*\\{([^}]*)\\}", "g");
  const vars = {};
  for (const m of temas.matchAll(re)) for (const d of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
}
const padrao = blocos(":root"), claro = blocos(':root[data-tema="claro"]'), alto = blocos(':root[data-tema="alto-contraste"]');

const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const lum = h => { h = h.replace("#", ""); return .2126 * lin(parseInt(h.slice(0, 2), 16)) + .7152 * lin(parseInt(h.slice(2, 4), 16)) + .0722 * lin(parseInt(h.slice(4, 6), 16)); };
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

describe("tema aplicado antes do CSS", () => {
  test("as 57 páginas incluem o tema-head logo depois do viewport, antes de qualquer CSS", () => {
    expect(views.length).toBe(57);
    for (const f of views) {
      const s = fs.readFileSync(f, "utf8");
      const head = s.slice(s.indexOf("<head>"), s.indexOf("</head>"));
      const i = head.search(/include\('(\.\.\/)?partials\/tema-head'\)/);
      expect([path.basename(f), i]).not.toEqual([path.basename(f), -1]);
      expect(i).toBeLessThan(head.indexOf('rel="stylesheet"'));
    }
  });

  test("o script do <head> lê a escolha salva (com try/catch) e, sem ela, segue o sistema", () => {
    const s = ler("views/partials/tema-head.ejs");
    expect(s).toMatch(/try \{\s*t = localStorage\.getItem\("tema"\);/);
    expect(s).toMatch(/prefers-contrast: more\)"\)\.matches \? "alto-contraste"/);
    expect(s).toMatch(/prefers-color-scheme: light\)"\)\.matches \? "claro" : "padrao"/);
    expect(s).toMatch(/document\.documentElement\.setAttribute\("data-tema", t\)/);
    expect(s).toMatch(/<link rel="stylesheet" href="\/css\/temas\.css" \/>/);
  });
});

describe("tokens", () => {
  const usados = new Set();
  for (const f of [...andar(path.join(ROOT, "public/css")), ...andar(path.join(ROOT, "views")), ...andar(path.join(ROOT, "public/js"))]) {
    if (!/\.(css|ejs|js)$/.test(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/var\(--((?:sup|txt|lin|som|sob)-[a-z0-9-]+|grafico-[a-z]+|avatar-[a-z-]+|cor-[a-z-]+)\)/g)) usados.add(m[1]);
  }

  test("todo token de tema usado está definido no padrão, no claro e no alto contraste", () => {
    expect(usados.size).toBeGreaterThan(250);
    const faltando = [];
    for (const t of usados) {
      if (!(t in padrao)) faltando.push("padrão: " + t);
      if (/^(avatar|cor)-/.test(t)) continue; // iguais em todos os temas (avatar) ou derivados do design system (cor)
      if (!(t in claro)) faltando.push("claro: " + t);
      if (!(t in alto)) faltando.push("alto contraste: " + t);
    }
    expect(faltando).toEqual([]);
  });

  test("no tema padrão cada token gerado vale a cor original que está no nome", () => {
    for (const [t, v] of Object.entries(padrao)) {
      const m = t.match(/^(sup|txt|lin|som|sob)-([0-9a-f]{6})(?:-a(\d+))?$/);
      if (!m) continue;
      const [r, g, b] = [0, 2, 4].map(i => parseInt(m[2].slice(i, i + 2), 16));
      if (!m[3]) { expect([t, v.toLowerCase()]).toEqual([t, "#" + m[2]]); continue; }
      const p = v.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
      expect([t, !!p]).toEqual([t, true]);
      expect([+p[1], +p[2], +p[3]]).toEqual([r, g, b]);
      expect(Math.round(+p[4] * (m[3].length === 3 ? 1000 : 100))).toBe(+m[3]);
    }
  });

  test("claro: texto e destaques passam de 4,5:1 sobre os três fundos claros; botões de cor com texto branco também", () => {
    for (const fundo of [claro.bg, claro["bg-2"], claro["bg-3"]]) {
      for (const t of ["text", "muted", "accent", "accent-text", "teal", "red", "blue", "yellow", "purple", "admin"]) {
        expect([t, fundo, razao(claro[t], fundo) >= 4.5]).toEqual([t, fundo, true]);
      }
    }
    for (const t of ["accent", "accent-hv", "teal", "teal-hv", "red", "admin"]) expect([t, razao("#ffffff", claro[t]) >= 4.5]).toEqual([t, true]);
  });

  test("alto contraste: fundo preto, texto branco, destaques amarelo/ciano, todos com 7:1 ou mais", () => {
    expect([alto.bg, alto["bg-2"], alto["bg-3"], alto.text]).toEqual(["#000000", "#000000", "#000000", "#ffffff"]);
    expect(alto.accent).toBe("#ffff00");
    for (const t of ["text", "muted", "accent", "accent-text", "teal", "red", "blue", "yellow", "admin", "border", "cor-foco"]) {
      expect([t, razao(alto[t], "#000000") >= 7]).toEqual([t, true]);
    }
    // sem sombras nem brilhos
    for (const [t, v] of Object.entries(alto)) if (/^som-|glow/.test(t)) expect([t, v]).toEqual([t, "transparent"]);
  });
});

describe("seletor de tema", () => {
  const parcial = ler("views/partials/seletor-tema.ejs");

  test("HTML semântico: fieldset com legend, três rádios com rótulo em texto e aviso em <output aria-live>, sem <div>", () => {
    expect(parcial).not.toMatch(/<div/);
    expect(parcial).toMatch(/<fieldset class="tema__opcoes">\s*<legend>Tema<\/legend>/);
    for (const [valor, rotulo] of [["padrao", "Padrão"], ["claro", "Claro"], ["alto-contraste", "Alto contraste"]]) {
      expect(parcial).toMatch(new RegExp(`<label class="tema__opcao"><input type="radio" name="tema-<%= idTema %>" value="${valor}" data-tema-opcao> ${rotulo}</label>`));
    }
    expect(parcial).toMatch(/<output class="tema__aviso" aria-live="polite" data-tema-aviso><\/output>/);
    expect(parcial).toMatch(/<button type="button" class="tema__botao" aria-expanded="false" aria-controls="tema-painel-<%= idTema %>"/);
  });

  test("está nos quatro cabeçalhos e nas seis páginas sem cabeçalho; os botões antigos saíram", () => {
    for (const h of ["header", "header-dev", "header-company", "header-admin"]) {
      const s = ler(`views/partials/${h}.ejs`);
      expect(s).toMatch(/include\('seletor-tema', \{ idTema: 'cab' \}\)/);
      expect(s).not.toMatch(/toggleDarkMode|toggleHighContrast|accessibility\.js|data-a11y/);
    }
    for (const v of ["404", "500", "login", "cadastro", "esqueci-senha", "redefinir-senha"]) {
      expect(ler(`views/${v}.ejs`)).toMatch(/include\('partials\/seletor-tema', \{ idTema: 'pagina', flutuante: true \}\)/);
    }
    expect(fs.existsSync(path.join(ROOT, "public/js/accessibility.js"))).toBe(false);
  });

  test("tema.js grava a escolha com try/catch, anuncia a troca e fecha com Esc", () => {
    const s = ler("public/js/tema.js");
    expect(s).toMatch(/try \{\s*localStorage\.setItem\("tema", t\);/);
    expect(s).toMatch(/"claro": "Tema claro ativado\."/);
    expect(s).toMatch(/e\.key === "Escape"/);
    expect(s).toMatch(/new CustomEvent\("temachange"/);
  });

  test("foco de teclado visível em todos os temas: contorno de 3px por cima do foco dos componentes, com 3:1 ou mais", () => {
    expect(temas).toMatch(/^:focus-visible \{ outline: 3px solid var\(--cor-foco\) !important; outline-offset: 2px !important; \}$/m);
    expect([padrao["cor-foco"], claro["cor-foco"], alto["cor-foco"]]).toEqual(["#a78bfa", "#1d4ed8", "#ffff00"]);
    for (const fundo of ["#000000", "#0a0a0a", "#111111"]) expect(razao(padrao["cor-foco"], fundo)).toBeGreaterThanOrEqual(3);
    for (const fundo of [claro.bg, claro["bg-2"], claro["bg-3"]]) expect(razao(claro["cor-foco"], fundo)).toBeGreaterThanOrEqual(3);
    expect(razao(alto["cor-foco"], alto.bg)).toBeGreaterThanOrEqual(7);
    // nas caixas de busca o anel vai na caixa (com :has), não no texto de dentro
    expect(temas).toMatch(/@supports selector\(:has\(\*\)\) \{\s*:is\(\.adv-search, \.ads-search, \.devs-search-wrap, \.chatv-search\):has\(:is\(input, textarea\):focus-visible\) \{ outline: 3px solid var\(--cor-foco\);/);
  });

  test("claro: campos com borda de 3:1 sobre os três fundos, sem apagar a borda vermelha de erro", () => {
    const m = temas.match(/\[data-tema="claro"\] :is\(input[^{]*\):not\(:focus\)([^{]*)\{\s*border-color: (#[0-9a-f]{6});/);
    expect(m).not.toBeNull();
    for (const classe of [".is-invalid", ".invalid", ".err"]) expect(m[1]).toContain(`:not(${classe})`);
    for (const fundo of [claro.bg, claro["bg-2"], claro["bg-3"]]) expect(razao(m[2], fundo)).toBeGreaterThanOrEqual(3);
    expect(temas).toMatch(/\[data-tema="claro"\] ::placeholder \{ color: #5f6672 !important; opacity: 1 !important; \}/);
  });
});

describe("Mentor: texto do estado vazio sobre o degradê do meio", () => {
  test("branco no claro (degradê azul) e preto no alto contraste (degradê amarelo)", () => {
    expect(temas).toMatch(/\[data-tema="claro"\] :is\(\.mentor-vazio-titulo, \.mentor-vazio-sub\) \{ color: #ffffff; \}/);
    expect(temas).toMatch(/\[data-tema="alto-contraste"\] :is\(\.mentor-vazio-titulo, \.mentor-vazio-sub\) \{ color: #000000; \}/);
    // alto contraste: o miolo do degradê (public/css/mentor-desktop.css) usa estes tokens
    for (const t of ["sup-29396a", "sup-263763-a95", "sup-0c2730"]) expect([t, razao("#000000", alto[t]) >= 7]).toEqual([t, true]);
    // claro: degradê próprio, azul mais claro; até 70% (onde fica o texto) o branco tem 4,5:1
    const regra = temas.match(/\[data-tema="claro"\] #mentorChat\.mentor-chat--vazio \{([^}]*)\}/);
    expect(regra).not.toBeNull();
    const base = regra[1].match(/radial-gradient\(ellipse 60% 44% at 50% 47%, ([^)]*)\)/)[1];
    const ate70 = [...base.matchAll(/(#[0-9a-f]{6}) (\d+)%/g)].filter(m => +m[2] <= 70).map(m => m[1]);
    expect(ate70).toEqual(["#2563eb", "#2a66eb", "#2f6bea"]);
    for (const c of [...ate70, "#2259e0"]) expect([c, razao("#ffffff", c) >= 4.5]).toEqual([c, true]);
  });
});

describe("checkout e gráficos seguem o tema", () => {
  test("o formulário do Mercado Pago usa o tema claro quando o site está claro", () => {
    expect(ler("public/js/assinatura-checkout.js")).toMatch(/theme: document\.documentElement\.getAttribute\('data-tema'\) === 'claro' \? 'default' : 'dark'/);
  });
  test("os gráficos do admin leem as cores do tema", () => {
    const s = ler("public/js/admin-relatorio.js");
    expect(s).toMatch(/get COR\(\) \{ return \{ devs: corDoTema\("--grafico-devs"/);
    for (const t of ["grafico-devs", "grafico-empresas", "grafico-free", "grafico-fundo", "grafico-tinta", "grafico-suave", "grafico-grade"]) {
      expect([t, t in padrao && t in claro && t in alto]).toEqual([t, true]);
    }
  });
});
