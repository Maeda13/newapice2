const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'mensagens.css'), 'utf8');

test('mensagens do dev: seta › (pop-up de participantes/favoritar) visível abaixo de 1024px', () => {
  expect(css).toMatch(/max-width:\s*1023px\)\s*\{\s*\.msg-page--dev \.msg-thread-empresa-btn\s*\{\s*display:\s*flex/);
});
