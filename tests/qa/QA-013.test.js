// QA-013 — Botões de status do roadmap não travam durante a requisição
// `updateStatus(skillId, status, btn)` não desabilitava o botão clicado,
// diferente de praticamente toda outra ação de escrita no app. Cliques
// duplos disparavam PATCHs sobrepostos para o mesmo skill. Corrigido
// desabilitando o botão no início e reabilitando em `finally`, mesmo
// padrão já usado em outros botões do app (ex: confirmDelete em
// empresa-vagas.ejs/empresa-dashboard.ejs).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
// Normaliza CRLF -> LF (o arquivo usa quebras de linha do Windows).
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8').replace(/\r\n/g, '\n');

describe('QA-013 — updateStatus() trava o botão durante a requisição', () => {
  test('desabilita o botão logo no início da função', () => {
    const content = readView('roadmap.ejs');
    const match = content.match(/async function updateStatus\(skillId, status, btn\) \{([\s\S]*?)\n\s*\}\n/);
    expect(match).not.toBeNull();

    const body = match[1];
    const disableIdx = body.indexOf('btn.disabled = true;');
    const tryIdx     = body.indexOf('try {');

    expect(disableIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(disableIdx).toBeLessThan(tryIdx);
  });

  test('reabilita o botão num bloco finally', () => {
    const content = readView('roadmap.ejs');
    expect(content).toMatch(/\}\s*catch\s*\(err\)\s*\{\s*console\.error\("Erro ao atualizar status:", err\);\s*\}\s*finally\s*\{\s*btn\.disabled = false;\s*\}/);
  });
});
