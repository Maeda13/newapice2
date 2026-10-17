// QA-032 — Drawer mobile fica com links focáveis mesmo escondido (aria-hidden).
// O drawer começa a página com aria-hidden="true" (fechado), mas os links de
// navegação dentro dele nunca ganham tabindex="-1"/inert nesse estado — um
// usuário de teclado consegue Tab para dentro de um container aria-hidden,
// violação de WCAG (aria-hidden-focus, confirmada via axe-core). Corrigido
// usando o atributo nativo `inert`, alternado junto com aria-hidden em
// openDrawer()/closeDrawer(), que remove automaticamente todos os
// descendentes da ordem de tabulação sem precisar tocar em cada link.
const fs = require('fs');
const path = require('path');

// header-dev não tem mais drawer: no mobile o menu é a barra inferior (bottom-nav--dev).
const HEADER_FILES = ['header-company.ejs', 'header-admin.ejs'];
const readHeader = name => fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', 'partials', name),
  'utf8'
);

describe('QA-032 — drawer mobile usa inert para remover foco enquanto escondido', () => {
  test.each(HEADER_FILES)('%s: closeDrawer() marca o drawer como inert', (file) => {
    const content = readHeader(file);
    const closeDrawerMatch = content.match(/function closeDrawer\(\)[\s\S]*?\n\s*\}/);
    expect(closeDrawerMatch).not.toBeNull();
    expect(closeDrawerMatch[0]).toMatch(/drawer\.inert\s*=\s*true/);
  });

  test.each(HEADER_FILES)('%s: openDrawer() remove o inert do drawer', (file) => {
    const content = readHeader(file);
    const openDrawerMatch = content.match(/function openDrawer\(\)[\s\S]*?\n\s*\}/);
    expect(openDrawerMatch).not.toBeNull();
    expect(openDrawerMatch[0]).toMatch(/drawer\.inert\s*=\s*false/);
  });
});

describe('header-dev — menu mobile é a barra inferior, sem hambúrguer/drawer', () => {
  const content = readHeader('header-dev.ejs');

  test('não renderiza hambúrguer nem drawer', () => {
    expect(content).not.toMatch(/id="hamburgerBtn"/);
    expect(content).not.toMatch(/id="mobileDrawer"/);
  });

  test('a barra inferior tem Home, Roadmap, Vagas, Repositórios e Chat', () => {
    const nav = content.match(/<nav class="bottom-nav bottom-nav--dev"[\s\S]*?<\/nav>/)[0];
    for (const href of ['/dashboard', '/trilha', '/vagas', '/repositorios', '/mensagens']) {
      expect(nav).toContain(`href="${href}"`);
    }
    for (const label of ['Home', 'Roadmap', 'Vagas', 'Repositórios', 'Chat']) {
      expect(nav).toContain(`<span>${label}</span>`);
    }
  });
});
