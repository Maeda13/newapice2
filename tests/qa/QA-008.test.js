// QA-008 — Escape de aspas incompleto em atributos onclick gerados por string
// Padrão `onclick="fn(${id}, '${title.replace(/'/g,"\\'")}')"` só escapa a
// aspa simples; como o atributo é delimitado por aspas duplas, um valor com
// `"` quebra o HTML gerado. A correção troca por addEventListener + closure,
// eliminando o problema por completo (nenhuma interpolação de string de
// usuário dentro de um atributo HTML).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

// O padrão vulnerável: interpolação de uma string de usuário (com só a
// aspa simples escapada) dentro de um atributo onclick gerado via template
// literal.
const VULNERABLE_PATTERN = /onclick="[^"]*\$\{[^}]*\.replace\(\/'\/g/;

describe('QA-008 — onclick com escape de aspas incompleto foi eliminado', () => {
  test.each([
    'empresa-dashboard.ejs',
    'empresa-vagas.ejs',
    'empresa-vaga-form.ejs',
    'admin-configuracoes.ejs',
  ])('%s não contém mais o padrão onclick + replace(/\'/g...)', (file) => {
    const content = readView(file);
    expect(content).not.toMatch(VULNERABLE_PATTERN);
  });

  test('empresa-vagas.ejs e empresa-dashboard.ejs usam addEventListener para excluir vaga', () => {
    for (const file of ['empresa-vagas.ejs', 'empresa-dashboard.ejs']) {
      const content = readView(file);
      expect(content).toMatch(/btn-delete-vaga["'][^>]*>[\s\S]*?addEventListener\("click",\s*\(\)\s*=>\s*openDeleteModal\(job\.id,\s*job\.title\)\)/);
    }
  });

  test('admin-configuracoes.ejs usa addEventListener para recursos/excluir skill', () => {
    const content = readView('admin-configuracoes.ejs');
    expect(content).toContain('addEventListener("click", () => toggleResources(s.id, s.name))');
    expect(content).toContain('addEventListener("click", () => deleteSkill(s.id, s.name))');
  });

  test('empresa-vaga-form.ejs usa addEventListener para remover tag', () => {
    const content = readView('empresa-vaga-form.ejs');
    expect(content).toContain('btn.addEventListener("click", () => removeTag(formTags[i]))');
  });
});
