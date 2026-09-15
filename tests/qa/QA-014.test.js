// QA-014 — Dropdown de skills da vaga não é operável só com teclado
// Os itens do dropdown de autocomplete só tinham addEventListener('click', ...)
// — sem tabindex, sem role="option", sem handler de Enter/Espaço. Um usuário
// que navega só por teclado não conseguia selecionar nenhum resultado.
const fs = require('fs');
const path = require('path');

const VIEW_PATH = path.join(__dirname, '..', '..', 'views', 'empresa-vaga-form.ejs');
const content = fs.readFileSync(VIEW_PATH, 'utf8');

describe('QA-014 — dropdown de skills operável por teclado', () => {
  test('os containers <ul> do dropdown têm role="listbox"', () => {
    expect(content).toMatch(/id="dropdown-required"\s+role="listbox"/);
    expect(content).toMatch(/id="dropdown-desired"\s+role="listbox"/);
  });

  test('os itens gerados por updateDropdown() têm role="option" e tabindex="0"', () => {
    const match = content.match(/function updateDropdown\(type, query\) \{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    const body = match[0];

    expect(body).toMatch(/role="option" tabindex="0"/);
  });

  test('há um handler de keydown que responde a Enter e Espaço selecionando o item', () => {
    const match = content.match(/function updateDropdown\(type, query\) \{[\s\S]*?\n  \}/);
    const body = match[0];

    expect(body).toMatch(/addEventListener\("keydown",\s*e\s*=>\s*\{[\s\S]*?e\.key === "Enter"[\s\S]*?e\.key === " "[\s\S]*?\}\);/);
  });
});
