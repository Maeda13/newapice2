// tests/mentorChat.test.js
// Mentor de carreira quando o Gemini falha: resposta pelo fallback
// multi-provedor, sem ferramentas, com as últimas mensagens como contexto.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));
jest.mock("../services/geminiClient", () => ({
  chatTurn: jest.fn(),
  sendFunctionResults: jest.fn(),
}));
jest.mock("../services/aiFallback", () => ({ askFallbackText: jest.fn() }));
jest.mock("../services/aiTools", () => ({
  TOOL_DECLARATIONS: [{ name: "buscarVagas" }],
  executeTool: jest.fn(),
}));
jest.mock("../services/userContextService", () => ({
  buildUserContextBlock: jest.fn().mockResolvedValue(""),
}));

const db = require("../database/db");
const { chatTurn, sendFunctionResults } = require("../services/geminiClient");
const { askFallbackText } = require("../services/aiFallback");
const { executeTool } = require("../services/aiTools");
const { ErroIA } = require("../services/iaErros");
const { sendMessage } = require("../services/mentorChat");

const ID_INSERIDO = 99;
let conversa;

// Último INSERT da resposta do mentor: [user_id, conteúdo, interaction id].
const respostaGravada = () => db.query.mock.calls.find(([sql]) => sql.includes("'assistant'"))?.[1];
const foraDoAr = () => new ErroIA("Prazo da chamada à IA esgotado.", { tipo: "tempo", temporario: true });

beforeEach(() => {
  jest.clearAllMocks();
  conversa = [];
  db.query.mockImplementation(async sql => {
    if (sql.trim().startsWith("SELECT")) return [conversa];
    if (sql.trim().startsWith("INSERT")) return [{ insertId: ID_INSERIDO }];
    return [{ affectedRows: 1 }];
  });
  askFallbackText.mockResolvedValue({ text: "Resposta do fallback.", cortada: false, provider: "groq", model: "modelo" });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("Gemini responde: grava a resposta com o interaction id e não usa o fallback", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "Olá!", functionCalls: [], cortada: false });

  await expect(sendMessage(1, 10, "iniciante", "Oi")).resolves.toBe("Olá!");
  expect(respostaGravada()).toEqual([1, "Olá!", "i-2"]);
  expect(chatTurn.mock.calls[0][0].prazo).toBeGreaterThan(Date.now());
  expect(askFallbackText).not.toHaveBeenCalled();
});

test("Gemini falha: o fallback responde com as mensagens recentes, sem ferramentas e sem interaction id", async () => {
  conversa = [
    { id: 1, role: "user", content: "Oi", gemini_interaction_id: null },
    { id: 2, role: "assistant", content: "Olá! Como posso ajudar?", gemini_interaction_id: "i-1" },
  ];
  chatTurn.mockRejectedValue(foraDoAr());

  await expect(sendMessage(1, 10, "iniciante", "Como estudar SQL?")).resolves.toBe("Resposta do fallback.");

  const pedido = askFallbackText.mock.calls[0][0];
  expect(pedido.messages).toEqual([
    { role: "user", content: "Oi" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Como estudar SQL?" },
  ]);
  expect(pedido.system).toMatch(/sem acesso às ferramentas/);
  expect(pedido.prazo).toBeGreaterThan(Date.now());
  expect(respostaGravada()).toEqual([1, "Resposta do fallback.", null]);
});

test("Gemini falha no meio das ferramentas: o fallback responde", async () => {
  chatTurn.mockResolvedValue({
    interactionId: "i-2", text: "", cortada: false,
    functionCalls: [{ id: "c-1", name: "buscarVagas", arguments: {} }],
  });
  executeTool.mockResolvedValue([]);
  sendFunctionResults.mockRejectedValue(foraDoAr());

  await expect(sendMessage(1, 10, "iniciante", "Tem vaga de Node?")).resolves.toBe("Resposta do fallback.");
  expect(sendFunctionResults.mock.calls[0][0].prazo).toBeGreaterThan(Date.now());
});

test("resposta vazia do Gemini vai pro fallback", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "", functionCalls: [], cortada: false });
  await expect(sendMessage(1, 10, "iniciante", "Oi")).resolves.toBe("Resposta do fallback.");
});

test("Gemini e fallback falham: apaga a pergunta sem resposta e repassa o erro", async () => {
  chatTurn.mockRejectedValue(foraDoAr());
  askFallbackText.mockRejectedValue(new ErroIA("A IA está indisponível no momento.", { tipo: "indisponivel", temporario: true }));

  await expect(sendMessage(1, 10, "iniciante", "Oi")).rejects.toMatchObject({ tipo: "indisponivel" });
  expect(db.query).toHaveBeenCalledWith("DELETE FROM mentor_conversas WHERE id = ?", [ID_INSERIDO]);
  expect(respostaGravada()).toBeUndefined();
});

test("depois de respostas do fallback, o Gemini recebe junto o trecho que não viu", async () => {
  conversa = [
    { id: 1, role: "user", content: "Oi", gemini_interaction_id: null },
    { id: 2, role: "assistant", content: "Olá!", gemini_interaction_id: "i-1" },
    { id: 3, role: "user", content: "O que é JOIN?", gemini_interaction_id: null },
    { id: 4, role: "assistant", content: "JOIN combina tabelas.", gemini_interaction_id: null },
  ];
  chatTurn.mockResolvedValue({ interactionId: "i-5", text: "Um exemplo: ...", functionCalls: [], cortada: false });

  await sendMessage(1, 10, "iniciante", "Me dá um exemplo");

  const { previousInteractionId, input } = chatTurn.mock.calls[0][0];
  expect(previousInteractionId).toBe("i-1");
  expect(input).toContain("Usuário: O que é JOIN?");
  expect(input).toContain("Mentor: JOIN combina tabelas.");
  expect(input).not.toContain("Olá!");
  expect(input.endsWith("Me dá um exemplo")).toBe(true);
});

test("resposta cortada no teto de tokens ganha um aviso", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "Primeiro, estude", functionCalls: [], cortada: true });

  const resposta = await sendMessage(1, 10, "iniciante", "Como começar?");
  expect(resposta).toMatch(/^Primeiro, estude\n\n\(A resposta foi interrompida/);
});
