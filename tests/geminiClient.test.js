// tests/geminiClient.test.js
// Cliente do Gemini (services/geminiClient.js) com o SDK simulado: nenhuma
// chamada real à API. Cobre o formato das mensagens enviadas ao Gemini.
jest.mock("@google/genai", () => {
  const create = jest.fn();
  return { GoogleGenAI: jest.fn(() => ({ interactions: { create } })), __create: create };
});
jest.mock("../services/aiFallback", () => ({
  ...jest.requireActual("../services/aiFallback"),
  askFallbackJSON: jest.fn(),
}));

process.env.GEMINI_API_KEY = "chave-de-teste";

const { __create: create } = require("@google/genai");
const { sendFunctionResults } = require("../services/geminiClient");

beforeEach(() => create.mockReset());

describe("sendFunctionResults", () => {
  test("devolve o resultado da ferramenta com call_id e result (formato da Interactions API)", async () => {
    create.mockResolvedValue({ id: "int-2", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Achei 2 vagas." }] }] });

    const turn = await sendFunctionResults({
      system: "sistema",
      previousInteractionId: "int-1",
      results: [{ id: "chamada-1", name: "buscarVagas", response: { output: [{ id: 3 }] } }],
    });

    const [params] = create.mock.calls[0];
    expect(params.previous_interaction_id).toBe("int-1");
    expect(params.input).toEqual([
      { type: "function_result", call_id: "chamada-1", name: "buscarVagas", result: { output: [{ id: 3 }] } },
    ]);
    expect(params.input[0]).not.toHaveProperty("id");
    expect(params.input[0]).not.toHaveProperty("response");
    expect(turn.text).toBe("Achei 2 vagas.");
  });
});
