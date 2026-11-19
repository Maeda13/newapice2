// tests/mensagensLidas.test.js
// Abrir uma conversa marca as mensagens como lidas (PATCH .../read). A tela
// zerava o contador de não lidas sem conferir a resposta: se o servidor não
// marcasse (sessão vencida, erro), o contador "voltava" ao recarregar. E uma
// falha de rede virava um erro não tratado no navegador.
//
// O trecho do script de cada tela roda fora do navegador (vm), com fetch falso.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Recorta o comando que começa em `inicio` até o ";" que o fecha.
function comando(fonte, inicio) {
  const i0 = fonte.indexOf(inicio);
  if (i0 === -1) throw new Error(`não achei: ${inicio}`);
  let nivel = 0;
  for (let i = i0; i < fonte.length; i++) {
    const ch = fonte[i];
    if ("({[".includes(ch)) nivel++;
    else if (")}]".includes(ch)) nivel--;
    else if (ch === ";" && nivel === 0) return fonte.slice(i0, i + 1);
  }
  throw new Error("comando sem fim");
}

const tick = () => new Promise(r => setImmediate(r));

describe.each([["views/mensagens.ejs"], ["views/empresa-mensagens.ejs"]])("%s", (arquivo) => {
  const trecho = comando(fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8"), "fetch(`/api/messages/conversations/${id}/read`");

  function rodar(fetch) {
    const ctx = vm.createContext({ id: 5, activeConversation: { unread: 3 }, renderConvList: jest.fn(), fetch });
    vm.runInContext(trecho, ctx);
    return ctx;
  }

  test("o servidor marcou: zera o contador", async () => {
    const ctx = rodar(async () => ({ ok: true, status: 200 }));
    await tick();
    expect(ctx.activeConversation.unread).toBe(0);
    expect(ctx.renderConvList).toHaveBeenCalled();
  });

  test("o servidor não marcou: o contador continua certo", async () => {
    const ctx = rodar(async () => ({ ok: false, status: 401 }));
    await tick();
    expect(ctx.activeConversation.unread).toBe(3);
  });

  test("sem conexão: nada muda e não sobra erro sem tratamento", async () => {
    const naoTratados = [];
    const ouvir = e => naoTratados.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      const ctx = rodar(async () => { throw new TypeError("Failed to fetch"); });
      await tick(); await tick();
      expect(ctx.activeConversation.unread).toBe(3);
      expect(naoTratados).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  });
});
