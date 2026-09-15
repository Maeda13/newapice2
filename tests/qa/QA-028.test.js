// QA-028 — Painel de informações da conversa (mobile) fica atrás do
// cabeçalho fixo. Em @media (max-width: 980px), .msg-info-panel virava
// position: fixed; inset: 0; z-index: 150 — menor que .site-header
// { z-index: 200 } (header.css), sempre presente na mesma página. O painel
// deveria ser um slide-over de tela cheia, mas o cabeçalho fixo do site
// ficava visualmente por cima do topo dele. A regra vive em
// public/css/mensagens.css, compartilhada por mensagens.ejs e
// empresa-mensagens.ejs. Corrigido subindo o z-index para 210.
const fs = require('fs');
const path = require('path');

const mensagensCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'mensagens.css'),
  'utf8'
);
const headerCss = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'header.css'),
  'utf8'
);

// Pega o primeiro bloco do seletor que de fato define z-index — o mesmo
// seletor pode ter uma regra base (sem z-index) e uma dentro de @media.
function zIndexOf(css, selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g');
  let match;
  while ((match = re.exec(css)) !== null) {
    const m = match[0].match(/z-index:\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

describe('QA-028 — .msg-info-panel (mobile) fica acima do cabeçalho fixo', () => {
  test('.msg-info-panel tem z-index maior que .site-header no estado mobile', () => {
    const panel  = zIndexOf(mensagensCss, '.msg-info-panel');
    const header = zIndexOf(headerCss, '.site-header');

    expect(panel).not.toBeNull();
    expect(header).not.toBeNull();
    expect(panel).toBeGreaterThan(header);
  });
});
