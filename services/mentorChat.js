// ============================================
// services/mentorChat.js
// Chat de mentoria de carreira — assistente com
// memória da conversa (as últimas mensagens vão
// junto a cada pergunta) e function calling pra
// consultar dados reais da plataforma (vagas,
// perfil, portfólio, roadmap). Também conduz a
// simulação de entrevista técnica. Exclusivo do
// plano PRO.
//
// Se o Gemini falhar (fora do ar, cota, tempo
// esgotado), a resposta sai do fallback multi-
// provedor (services/aiFallback.js) em texto, com as
// mesmas mensagens como contexto e sem ferramentas.
// ============================================
const db = require("../database/db");
const { chatTurn, sendFunctionResults } = require("./geminiClient");
const { askFallbackText } = require("./aiFallback");
const { ErroIA } = require("./iaErros");
const { TOOL_DECLARATIONS, executeTool } = require("./aiTools");
const { buildUserContextBlock } = require("./userContextService");

const MAX_HISTORY = 20; // últimas mensagens trazidas na tela (histórico exibido)
const MAX_FUNCTION_CALL_ROUNDS = 4; // evita loop infinito se o modelo insistir em chamar tools

// Prazos de uma mensagem, contados da chegada dela: o Gemini (com as
// ferramentas) tem até PRAZO_GEMINI_MS; se falhar, o fallback usa o tempo
// que sobra até PRAZO_TOTAL_MS. O front (views/mentor.ejs) espera 90s.
const PRAZO_GEMINI_MS = 55000;
const PRAZO_TOTAL_MS = 75000;

// Memória da conversa: as últimas mensagens vão junto a cada pergunta,
// cada uma limitada — menos para o fallback, porque os provedores
// gratuitos têm teto baixo de tokens por minuto.
const MENSAGENS_DE_CONTEXTO = 10;
const MAX_CHARS_GEMINI = 2000;
const MAX_CHARS_FALLBACK = 800;

const NOTA_SEM_FERRAMENTAS = `

Atenção: nesta resposta você está sem acesso às ferramentas da plataforma. Não afirme ter
consultado vagas, perfil, portfólio ou roadmap além do que já aparece acima ou na conversa; se a
pergunta depender desses dados, diga que não conseguiu consultá-los agora e sugira tentar de novo
em instantes.`;

const AVISO_CORTADA = "\n\n(A resposta foi interrompida pelo limite de tamanho. Peça para eu continuar de onde parei.)";

const SYSTEM_INSTRUCTION = `Você é o assistente inteligente de carreira e desenvolvimento da
plataforma Ápice — uma plataforma que conecta estudantes e desenvolvedores iniciantes a vagas
de estágio em tecnologia.

Seu papel é ajudar:
- estudantes e desenvolvedores iniciantes a evoluir na carreira;
- na busca pelo primeiro estágio;
- na análise de perfil técnico (skills, repositórios/portfólio);
- na montagem e revisão de portfólio;
- na recomendação de tecnologias para aprender;
- a explicar conceitos de programação;
- no acompanhamento de roadmaps de estudo;
- na preparação para entrevistas técnicas;
- a interpretar informações disponíveis na plataforma (vagas, roadmap, perfil).

Regras:
1. Responda sempre em português brasileiro, a menos que o usuário peça outro idioma
   explicitamente — nesse caso, responda no idioma pedido.
2. Explique conceitos técnicos de forma compreensível para quem está começando.
3. Nunca invente informações. Se não souber algo, diga isso claramente.
4. Nunca afirme ter encontrado dados (vagas, perfil, roadmap) se nenhuma ferramenta
   disponível de fato retornou esses dados — use as ferramentas quando a pergunta
   precisar de dados reais da plataforma, em vez de supor.
5. Para dúvidas de programação: identifique o problema, explique o motivo, apresente a
   solução, mostre código quando necessário, e explique as principais alterações.
6. Para portfólio/projetos: destaque pontos fortes, aponte melhorias possíveis, e adapte
   a sugestão ao nível de experiência do usuário.
7. Para busca de estágio/vagas: considere tecnologias conhecidas, experiência, projetos e
   área de interesse do usuário antes de recomendar.
8. Para roadmap: nunca recomende algo que o usuário já domina — verifique o que ele já
   sabe antes de sugerir o próximo passo, e sugira uma progressão lógica.
9. Seja conciso — evite respostas longas quando uma resposta curta resolver. Use
   listas/títulos só quando isso realmente ajudar a compreensão.
10. Seja útil e prático, nunca genérico.

Simulação de entrevista técnica (quando o usuário pedir para treinar ou simular uma entrevista):
- Aja como um entrevistador técnico. Se o usuário ainda não disse, pergunte em uma frase se ele
  quer treinar para uma vaga específica da plataforma ou com base no próprio perfil.
- Para uma vaga, consulte os requisitos dela com a ferramenta buscarRequisitosVaga (use
  buscarVagas para achar o ID, se precisar) e baseie as perguntas nas skills exigidas.
- Faça UMA pergunta técnica objetiva por vez, adequada ao nível e às skills do usuário. Não
  responda a própria pergunta: espere a resposta dele.
- Ao receber a resposta, dê um feedback construtivo e específico, de 3 a 5 frases, apontando os
  acertos e os pontos de melhoria. Depois ofereça a próxima pergunta ou encerrar a simulação.`;

async function getHistory(userId) {
  const [rows] = await db.query(
    "SELECT id, role, content, created_at FROM mentor_conversas WHERE user_id = ? ORDER BY created_at ASC",
    [userId]
  );
  return rows;
}

// Apaga todo o histórico do mentor de um usuário — chamado no login
// (ver controllers/authController.js e usersController.js), pra cada
// sessão nova começar uma conversa do zero, sem continuar de onde a
// anterior parou. Decisão de produto: o histórico nunca é preservado
// entre logins, para nenhum usuário.
async function clearHistory(userId) {
  await db.query("DELETE FROM mentor_conversas WHERE user_id = ?", [userId]);
}

// As últimas mensagens da conversa, da mais antiga para a mais nova — só
// papel e texto (o histórico é apagado a cada login).
async function getMensagensRecentes(userId) {
  const [rows] = await db.query(
    `SELECT role, content FROM mentor_conversas
     WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, MENSAGENS_DE_CONTEXTO]
  );
  return rows.reverse().map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }));
}

function limitar(texto, max) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

// anexoTexto: conteúdo já extraído de um arquivo (PDF/.txt/.md) enviado
// junto da mensagem, se houver — anexado à mensagem do usuário antes de
// enviar pro Gemini e salvar, pra aparecer no histórico como contexto.
async function sendMessage(userId, githubId, nivel, userMessage, anexoTexto) {
  const inicio = Date.now();
  const content = anexoTexto
    ? `${userMessage}\n\n[Arquivo anexado]\n${anexoTexto}`
    : userMessage;

  const historico = await getMensagensRecentes(userId);
  const [inserida] = await db.query(
    "INSERT INTO mentor_conversas (user_id, role, content) VALUES (?, 'user', ?)",
    [userId, content]
  );

  try {
    const userContext = await buildUserContextBlock({ id: userId, github_id: githubId }, ["nivel", "skills", "roadmapAtivo"]);
    const system = userContext ? `${SYSTEM_INSTRUCTION}\n\n${userContext}` : SYSTEM_INSTRUCTION;

    let resposta;
    try {
      resposta = await responderComGemini({
        system, historico, content, ctx: { userId, githubId, nivel }, prazo: inicio + PRAZO_GEMINI_MS,
      });
    } catch (err) {
      console.error("[mentorChat] Gemini falhou; respondendo pelo fallback, sem ferramentas:", err.message);
      resposta = await responderComFallback({ system, historico, content, prazo: inicio + PRAZO_TOTAL_MS });
    }

    await db.query(
      "INSERT INTO mentor_conversas (user_id, role, content, gemini_interaction_id) VALUES (?, 'assistant', ?, ?)",
      [userId, resposta.texto, resposta.interactionId]
    );
    return resposta.texto;
  } catch (err) {
    // Ficou sem resposta: tira a pergunta do histórico, senão ela some da
    // tela só até a próxima carga e o "Tentar novamente" a duplicaria.
    if (inserida?.insertId) {
      await db.query("DELETE FROM mentor_conversas WHERE id = ?", [inserida.insertId])
        .catch(e => console.error("[mentorChat] Não foi possível apagar a mensagem sem resposta:", e.message));
    }
    throw err;
  }
}

async function responderComGemini({ system, historico, content, ctx, prazo }) {
  // O histórico vai inteiro a cada pergunta (geminiClient monta os passos
  // da API só com papel e texto) — inclusive as respostas que vieram do
  // fallback, então trocar de provedor no meio da conversa não perde nada.
  let turn = await chatTurn({
    system,
    historico: historico.map(m => ({ role: m.role, content: limitar(m.content, MAX_CHARS_GEMINI) })),
    input: content,
    tools: TOOL_DECLARATIONS,
    maxTokens: 2048,
    prazo,
  });

  // Se o modelo pediu pra executar ferramentas, roda cada uma (validadas
  // em aiTools.js, nunca confiando cegamente nos argumentos do modelo) e
  // manda o resultado de volta, repetindo até ele responder em texto ou
  // até o limite de rodadas — evita loop infinito em caso de comportamento
  // inesperado do modelo.
  let rounds = 0;
  while (turn.functionCalls.length && rounds < MAX_FUNCTION_CALL_ROUNDS) {
    const results = await Promise.all(
      turn.functionCalls.map(async call => ({
        id: call.id,
        name: call.name,
        response: { output: await executeTool(call.name, call.arguments, ctx) },
      }))
    );

    turn = await sendFunctionResults({
      system,
      previousInteractionId: turn.interactionId,
      results,
      tools: TOOL_DECLARATIONS,
      maxTokens: 2048,
      prazo,
    });
    rounds += 1;
  }

  // Sem texto — resposta vazia, ou o modelo ainda pedindo ferramentas
  // depois do limite de rodadas: conta como falha e vai pro fallback.
  if (!turn.text || turn.functionCalls.length) {
    throw new ErroIA("O Gemini não gerou uma resposta em texto.", { tipo: "vazia" });
  }
  return {
    texto: turn.cortada ? turn.text + AVISO_CORTADA : turn.text,
    interactionId: turn.interactionId ?? null,
  };
}

async function responderComFallback({ system, historico, content, prazo }) {
  const { text, cortada, provider, model } = await askFallbackText({
    system: system + NOTA_SEM_FERRAMENTAS,
    messages: [
      ...historico.map(m => ({ role: m.role, content: limitar(m.content, MAX_CHARS_FALLBACK) })),
      { role: "user", content },
    ],
    maxTokens: 2048,
    prazo,
  });
  console.warn(`[mentorChat] Resposta gerada pelo fallback ${provider}/${model}.`);
  return { texto: cortada ? text + AVISO_CORTADA : text, interactionId: null };
}

module.exports = { getHistory, sendMessage, clearHistory, MAX_HISTORY };
