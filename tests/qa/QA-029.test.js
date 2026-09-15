// QA-029 — Empate de z-index entre a pill de navegação e o modal de
// repositórios. `.bottom-nav` (header.css) e `.modal-backdrop`
// (repositorios.ejs, via repositorios.css) tinham exatamente o mesmo
// z-index: 300 — "funcionava" só porque o modal vem depois no DOM (empate
// resolvido por ordem de pintura), uma coincidência frágil. Corrigido dando
// ao .modal-backdrop um z-index explicitamente maior (310), removendo a
// dependência da ordem do DOM.
const fs = require('fs');
const path = require('path');

const headerCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'header.css'),
  'utf8'
);
const reposCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'repositorios.css'),
  'utf8'
);

function zIndexOf(css, selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g');
  let match;
  while ((match = re.exec(css)) !== null) {
    const m = match[0].match(/z-index:\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

describe('QA-029 — .modal-backdrop não empata mais de z-index com .bottom-nav', () => {
  test('.modal-backdrop tem z-index maior que .bottom-nav, sem depender da ordem do DOM', () => {
    const bottomNav = zIndexOf(headerCss, '.bottom-nav');
    const backdrop  = zIndexOf(reposCss, '.modal-backdrop');

    expect(bottomNav).not.toBeNull();
    expect(backdrop).not.toBeNull();
    expect(backdrop).toBeGreaterThan(bottomNav);
  });
});
