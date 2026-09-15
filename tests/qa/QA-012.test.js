// QA-012 — Troca rápida de conversa pode misturar mensagens de duas conversas
// `selectConversation(id)` chamava `renderThreadMessages(messages)` assim que
// a resposta do fetch chegava, sem checar se `id` ainda é a conversa ativa.
// Clicar rápido entre A e B, com a resposta de A chegando depois da de B
// (rede fora de ordem), fazia a tela mostrar as mensagens de A rotulada como
// conversa de B. Não há ambiente jsdom configurado neste projeto (Jest usa
// testEnvironment "node" por padrão, sem jest-environment-jsdom instalado),
// então o teste inspeciona a ordem do código-fonte: a guarda precisa vir
// depois do `await res.json()` e antes de `renderThreadMessages(messages)`.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

// Captura o corpo de selectConversation(id) até o fechamento do try{...} —
// não usa `s` (dotAll) pra não vazar pro resto do arquivo por engano.
const SELECT_CONVERSATION_TRY_BLOCK =
  /async function selectConversation\(id\)[\s\S]*?try \{([\s\S]*?)\} catch/;

describe('QA-012 — guarda contra race condition ao trocar de conversa rápido', () => {
  test.each(['mensagens.ejs', 'empresa-mensagens.ejs'])(
    '%s: guarda vem depois do fetch e antes de renderThreadMessages',
    (file) => {
      const content = readView(file);
      const match = content.match(SELECT_CONVERSATION_TRY_BLOCK);
      expect(match).not.toBeNull();

      const tryBody = match[1];
      const jsonIdx   = tryBody.indexOf('await res.json()');
      const guardIdx  = tryBody.indexOf('if (id !== activeConversationId) return;');
      const renderIdx = tryBody.indexOf('renderThreadMessages(messages)');

      expect(jsonIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(renderIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(jsonIdx);
      expect(renderIdx).toBeGreaterThan(guardIdx);
    }
  );
});
