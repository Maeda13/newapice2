// tests/empresaRevisaoUi.test.js
// Revisão de UI/UX do módulo Empresa (23/11/2026): diretrizes gerais (botões cheios
// com texto branco SemiBold, tags com contorno na cor cheia e fundo a 20%, padding,
// espaçamento no celular) e os ajustes pontuais de Dashboard, Vagas, Desenvolvedores,
// Chat e Chat em vagas.
const fs = require("fs");
const path = require("path");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const css = ler("public/css/empresa-revisao.css");

// contraste WCAG entre duas cores #rrggbb
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const razao = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe("diretrizes gerais", () => {
  test("o CSS da revisão vale em toda página da empresa (carregado depois do tema)", () => {
    const h = ler("views/partials/header-company.ejs");
    expect(h.indexOf('href="/css/empresa-revisao.css"')).toBeGreaterThan(h.indexOf('href="/css/empresa-theme.css"'));
  });

  test("botões de cor cheia: texto branco SemiBold, num verde que dá 4,5:1 com o branco", () => {
    expect(css).toMatch(/--empresa-btn-texto:\s+var\(--sob-ffffff\)/);
    const fundo = css.match(/--empresa-btn-fundo:\s+(#[0-9a-f]{6})/i)[1];
    expect(razao("#ffffff", fundo)).toBeGreaterThanOrEqual(4.5);
    const bloco = css.slice(css.indexOf(".btn-nova-vaga,"), css.indexOf(".btn-nova-vaga:hover"));
    for (const sel of [".btn-nova-vaga", ".btn-publish", ".chatv-btn", ".btn-primary", ".dev-link", ".matches-ver-todos"]) expect(bloco).toContain(sel);
    expect(bloco).toMatch(/color: var\(--empresa-btn-texto\);\s*font-weight: 600;/);
  });

  test("tags: contorno na cor cheia, fundo da mesma cor a 20%", () => {
    expect(css).toMatch(/--empresa-tag-fundo: rgba\(var\(--brand-company-rgb\), \.20\)/);
    expect(css).toMatch(/--empresa-tag-borda: var\(--brand-company\)/);
    const bloco = css.slice(css.indexOf(".vaga-status--ativa,"), css.indexOf(".vaga-status--inativa,"));
    for (const sel of [".vaga-status--ativa", ".cand-badge", ".chatv-status", ".chatv-pill", ".devs-pill", ".mt-pill", ".badge-green", ".tag-chip"]) expect(bloco).toContain(sel);
    expect(bloco).toMatch(/border: 1px solid var\(--empresa-tag-borda\);\s*background: var\(--empresa-tag-fundo\);/);
  });

  test("no celular: mais espaço entre blocos e entre componentes", () => {
    const m = css.slice(css.indexOf("/* ── 4. Celular"));
    expect(m).toMatch(/@media \(max-width: 720px\)/);
    expect(m).toMatch(/\.dash-section \{ margin-top: 40px; \}/);
    expect(m).toMatch(/\.vagas-list\s+\{ gap: 30px; \}/);
  });
});

describe("Dashboard", () => {
  const v = ler("views/empresa-dashboard.ejs");
  test("'Ver perfil' e 'Ver todos os matches' são botões", () => {
    expect(v).toContain('aria-label="Ver perfil de ${escapeHtml(dev.name)}">Ver perfil</a>');
    expect(v).toContain('id="matches-ver-todos" hidden>Ver todos os matches</a>');
    expect(css).toMatch(/\.dev-link,\s*\.matches-ver-todos \{\s*display: inline-flex;/);
  });
  test("cards de dev com a mesma altura e '-' no dado ausente", () => {
    expect(v).toContain('${dev.github ? `@${escapeHtml(dev.github)}` : "-"}');
    expect(css).toMatch(/\.dev-card \{ min-height: 196px; \}/);
    expect(css).toMatch(/-webkit-line-clamp: 2;[^}]*min-height: 2\.5em/);
  });
});

describe("Vagas", () => {
  const v = ler("views/empresa-vagas.ejs");
  test("senioridade sem tag; a tag fica no status", () => {
    expect(v).toContain('<span class="job-nivel">${LEVEL_LABEL[job.level] ?? job.level ?? "-"}</span>');
    expect(v).not.toMatch(/LEVEL_BADGE/);
    expect(v).toContain('<span class="badge ${job.active ? "badge-green" : "badge-muted"}">');
  });
  test("botões de ação com rótulo", () => {
    for (const rotulo of ["Ver vaga", "Candidaturas", "Editar", "Excluir"]) expect(v).toContain(`<span>${rotulo}</span>`);
    expect(v).toContain('<span>${job.active ? "Pausar" : "Reativar"}</span>');
  });
});

describe("Desenvolvedores", () => {
  const v = ler("views/empresa-desenvolvedores.ejs");
  test("sem skills: espaço reservado em vez de vão, e '-' sem @usuário", () => {
    expect(v).toContain('<li class="cand-chip cand-chip--vazio">Sem skills</li>');
    expect(v).toContain('<li class="skill-tag skill-tag--vazio">Sem skills detectadas</li>');
    expect(v).toContain('${c.github ? "@" + escapeHtml(c.github) : "-"}');
    expect(css).toMatch(/\.cand-skills \{ min-height: 52px;/);
  });
});

describe("Chat e Chat em vagas", () => {
  test("chat no celular: mesmas bordas laterais e contorno arredondado", () => {
    const m = css.slice(css.indexOf("/* ══ Chat (lista de conversas)"), css.indexOf("/* ══ Chat em vagas"));
    expect(m).toMatch(/\.msg-page--company \.msg-sidebar \{\s*border: 2px solid var\(--border-lite\) !important; border-radius: var\(--radius-lg\);/);
    expect(m).toMatch(/\.msg-page--company \.msg-search-row \{\s*margin: 14px 16px 0; min-height: 44px;/);
  });
  test("chat em vagas no celular: título e status em cima, botão na largura toda", () => {
    const m = css.slice(css.indexOf("/* ══ Chat em vagas"));
    expect(m).toMatch(/\.chatv-card-info, \.chatv-card-actions \{ display: contents; \}/);
    expect(m).toMatch(/\.chatv-status \{ grid-column: 2; grid-row: 1;/);
    expect(m).toMatch(/\.chatv-btn \{ grid-column: 1 \/ -1; width: 100%;/);
  });
});
