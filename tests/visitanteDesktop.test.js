// tests/visitanteDesktop.test.js
// Home, "Sobre" e "Para Devs" no desktop (protótipos de 1440px). Só o desktop
// muda: celular e tablet continuam com landing.css / sobre*.css / para-devs*.css
// (fora o rodapé, que Sobre e Para Devs/Empresas ganharam também no celular e no
// tablet: o mesmo da home, em rodape.css).
// O que as respostas dos FAQs prometem é conferido com o código, para não
// ficar errado se o produto mudar.
const ejs  = require("ejs");
const { cardsPlano } = require("../services/planoCards");
const fs   = require("fs");
const path = require("path");

const ROOT  = path.join(__dirname, "..");
const VIEWS = path.join(ROOT, "views");
const ler   = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const semComentarios = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

function render(view, locals) {
  const arquivo = path.join(VIEWS, `${view}.ejs`);
  return ejs.render(fs.readFileSync(arquivo, "utf8"), locals, { views: [VIEWS], filename: arquivo });
}

// Separa o CSS em "fora do @media de desktop" e "dentro dele" (o bloco vai até o fim do arquivo).
function partes(rel) {
  const css = semComentarios(ler(rel));
  const i = css.indexOf("@media (min-width: 1024px)");
  expect(i).toBeGreaterThan(-1);
  const bloco = css.slice(i);
  expect((bloco.match(/\{/g) || []).length).toBe((bloco.match(/\}/g) || []).length);
  expect(bloco.trim().endsWith("}")).toBe(true);
  const dentro = bloco.slice(bloco.indexOf("{") + 1, bloco.lastIndexOf("}"));
  const seletores = [...dentro.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(m => m[1].split(",")).map(s => s.trim()).filter(Boolean);
  return { fora: css.slice(0, i).trim(), seletores };
}

const stats = { devs: 3, jobs: 2, skills: 5 };

// Os mesmos dados que as rotas de server.js montam a partir do config/plans.js
const { getPlan, annualMonthlyCents, MAX_PARCELAS_ANUAL } = require("../config/plans");
const reais = c => (c / 100).toFixed(2).replace(".", ",");
const precosPro = code => {
  const p = getPlan(code);
  return { mensal: reais(p.price_cents), anual: reais(annualMonthlyCents(p)), anualTotal: reais(p.annual_price_cents) };
};

describe("CSS só no desktop", () => {
  test("home: fora do @media, só esconde o que existe apenas no desktop; dentro, tudo preso à .home", () => {
    const { fora, seletores } = partes("public/css/home-desktop.css");
    expect(fora).toBe(".hero__planos, .experiences__desc-desktop { display: none; }");
    expect(seletores.length).toBeGreaterThan(60);
    for (const s of seletores) expect(s).toMatch(/^\.home\b/);
  });

  test("rodapé: nada fora do @media; dentro, tudo preso ao .site-footer", () => {
    const { fora, seletores } = partes("public/css/rodape-desktop.css");
    expect(fora).toBe("");
    for (const s of seletores) expect(s).toMatch(/^\.site-footer\b/);
  });

  test("rodapé no celular e no tablet (rodape.css): só abaixo de 1024px, preso ao .site-footer e igual ao da home (landing.css)", () => {
    // regras de primeiro nível de um CSS: [{ sel, corpo }] (um @media vem inteiro, com as regras dentro)
    const regras = css => {
      css = semComentarios(css); const res = []; let i = 0;
      for (let a = css.indexOf("{", i); a >= 0; a = css.indexOf("{", i)) {
        let prof = 1, j = a + 1; while (prof && j < css.length) { if (css[j] === "{") prof++; else if (css[j] === "}") prof--; j++; }
        res.push({ sel: css.slice(i, a).trim(), corpo: css.slice(a + 1, j - 1) }); i = j;
      }
      return res;
    };
    const seletor = s => s.split(",").map(x => x.trim().replace(/^\.site-footer (?=\S)/, "")).join(", ");
    const decls = corpo => corpo.split(";").map(d => d.trim().replace(/\s+/g, " ")).filter(Boolean);

    const topo = regras(ler("public/css/rodape.css"));
    expect(topo.map(r => r.sel)).toEqual(["@media (max-width: 1023.98px)"]);
    const dentro = regras(topo[0].corpo);
    for (const r of dentro) for (const s of r.sel.split(",")) expect(s.trim()).toMatch(/^\.site-footer\b/);
    const meu = Object.fromEntries(dentro.map(r => [seletor(r.sel), decls(r.corpo)]));

    // cada regra de rodapé de landing.css (fora dos @media) está em rodape.css com as mesmas declarações
    const daHome = regras(ler("public/css/landing.css")).filter(r => !r.sel.startsWith("@") && /(^|,\s*)\.(site-footer|footer__)/.test(r.sel));
    expect(daHome.length).toBeGreaterThan(15);
    for (const r of daHome) {
      const s = seletor(r.sel);
      expect([s, meu[s] !== undefined]).toEqual([s, true]);
      for (const d of decls(r.corpo)) expect([s, meu[s]]).toEqual([s, expect.arrayContaining([d])]);
    }
    // a única coisa a mais: a fonte do body da home, que nas outras páginas é outra
    expect(meu[".site-footer"]).toContain("font-family: var(--font-body)");

    // carregado só nas três páginas, logo antes de rodape-desktop.css; a home usa landing.css
    for (const v of ["sobre", "para-devs", "para-empresas"]) {
      const s = ler(`views/${v}.ejs`);
      expect([v, s.indexOf('href="/css/rodape.css"') > -1]).toEqual([v, true]);
      expect(s.indexOf('href="/css/rodape-desktop.css"')).toBeGreaterThan(s.indexOf('href="/css/rodape.css"'));
    }
    expect(ler("views/index.ejs")).not.toMatch(/href="\/css\/rodape\.css"/);
    expect(ler("views/partials/rodape.ejs")).not.toMatch(/soDesktop|so-desktop/);
  });

  test("FAQ comum: nada fora do @media (abaixo de 1024px vale o FAQ da home, de landing.css); dentro, tudo preso ao .faq", () => {
    const { fora, seletores } = partes("public/css/faq-desktop.css");
    expect(fora).toBe("");
    for (const s of seletores) expect(s).toMatch(/^\.faq\b/);
  });

  test("Para Devs: fora do @media, só esconde o bloco de desktop; dentro, só o bloco e a versão antiga", () => {
    const { fora, seletores } = partes("public/css/para-devs-desktop.css");
    expect(fora).toBe(".layout-desktop { display: none; }");
    for (const s of seletores) expect(s).toMatch(/^(\.layout-desktop\b|\.layout-padrao$)/);
  });

  test("Para Empresas: nada fora do @media; dentro, só o bloco de desktop", () => {
    const { fora, seletores } = partes("public/css/para-empresas-desktop.css");
    expect(fora).toBe("");
    expect(seletores.length).toBeGreaterThan(10);
    for (const s of seletores) expect(s).toMatch(/^\.layout-desktop\b/);
  });

  test("Sobre: fora do @media, só esconde o bloco de desktop; dentro, só o bloco, a versão antiga e o body", () => {
    const { fora, seletores } = partes("public/css/sobre-desktop.css");
    expect(fora).toBe(".layout-desktop { display: none; }");
    for (const s of seletores) expect(s).toMatch(/^(\.layout-desktop\b|\.layout-padrao$|body$)/);
  });
});

describe("Home", () => {
  const view = ler("views/index.ejs");
  const html = render("index", { stats });

  test("carrega o CSS de desktop depois de landing.css e marca a página", () => {
    expect(view.indexOf('href="/css/home-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/landing.css"'));
    expect(view.indexOf('href="/css/rodape-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/landing.css"'));
    expect(html).toMatch(/<body class="home">/);
  });

  test("desktop ganha \"Conhecer planos\" e o texto do protótipo; um FAQ só (o do main), em todas as larguras", () => {
    expect(html).toMatch(/<a href="\/cadastro\?next=%2Fplanos" class="hero__planos">Conhecer planos<\/a>/);
    expect(html).toMatch(/<a href="\/cadastro\?next=%2Fperfil" class="btn-primary btn-primary--purple">/);
    expect(html).toMatch(/class="section-desc experiences__desc-desktop">Seja você desenvolvedor ou empresa/);
    expect(html.match(/<section class="faq"/g)).toHaveLength(1);
    expect(html.match(/<details class="faq__item">/g)).toHaveLength(6);
    expect(html).not.toMatch(/<section class="cta-final"/);
  });

  test("o texto dos títulos não é partido em pedaços (mudaria o desenho no celular)", () => {
    expect(view).toMatch(/<span class="hero__verde">vaga de <\/span><mark class="mark-teal">estágio\.<\/mark>/);
    expect(view).toMatch(/<h2 id="how-title">Entenda como funciona\.<\/h2>/);
    expect(view).toMatch(/<h2 id="stats-title">Resultados que conectam talentos e oportunidades\.<\/h2>/);
  });

  test("rodapé vem do partial, sem a classe de \"só desktop\"", () => {
    expect(html.match(/<footer class="site-footer"/g)).toHaveLength(1);
    expect(html).not.toMatch(/site-footer--so-desktop/);
    expect(html).toMatch(/<a href="\/#como-funciona">Como Funciona<\/a>/);
    // na home o link FAQ vai para o FAQ da própria página
    expect(html).toMatch(/<a href="#faq">FAQ<\/a>/);
    expect(html).toMatch(/<section class="faq" id="faq"/);
  });
});

describe("FAQ da home (o do main; no desktop, com o desenho do protótipo)", () => {
  const html = render("index", { stats });
  const pares = [...html.matchAll(/<summary class="faq__question">([^<]+)<span class="faq__icon" aria-hidden="true">\+<\/span><\/summary>\s*<p class="faq__answer">([^<]+)<\/p>/g)]
    .map(m => [m[1], m[2]]);
  const resposta = q => (pares.find(([p]) => p === q) || [])[1];

  test("as seis perguntas do protótipo, na ordem", () => {
    expect(pares.map(([p]) => p)).toEqual([
      "A Ápice é realmente gratuita para desenvolvedores?",
      "Como funciona o cálculo de match com as vagas?",
      "Preciso ter um GitHub público para usar a plataforma?",
      "O que é o roadmap de carreira personalizado?",
      "Posso usar a Ápice se ainda não tenho experiência profissional?",
      "Como as empresas publicam vagas na plataforma?",
    ]);
  });

  test("o que as respostas prometem continua valendo no produto", () => {
    const { PLANS } = require("../config/plans");
    // grátis para o dev; o mentor é do PRO
    expect(PLANS.dev_free.price_cents).toBe(0);
    expect(PLANS.dev_pro.features.mentor_carreira).toBe(true);
    expect(resposta("A Ápice é realmente gratuita para desenvolvedores?")).toMatch(/gratuitos no plano FREE/);
    // match: conta as skills da vaga que o dev tem (GitHub, declaradas, módulos do roadmap), e o nível entra na conta
    const match = ler("services/matchCalculator.js");
    expect(match).toMatch(/Skills\s+= skills da vaga que o dev tem ÷ total de skills da vaga/);
    expect(match).toMatch(/Match\s+= Skills × 70% \+ Senioridade × 30%/);
    expect(match).toMatch(/re\.status = 'concluida'/);
    expect(resposta("Como funciona o cálculo de match com as vagas?")).toMatch(/conta quantas das skills pedidas você já tem \(detectadas no GitHub, declaradas no perfil ou aprendidas nos módulos do roadmap\), e o seu nível de experiência também entra na conta/);
    // GitHub opcional no cadastro, e dá para declarar skills no perfil
    expect(ler("views/cadastro.ejs")).toMatch(/Usuário GitHub <span class="opt">\(opcional\)<\/span>/);
    expect(ler("controllers/profileController.js")).toMatch(/user_skill_declaracoes/);
    // empresas: 1 vaga no FREE, ilimitadas no PRO
    expect(PLANS.empresa_free.max_active_jobs).toBe(1);
    expect(PLANS.empresa_premium.max_active_jobs).toBeNull();
    expect(resposta("Como as empresas publicam vagas na plataforma?")).toMatch(/O plano FREE permite uma vaga ativa; o PRO amplia esse limite\./);
  });

  test("no desktop o \"+\" do texto some e o quadrado é desenhado; aberto, vira o losango verde", () => {
    const css = ler("public/css/faq-desktop.css");
    expect(css).toMatch(/\.faq \.faq__icon \{\s*position: relative;\s*font-size: 0;/);
    expect(css).toMatch(/\.faq \.faq__item\[open\] \.faq__icon \{\s*transform: rotate\(45deg\);\s*background: var\(--sup-59e435-a16\);\s*border-color: var\(--teal\);/);
    expect(ler("public/css/home-desktop.css")).toMatch(/\.home \.faq__item\[open\] \{ min-height: calc\(256 \* var\(--u\)\); \}/);
  });
});

describe("Sobre", () => {
  const view = ler("views/sobre.ejs");
  const html = render("sobre", { currentPage: "sobre", stats, viewer: "visitante", user: null });
  const bloco = (cls) => {
    const i = html.indexOf(`<div class="${cls}">`);
    expect(i).toBeGreaterThan(-1);
    const fim = { "layout-padrao": '<div class="layout-tablet">', "layout-tablet": '<div class="layout-desktop">', "layout-desktop": '<div id="contato">' }[cls];
    return html.slice(i, html.indexOf(fim, i));
  };
  const textos = trecho => trecho.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  test("o media de sobre.css continua o de antes (celular e desktop); o desktop desfaz o que não vale lá", () => {
    expect(view).toMatch(/href="\/css\/sobre\.css" media="not all and \(min-width: 768px\) and \(max-width: 1023\.98px\)"/);
    expect(view.indexOf('href="/css/sobre-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/sobre.css"'));
  });

  test("bloco de desktop com os mesmos textos da versão do celular, e sem a seção \"Quem constrói a Ápice\"", () => {
    const padrao = bloco("layout-padrao"), desktop = bloco("layout-desktop");
    expect(html).not.toMatch(/Quem constrói a Ápice|team-section|team-card/);
    for (const trecho of [
      "A Ápice é uma plataforma para desenvolvedores em início de carreira",
      "Foi pra reduzir essa distância — entre quem estuda tecnologia e quem contrata — que a Ápice foi criada.",
      "Leitura automática do seu código e stack tecnológica",
      "Escolha a experiência ideal e descubra como a Ápice pode conectar",
    ]) {
      expect(textos(padrao)).toContain(trecho);
      expect(textos(desktop)).toContain(trecho);
    }
    expect(desktop.match(/<span class="pillar-tag">FIG 0\.\d<\/span>/g)).toHaveLength(4);
  });

  test("rodapé em todas as larguras, depois do conteúdo", () => {
    expect(html.match(/<footer class="site-footer"/g)).toHaveLength(1);
    expect(html).not.toMatch(/site-footer--so-desktop/);
    expect(html.indexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
  });
});

describe("Para Devs", () => {
  const view = ler("views/para-devs.ejs");
  const pro = precosPro("dev_pro");
  const html = render("para-devs", { currentPage: "para-devs", prices: { free: 0, pro, maxParcelas: MAX_PARCELAS_ANUAL }, cardsPlanos: cardsPlano("dev_pro") });
  const desktop = html.slice(html.indexOf('<div class="layout-desktop">'), html.indexOf("</main>"));
  const tablet = html.slice(html.indexOf('<div class="layout-tablet">'), html.indexOf('<div class="layout-desktop">'));
  const respostas = Object.fromEntries([...desktop.matchAll(/<summary>([^<]+)<span class="faq__icon" aria-hidden="true"><\/span><\/summary>\s*<p>([^<]+)<\/p>/g)].map(m => [m[1], m[2]]));

  test("o media de para-devs.css continua o de antes; o FAQ comum vem antes do CSS da página", () => {
    expect(view).toMatch(/href="\/css\/para-devs\.css" media="not all and \(min-width: 768px\) and \(max-width: 1023\.98px\)"/);
    expect(view.indexOf('href="/css/faq-desktop.css"')).toBeLessThan(view.indexOf('href="/css/para-devs-desktop.css"'));
    expect(view.indexOf('href="/css/para-devs-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/para-devs.css"'));
  });

  test("cards PRO mensal e anual iguais aos de /planos, com os preços do config/plans.js", () => {
    const plano = getPlan("dev_pro");
    expect(annualMonthlyCents(plano) * 12).toBe(plano.annual_price_cents);
    for (const trecho of [desktop, tablet]) {
      expect(trecho).toContain('class="plan-card plan-card--empresa"');
      expect(trecho).toContain(`R$${pro.mensal}<span>/mês</span>`);
      expect(trecho).toContain(`R$${pro.anual}<span>/mês</span><small class="plan-total-anual">Ou R$${pro.anualTotal} à vista</small>`);
      expect(trecho).toMatch(/<p class="plan-tag">\d+% Desconto<\/p>/);
      expect(trecho).toContain("/planos/dev_pro/assinar?periodo=anual");
    }
  });

  test("o preço e a nota do anual só aparecem com o Anual marcado (sem JavaScript)", () => {
    const css = semComentarios(ler("public/css/para-devs-desktop.css"));
    expect(css).toMatch(/\.layout-desktop \.pd-preco-anual,\s*\.layout-desktop \.pd-plan__cobranca \{ display: none; \}/);
    expect(css).toMatch(/\.layout-desktop \.pd-plan--pro:has\(input\[value="anual"\]:checked\) \.pd-preco-mensal \{ display: none; \}/);
    expect(css).toMatch(/:has\(input\[value="anual"\]:checked\) \.pd-preco-anual,\s*\.layout-desktop \.pd-plan--pro:has\(input\[value="anual"\]:checked\) \.pd-plan__cobranca \{ display: block; \}/);
  });

  test("o seletor não se destaca com o mouse: sem hover, sem transição, clique duplo não seleciona", () => {
    const css = semComentarios(ler("public/css/para-devs-desktop.css"));
    const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].includes(".pd-periodo"));
    expect(regras.length).toBeGreaterThan(3);
    for (const [, seletor, corpo] of regras) {
      expect(seletor).not.toMatch(/:hover|:active/);
      expect(corpo).not.toMatch(/transition/);
    }
    // só a opção marcada tem borda; o anel de foco só aparece pelo teclado
    expect(regras.filter(([, s, c]) => /border-color/.test(c)).map(([, s]) => s.trim())).toEqual([".layout-desktop .pd-periodo label:has(input:checked)"]);
    expect(css).toMatch(/\.layout-desktop \.pd-periodo label:has\(input:focus-visible\) \{ outline:/);
    expect(css).toMatch(/\.layout-desktop \.pd-periodo label \{[^}]*\buser-select: none;/);
  });

  test("verificação de projetos é automática (não é feita por IA)", () => {
    // o serviço analisa o repositório no GitHub, sem chamar a IA
    const servico = ler("services/roadmapService.js");
    expect(servico).toMatch(/verificarHabilidadesNoRepo/);
    expect(servico).not.toMatch(/geminiClient|askGemini/);
    expect(desktop).not.toMatch(/verificação de projetos por IA|A IA analisa/i);
    expect(desktop).toMatch(/Verificação Automática de Projetos/);
    // nenhuma das outras telas que listam o recurso (layout mobile de para-devs, planos) promete IA
    expect(ler("views/para-devs.ejs")).not.toMatch(/verificação de projetos por IA|A IA analisa/i);
    expect(ler("views/planos.ejs")).not.toMatch(/verificação de projetos por IA/i);
    expect(ler("views/planos.ejs")).toMatch(/Verificação automática de projetos/);
    expect(respostas["Como funciona a verificação automática de projetos?"]).toMatch(/A plataforma analisa o repositório/);
  });

  test("FAQ: seis perguntas, e o que as respostas prometem vale no produto", () => {
    const { PLANS } = require("../config/plans");
    expect(Object.keys(respostas)).toHaveLength(6);
    // regeneração: 1 por semana no PRO, 1 por mês no Free (por roadmap), sem IA
    expect(PLANS.dev_pro.roadmap.regen_intervalo_dias).toBe(7);
    expect(PLANS.dev_free.roadmap.regen_intervalo_dias).toBe(30);
    expect(respostas["Quando posso regerar o meu roadmap novamente?"]).toMatch(/uma vez por semana; no Free, uma vez por mês/);
    // o limite só é checado na regeneração (criar um roadmap não gasta)
    expect(ler("middlewares/roadmapLimites.js")).toMatch(/async function limiteRegeneracao\(req, res, next\)/);
    expect(respostas["Roadmaps do modelo de reserva gastam meu limite de regeneração?"]).toMatch(/^Não\. Os roadmaps padrão ou do modelo de reserva não consomem/);
    expect(respostas["Roadmaps do modelo de reserva gastam meu limite de regeneração?"]).not.toMatch(/\bIA\b/);
    // cancelar/rebaixar: acesso até o fim do período pago
    expect(ler("services/subscriptionService.js")).toMatch(/status IN \('paused','cancelled'\) AND paid_until > UTC_TIMESTAMP\(\)/);
    expect(respostas["Posso cancelar a assinatura a qualquer momento?"]).toMatch(/até a data de término do ciclo atual/);
    expect(respostas["O que acontece se eu fizer downgrade do PRO para o FREE?"]).toMatch(/até o fim do período já faturado/);
    // pagamento: cartão pelo Mercado Pago; mensal automático, anual pago de uma vez
    expect(ler("services/mpAnnual.js")).toMatch(/PAGAMENTO ÚNICO/);
    expect(respostas["Quais são as formas de pagamento aceitas?"]).toBe(`Aceitamos pagamentos via Cartão de Crédito, pelo Mercado Pago. No mensal, a cobrança é automática, todo mês; no anual, o ano é pago de uma vez, à vista ou em até ${MAX_PARCELAS_ANUAL}x.`);
  });

  test("rodapé em todas as larguras, e o link FAQ do rodapé acha o FAQ visível", () => {
    expect(html.match(/<footer class="site-footer"/g)).toHaveLength(1);
    expect(html).not.toMatch(/site-footer--so-desktop/);
    expect(html).toMatch(/document\.querySelectorAll\('\[id\^="faq-title"\]'\)/);
    expect(html).toMatch(/<h2 id="faq-title-desktop">FAQ<\/h2>/);
  });
});

describe("Para Empresas", () => {
  const free = getPlan("empresa_free"), premium = getPlan("empresa_premium");
  const precos = precosPro("empresa_premium");
  // os mesmos dados que a rota /para-empresas (server.js) monta
  const planos = { free: { vagas: free.max_active_jobs }, premium: precos, maxParcelas: MAX_PARCELAS_ANUAL };
  const view = ler("views/para-empresas.ejs");
  const html = render("para-empresas", { currentPage: "para-empresas", planos, cardsPlanos: cardsPlano("empresa_premium") });
  const desktop = html.slice(html.indexOf('<div class="layout-desktop">'), html.indexOf("</main>"));
  const tablet = html.slice(html.indexOf('<div class="layout-tablet">'), html.indexOf('<div class="layout-desktop">'));
  const respostas = Object.fromEntries([...desktop.matchAll(/<summary>([^<]+)<span class="faq__icon" aria-hidden="true"><\/span><\/summary>\s*<p>([^<]+)<\/p>/g)].map(m => [m[1], m[2]]));

  test("mesmo modelo da Para Devs: os CSS de desktop vêm depois dos de antes, e o media de para-devs.css não muda", () => {
    expect(view).toMatch(/href="\/css\/para-devs\.css" media="not all and \(min-width: 768px\) and \(max-width: 1023\.98px\)"/);
    const pos = f => view.indexOf(`href="/css/${f}"`);
    expect(pos("para-devs-tablet.css")).toBeLessThan(pos("faq-desktop.css"));
    expect(pos("faq-desktop.css")).toBeLessThan(pos("para-devs-desktop.css"));
    expect(pos("para-devs-desktop.css")).toBeLessThan(pos("para-empresas-desktop.css"));
  });

  test("planos e limites do config/plans.js (Free e PRO), sem o Básico, e nada que o produto não tenha", () => {
    expect(getPlan("empresa_basico")).toBeFalsy();
    expect(premium.name).toBe("PRO");
    expect(premium.max_active_jobs).toBeNull();
    expect(desktop).toMatch(/<h2 class="plan-name" id="pc-nome-desktop-0">Plano PRO<\/h2>/);
    expect(desktop).toMatch(/<h2 id="why-title-desktop">Por que evoluir para o Empresa PRO\?<\/h2>/);
    expect(desktop).toContain("<li>Vagas ativas ilimitadas</li>");
    expect(html).not.toMatch(/Básico|Premium|\[object Object\]|undefined/);
    // promessas do protótipo sem recurso no produto
    expect(desktop).not.toMatch(/dias de exposição|compatibilidade por IA|triagem automática por IA|pontuação/i);
  });

  test("cards PRO mensal e anual iguais aos de /planos, com os preços do config/plans.js", () => {
    expect(annualMonthlyCents(premium) * 12).toBe(premium.annual_price_cents);
    for (const trecho of [desktop, tablet]) {
      expect(trecho).toContain('class="plan-card plan-card--empresa"');
      expect(trecho).toContain(`R$${precos.mensal.replace(".", ",")}<span>/mês</span>`);
      expect(trecho).toContain(`R$${precos.anual}<span>/mês</span><small class="plan-total-anual">Ou R$${precos.anualTotal} à vista</small>`);
      expect(trecho).toContain("/planos/empresa_premium/assinar?periodo=anual");
    }
  });

  test("o tablet renderiza com os dados novos: Plano PRO, preço mensal e sem a nota do Básico", () => {
    expect(tablet).toMatch(/<h3 class="plan-name" id="pc-nome-tablet-0">Plano PRO<\/h3>/);
    expect(tablet).not.toMatch(/pd-plans__nota/);
    expect(ler("public/css/para-devs-tablet.css")).toMatch(/\.pd-empresa \.pd-plans \{ grid-template-columns: 324px 320px; padding-bottom: 63px; \}/);
  });

  test("FAQ: seis perguntas na ordem do protótipo, e o que as respostas prometem vale no produto", () => {
    expect(Object.keys(respostas)).toEqual([
      "O que acontece se eu atingir o limite de vagas do plano FREE?",
      "Como é calculada a compatibilidade do candidato com a vaga?",
      "Como funciona a renovação e o cancelamento do plano pago?",
      "Posso cancelar ou mudar de plano a qualquer momento?",
      "Como funciona a triagem automática?",
      "Quais são as formas de pagamento aceitas?",
    ]);
    // no limite, o aviso manda desativar uma vaga ou fazer upgrade
    expect(ler("controllers/empresaController.js")).toMatch(/Desative outra vaga ou faça upgrade para publicar mais\./);
    expect(respostas["O que acontece se eu atingir o limite de vagas do plano FREE?"]).toBe("Você receberá um aviso na tela para desativar uma vaga ou fazer o upgrade para o plano PRO, que libera vagas ilimitadas simultâneas.");
    // compatibilidade: fórmula da plataforma (skills e senioridade), não IA
    const match = ler("services/matchCalculator.js");
    expect(match).toMatch(/Match\s+= Skills × 70% \+ Senioridade × 30%/);
    expect(match).toMatch(/Senioridade = 100 se o nível do dev atende ao da vaga/);
    for (const q of ["Como é calculada a compatibilidade do candidato com a vaga?", "Como funciona a triagem automática?"]) {
      expect(respostas[q]).toMatch(/^A plataforma /);
      expect(respostas[q]).toMatch(/GitHub ou declaradas no perfil/);
    }
    // resumo por IA: só no plano pago
    expect(ler("routes/empresa.js")).toMatch(/requirePlan\("empresa_premium"/);
    expect(respostas["Como funciona a triagem automática?"]).toMatch(/No PRO, cada candidatura também ganha um resumo gerado por IA\.$/);
    // mensal renova sozinho; anual vale 12 meses e não renova; cancelar mantém o acesso até o fim do pago
    expect(ler("services/mpAnnual.js")).toMatch(/Não renova sozinho/);
    expect(ler("config/plans.js")).toMatch(/const MESES_PLANO_ANUAL\s+= 12;/);
    expect(ler("routes/assinaturas.js")).toMatch(/router\.put\("\/cancelar"/);
    expect(ler("services/subscriptionService.js")).toMatch(/status IN \('paused','cancelled'\) AND paid_until > UTC_TIMESTAMP\(\)/);
    expect(respostas["Como funciona a renovação e o cancelamento do plano pago?"]).toMatch(/^No mensal, a renovação é feita de forma automática, todo mês; o anual libera o plano por 12 meses e não renova sozinho\./);
    expect(respostas["Como funciona a renovação e o cancelamento do plano pago?"]).toMatch(/mantendo o acesso até o final do período já pago\.$/);
    expect(respostas["Posso cancelar ou mudar de plano a qualquer momento?"]).toMatch(/^Sim\. A assinatura mensal pode ser cancelada a qualquer momento/);
    // pagamento
    expect(respostas["Quais são as formas de pagamento aceitas?"]).toBe(`Aceitamos pagamentos via Cartão de Crédito, pelo Mercado Pago. No mensal, a cobrança é automática, todo mês; no anual, o ano é pago de uma vez, à vista ou em até ${MAX_PARCELAS_ANUAL}x.`);
  });

  test("rodapé em todas as larguras", () => {
    expect(html.match(/<footer class="site-footer"/g)).toHaveLength(1);
    expect(html).not.toMatch(/site-footer--so-desktop/);
  });
});
