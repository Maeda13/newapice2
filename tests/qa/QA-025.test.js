// QA-025 — Menu flutuante do mobile fica por cima do próprio drawer que
// deveria escondê-lo. `.bottom-nav { z-index: 300 }` ficava acima de
// `.mobile-drawer { z-index: 260 }` e `.drawer-overlay { z-index: 250 }`,
// então a pill de navegação continuava visível por cima do drawer aberto
// e do seu overlay escuro. Corrigido baixando `.bottom-nav` para abaixo de
// 250 (240), como recomendado no achado.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'header.css'),
  'utf8'
);

function zIndexOf(selector) {
  const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`));
  if (!block) return null;
  const m = block[0].match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

describe('QA-025 — .bottom-nav fica abaixo do drawer mobile e seu overlay', () => {
  test('.bottom-nav tem z-index menor que .drawer-overlay e .mobile-drawer', () => {
    const bottomNav = zIndexOf('.bottom-nav');
    const overlay    = zIndexOf('.drawer-overlay');
    const drawer     = zIndexOf('.mobile-drawer');

    expect(bottomNav).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(drawer).not.toBeNull();

    expect(bottomNav).toBeLessThan(overlay);
    expect(bottomNav).toBeLessThan(drawer);
  });
});
