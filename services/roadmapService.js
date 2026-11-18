// ============================================
// services/roadmapService.js
// Núcleo do sistema de Roadmap (docs/roadmap-spec.md): monta o gap entre
// o perfil do usuário e um objetivo (vaga ou área), gera a trilha por
// ALGORITMO (services/roadmapAlgoritmo.js — sem IA) e grava tudo no banco.
//
// A trilha é personalizada pela vaga (nível, skills obrigatórias/desejáveis,
// ordem de aprendizado) e pelo que o usuário já sabe. Os links de estudo
// vêm da tabela curada `recursos`.
// ============================================
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");
const { montarFases } = require("./roadmapAlgoritmo");
const { inferirAreaPorHabilidades } = require("./areaDaVaga");
const {
  verificarRepoPublico, verificarHabilidadesNoRepo, verificarAutoriaDoRepo,
  COMMITS_MINIMOS, MOTIVO_SO_README,
} = require("./githubAnalyzer");
const { MENSAGEM_GITHUB_INDISPONIVEL } = require("./githubErrors");

const HABILIDADES_REFERENCIA_PATH = path.join(__dirname, "..", "data", "habilidades-referencia.json");

// Mesma ordinalização usada em services/matchCalculator.js — fonte única em
// services/niveis.js.
const { NIVEL_ORDER } = require("./niveis");

// ──────────────────────────────────────────────────────────
// Leitura dos dados estáticos (data/*.json)
// ──────────────────────────────────────────────────────────

function carregarHabilidadesReferencia() {
  const bruto = fs.readFileSync(HABILIDADES_REFERENCIA_PATH, "utf8");
  return JSON.parse(bruto);
}

/**
 * jobs/job_skills não têm uma coluna de área (ver docs/roadmap-diagnostico.md)
 * — então, quando o objetivo é uma vaga, infere a área comparando as
 * habilidades da vaga (job_skills) com as listas de
 * data/habilidades-referencia.json. Escolhe a área com mais habilidades em
 * comum; empate entre áreas, ou nenhuma habilidade em comum, cai em
 * "full-stack". Não altera nenhum schema — é só uma heurística de leitura,
 * usada para escolher de qual modelo vêm os passos de cada skill.
 */
async function inferirAreaDaVaga(vagaId) {
  const [jobSkills] = await db.query(
    `SELECT s.name AS habilidade
     FROM job_skills js
     JOIN skills s ON s.id = js.skill_id
     WHERE js.job_id = ?`,
    [vagaId]
  );
  return inferirAreaPorHabilidades(jobSkills.map(r => r.habilidade));
}

// ──────────────────────────────────────────────────────────
// Gap: compara o que o usuário já sabe com o que o objetivo exige
// ──────────────────────────────────────────────────────────

// confidence (0-100, de user_skills) → nível aproximado. null = não tem a
// skill detectada/declarada ainda.
function confidenceToNivel(confidence) {
  if (!confidence || confidence <= 0) return null;
  if (confidence <= 40) return "iniciante";
  if (confidence <= 70) return "intermediario";
  return "avancado";
}

/**
 * Compara o perfil do usuário com os requisitos do objetivo (vaga ou área).
 *
 * "O que já sabe" vem de `user_skills` (detectado via GitHub ou marcado
 * manualmente — a mesma tabela que o roadmap atual já usa). `perfil_tecnico_ia`
 * não entra aqui: é texto livre (boas_praticas/pontos_melhoria), não dá pra
 * usar num cálculo de gap por habilidade/nível. As skills são lidas pelo mesmo
 * identificador do perfil (github_id, ou o id interno para contas sem
 * GitHub). Sem nenhuma skill — nem detectada, nem declarada no
 * autodiagnóstico — o gap vira "precisa aprender tudo".
 */
async function montarGap(usuarioId, objetivo) {
  if (!objetivo || !["vaga", "area"].includes(objetivo.tipo)) {
    throw new Error("objetivo.tipo deve ser 'vaga' ou 'area'.");
  }

  const [devProfileRows] = await db.query(
    "SELECT github_id, nivel FROM user_dev_profiles WHERE user_id = ?",
    [usuarioId]
  );
  // Mesmo identificador que o perfil usa para gravar as skills
  // (getUserId: github_id ?? id interno) — assim uma conta sem GitHub, com
  // skills declaradas no autodiagnóstico, tem o gap calculado de verdade
  // (limitação 4 do doc).
  const skillsId = devProfileRows[0]?.github_id ?? usuarioId;

  const userSkillMap = {};
  const [rows] = await db.query(
    "SELECT skill_id, confidence FROM user_skills WHERE github_id = ?",
    [skillsId]
  );
  for (const r of rows) userSkillMap[r.skill_id] = r.confidence;

  if (objetivo.tipo === "vaga") {
    if (!objetivo.vagaId) throw new Error("objetivo.vagaId é obrigatório quando tipo='vaga'.");

    const [jobSkills] = await db.query(
      `SELECT js.skill_id, js.importance, js.learn_order, s.name AS habilidade,
              j.level AS nivel_vaga, j.title AS vaga_titulo, j.area AS vaga_area
       FROM job_skills js
       JOIN skills s ON s.id = js.skill_id
       JOIN jobs j   ON j.id = js.job_id
       WHERE js.job_id = ?
       ORDER BY js.importance DESC, js.learn_order`,
      [objetivo.vagaId]
    );

    const requisitos = jobSkills.map(js => {
      const confidence = userSkillMap[js.skill_id] ?? 0;
      return {
        habilidade:     js.habilidade,
        importancia:    js.importance,
        ordem:          js.learn_order ?? null,
        nivel_atual:    confidenceToNivel(confidence),
        // job_skills não guarda um nível esperado por skill (só o nível
        // geral da vaga, em jobs.level) — o gap aqui é binário: tem ou não.
        nivel_esperado: null,
        tem_gap:        confidence <= 0,
      };
    });

    return {
      tipo: "vaga", vagaId: objetivo.vagaId, area: objetivo.area ?? jobSkills[0]?.vaga_area ?? null,
      nivelVaga: jobSkills[0]?.nivel_vaga ?? null, vagaTitulo: jobSkills[0]?.vaga_titulo ?? null,
      requisitos,
    };
  }

  // tipo === "area"
  const referencia = carregarHabilidadesReferencia();
  const lista = referencia[objetivo.area];
  if (!lista) {
    throw new Error(`Área desconhecida: "${objetivo.area}". Use uma de: ${Object.keys(referencia).join(", ")}.`);
  }

  const [skillRows] = await db.query("SELECT id, name FROM skills");
  const skillIdByName = {};
  for (const s of skillRows) skillIdByName[s.name] = s.id;

  const requisitos = lista.map(req => {
    const skillId     = skillIdByName[req.habilidade];
    const confidence  = skillId != null ? (userSkillMap[skillId] ?? 0) : 0;
    const nivelAtual  = confidenceToNivel(confidence);
    const temGap      = nivelAtual == null || NIVEL_ORDER[nivelAtual] < NIVEL_ORDER[req.nivel_esperado];
    return {
      habilidade:     req.habilidade,
      nivel_atual:    nivelAtual,
      nivel_esperado: req.nivel_esperado,
      tem_gap:        temGap,
    };
  });

  return { tipo: "area", area: objetivo.area, requisitos };
}

// ──────────────────────────────────────────────────────────
// Geração da trilha (algoritmo)
// ──────────────────────────────────────────────────────────

// Origem gravada em roadmaps.origem: o ENUM do banco só aceita 'ia'|'modelo'
// (migration 20261001) — 'modelo' = trilha montada pelo algoritmo, sem IA.
const ORIGEM = "modelo";

/**
 * Gera o conteúdo da trilha (fases/etapas/projetos), sem gravar nada ainda.
 * `area` só escolhe de qual modelo vêm os passos de cada skill.
 */
function gerarConteudoRoadmap(gap, area) {
  return { conteudo: montarFases({ ...gap, area: area ?? gap.area ?? null }), origem: ORIGEM };
}

// ──────────────────────────────────────────────────────────
// Associação de recursos (tabela `recursos`) + recursos_pendentes
// ──────────────────────────────────────────────────────────

/**
 * Escolhe o recurso ativo mais adequado para uma habilidade: nível
 * compatível com o nível atual do usuário nessa habilidade, depois
 * idioma pt, depois gratuito. Sem nenhum recurso ativo cadastrado,
 * registra/incrementa `recursos_pendentes` e devolve null.
 */
async function escolherRecurso(executor, habilidade, nivelAtual) {
  const nivelBusca = nivelAtual || "iniciante";

  const [rows] = await executor.query(
    `SELECT id FROM recursos
     WHERE habilidade = ? AND ativo = 1
     ORDER BY (nivel = ?) DESC, (idioma = 'pt') DESC, gratuito DESC, id ASC
     LIMIT 1`,
    [habilidade, nivelBusca]
  );
  if (rows.length) return rows[0].id;

  await executor.query(
    `INSERT INTO recursos_pendentes (habilidade, vezes_solicitada, ultima_solicitacao)
     VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       vezes_solicitada   = vezes_solicitada + 1,
       ultima_solicitacao = NOW()`,
    [habilidade]
  );
  return null;
}

// ──────────────────────────────────────────────────────────
// Persistência (transação única: roadmaps + roadmap_fases + roadmap_etapas)
// ──────────────────────────────────────────────────────────

/**
 * Mapa nome-minúsculo → nome canônico (como está em `skills.name`) para os
 * nomes informados que existem na tabela de skills. A mesma normalização da
 * verificação (verificarProjeto): casa por `skills.name`, sem diferenciar
 * maiúsculas/minúsculas.
 */
async function nomesCanonicosDeSkills(executor, nomes) {
  if (!nomes.length) return new Map();
  const [rows] = await executor.query("SELECT name FROM skills WHERE name IN (?)", [nomes]);
  return new Map(rows.map(r => [String(r.name).trim().toLowerCase(), r.name]));
}

/**
 * Habilidades-alvo do projeto de uma fase, só as que existem em `skills`
 * (nome canônico, sem repetição). Nome desconhecido é descartado com um aviso
 * no log — nunca quebra a geração.
 */
function habilidadesValidasDoProjeto(nomeDaFase, nomes, canonicos) {
  const validas = [];
  const descartadas = [];
  for (const nome of nomes ?? []) {
    const canonico = canonicos.get(String(nome).trim().toLowerCase());
    if (!canonico) descartadas.push(nome);
    else if (!validas.includes(canonico)) validas.push(canonico);
  }
  if (descartadas.length) {
    console.warn(
      `[roadmap] habilidades do projeto da fase "${nomeDaFase}" descartadas (não existem em skills): ${descartadas.join(", ")}`
    );
  }
  return validas;
}

/**
 * Grava fases/etapas de um roadmap já existente, na conexão/transação
 * `executor` passada pelo chamador. `etapasConcluidasPorHabilidade` (usado
 * pela regeneração) preserva status/concluida_em de etapas já finalizadas
 * cuja habilidade reaparece na trilha nova.
 */
async function salvarFasesEEtapas(executor, roadmapId, fases, etapasConcluidasPorHabilidade = {}) {
  const fasesSalvas = [];

  // Uma consulta só para validar as habilidades de todos os projetos. É o mesmo
  // caminho da geração, do roadmap-modelo e da regeneração.
  const canonicos = await nomesCanonicosDeSkills(
    executor,
    [...new Set(fases.flatMap(f => f.projeto?.habilidades ?? []))]
  );

  for (let i = 0; i < fases.length; i++) {
    const fase = fases[i];
    const habilidadesDoProjeto = habilidadesValidasDoProjeto(fase.nome, fase.projeto.habilidades, canonicos);
    const [faseResult] = await executor.query(
      `INSERT INTO roadmap_fases (roadmap_id, ordem, nome, objetivo, projeto_enunciado, projeto_habilidades, projeto_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente')`,
      [
        roadmapId, i + 1, fase.nome, fase.objetivo, fase.projeto.enunciado,
        // vazio → NULL: a verificação usa as habilidades das etapas, como em roadmaps antigos
        habilidadesDoProjeto.length ? JSON.stringify(habilidadesDoProjeto) : null,
      ]
    );
    const faseId = faseResult.insertId;

    const etapasSalvas = [];
    for (let j = 0; j < fase.etapas.length; j++) {
      const etapa = fase.etapas[j];
      const recursoId = await escolherRecurso(executor, etapa.habilidade, etapa.nivel_atual ?? null);

      const concluida    = etapasConcluidasPorHabilidade[etapa.habilidade];
      const status        = concluida ? "concluida" : "pendente";
      const concluidaEm   = concluida ? concluida.concluida_em : null;

      const [etapaResult] = await executor.query(
        `INSERT INTO roadmap_etapas
           (fase_id, ordem, titulo, descricao, habilidade, horas_estimadas, recurso_id, status, concluida_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [faseId, j + 1, etapa.titulo, etapa.descricao, etapa.habilidade, etapa.horas_estimadas, recursoId, status, concluidaEm]
      );

      etapasSalvas.push({
        id: etapaResult.insertId,
        titulo: etapa.titulo,
        descricao: etapa.descricao,
        habilidade: etapa.habilidade,
        horas_estimadas: etapa.horas_estimadas,
        recurso_id: recursoId,
        status,
        concluida_em: concluidaEm,
      });
    }

    fasesSalvas.push({
      id: faseId,
      nome: fase.nome,
      objetivo: fase.objetivo,
      projeto: { ...fase.projeto, habilidades: habilidadesDoProjeto },
      etapas: etapasSalvas,
    });
  }

  return fasesSalvas;
}

/**
 * Monta o gap, gera a trilha (algoritmo) e grava roadmap + fases +
 * etapas numa única transação. objetivo = { tipo: 'vaga'|'area', vagaId?,
 * area? } — `area` é opcional quando tipo='vaga' (serve só de dica de qual
 * modelo usar nos passos, já que jobs/job_skills não têm uma coluna de área).
 */
async function gerarRoadmap(usuarioId, objetivo, horasSemana) {
  const gap  = await montarGap(usuarioId, objetivo);
  const area = objetivo.tipo === "area"
    ? objetivo.area
    : (objetivo.area ?? gap.area ?? await inferirAreaDaVaga(objetivo.vagaId));

  const { conteudo, origem } = gerarConteudoRoadmap(gap, area);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [roadmapResult] = await conn.query(
      `INSERT INTO roadmaps (usuario_id, tipo_objetivo, vaga_id, area, horas_semana, status, versao, origem)
       VALUES (?, ?, ?, ?, ?, 'ativo', 1, ?)`,
      [
        usuarioId,
        objetivo.tipo,
        objetivo.tipo === "vaga" ? objetivo.vagaId : null,
        area,
        horasSemana,
        origem,
      ]
    );
    const roadmapId = roadmapResult.insertId;

    const fasesSalvas = await salvarFasesEEtapas(conn, roadmapId, conteudo.fases);

    await conn.commit();
    return { roadmapId, origem, versao: 1, fases: fasesSalvas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Regenera um roadmap existente: refaz o gap (perfil pode ter mudado),
 * gera uma trilha nova (algoritmo), preserva etapas já concluídas
 * (casadas por nome de habilidade) e substitui o resto. versao + 1.
 * `novaHorasSemana` é opcional — sem ela, mantém a disponibilidade atual
 * do roadmap.
 */
async function regenerarRoadmap(roadmapId, novaHorasSemana) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [roadmapRows] = await conn.query("SELECT * FROM roadmaps WHERE id = ?", [roadmapId]);
    const roadmap = roadmapRows[0];
    if (!roadmap) throw new Error(`Roadmap ${roadmapId} não encontrado.`);

    const horasSemana = novaHorasSemana ?? roadmap.horas_semana;

    const [etapasAntigas] = await conn.query(
      `SELECT re.habilidade, re.concluida_em
       FROM roadmap_etapas re
       JOIN roadmap_fases rf ON rf.id = re.fase_id
       WHERE rf.roadmap_id = ? AND re.status = 'concluida'`,
      [roadmapId]
    );
    const concluidasPorHabilidade = {};
    for (const e of etapasAntigas) concluidasPorHabilidade[e.habilidade] = { concluida_em: e.concluida_em };

    // roadmap.area já deveria estar resolvido desde a criação (gerarRoadmap
    // persiste a área inferida mesmo pra objetivo=vaga) — recalcula só como
    // rede de segurança para roadmaps antigos criados antes dessa inferência.
    const area = roadmap.tipo_objetivo === "area"
      ? roadmap.area
      : (roadmap.area || await inferirAreaDaVaga(roadmap.vaga_id));

    const objetivo = { tipo: roadmap.tipo_objetivo, vagaId: roadmap.vaga_id, area };
    const gap = await montarGap(roadmap.usuario_id, objetivo);
    const { conteudo, origem } = gerarConteudoRoadmap(gap, area);

    // ON DELETE CASCADE de roadmap_fases já leva roadmap_etapas junto.
    await conn.query("DELETE FROM roadmap_fases WHERE roadmap_id = ?", [roadmapId]);

    const novaVersao = roadmap.versao + 1;
    // gerado_em sempre reflete quando o conteúdo foi de fato (re)gerado.
    // A regra de intervalo entre regenerações é aplicada só em
    // middlewares/roadmapLimites.js (a partir de gerado_em), não aqui.
    await conn.query(
      `UPDATE roadmaps SET horas_semana = ?, versao = ?, origem = ?, gerado_em = NOW() WHERE id = ?`,
      [horasSemana, novaVersao, origem, roadmapId]
    );

    const fasesSalvas = await salvarFasesEEtapas(conn, roadmapId, conteudo.fases, concluidasPorHabilidade);

    await conn.commit();
    return { roadmapId, origem, versao: novaVersao, fases: fasesSalvas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ──────────────────────────────────────────────────────────
// Verificação do projeto prático de uma fase (docs/roadmap-spec.md,
// "Progresso e verificação") — exclusiva do plano PRO. Free usa
// fecharProjetoSemVerificar, mais abaixo.
// ──────────────────────────────────────────────────────────

// Aceita a URL completa (com ou sem protocolo/www, com ou sem .git/barra
// final) e devolve "dono/repo", ou null se não for uma URL de repositório
// do GitHub reconhecível.
// Também aceita /tree/<branch>, /blob/..., ?query e #hash depois do repositório.
function extrairRepoFullNameDoUrl(url) {
  const match = String(url ?? "").trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[\/?#].*)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

// URL canônica do repositório: https://github.com/dono/repo (sem .git, barra
// final, /tree/..., query ou hash). null se não for um repositório do GitHub.
function normalizarUrlRepo(url) {
  const nome = extrairRepoFullNameDoUrl(url);
  return nome ? `https://github.com/${nome}` : null;
}

const INTERVALO_REENVIO_MIN = 5;

/**
 * Regras de envio do projeto de uma fase (Free e PRO), checadas ANTES de
 * qualquer chamada ao GitHub e sem gravar nada:
 *   1. todas as etapas da fase precisam estar 'concluida';
 *   2. mínimo de INTERVALO_REENVIO_MIN minutos desde o último envio que
 *      chegou a consultar o GitHub ou a fechar a fase.
 * Devolve null se pode enviar, ou { status: "erro", mensagem, ... }.
 * O intervalo é calculado no próprio MySQL (NOW()), a mesma fonte de quem grava.
 */
async function validarEnvioDaFase(faseId) {
  const [[{ pendentes }]] = await db.query(
    "SELECT COUNT(*) AS pendentes FROM roadmap_etapas WHERE fase_id = ? AND status <> 'concluida'",
    [faseId]
  );
  if (Number(pendentes) > 0) {
    return {
      status: "erro",
      mensagem: "Conclua todas as etapas da fase antes de enviar o projeto.",
      etapasPendentes: Number(pendentes),
    };
  }

  const [[fase]] = await db.query(
    "SELECT TIMESTAMPDIFF(SECOND, projeto_ultimo_envio_em, NOW()) AS segundos FROM roadmap_fases WHERE id = ?",
    [faseId]
  );
  if (fase && fase.segundos != null && Number(fase.segundos) < INTERVALO_REENVIO_MIN * 60) {
    const faltam = Math.max(1, Math.ceil((INTERVALO_REENVIO_MIN * 60 - Number(fase.segundos)) / 60));
    return { status: "erro", mensagem: `Aguarde ${faltam} min para reenviar.` };
  }
  return null;
}

async function carregarFaseComDono(faseId) {
  const [rows] = await db.query(
    `SELECT rf.*, r.usuario_id
     FROM roadmap_fases rf
     JOIN roadmaps r ON r.id = rf.roadmap_id
     WHERE rf.id = ?`,
    [faseId]
  );
  return rows[0] ?? null;
}

// Habilidades que o projeto da fase deve demonstrar: as de
// roadmap_fases.projeto_habilidades (array JSON de nomes de skills, gravado na
// geração) quando preenchido e não vazio. Roadmaps antigos — coluna NULL,
// vazia ou JSON inválido — usam as habilidades das próprias etapas da fase,
// como antes da coluna existir.
async function habilidadesExigidasNaFase(fase) {
  const doProjeto = lerHabilidadesDoProjeto(fase);
  if (doProjeto.length) return doProjeto;

  const [rows] = await db.query(
    "SELECT DISTINCT habilidade FROM roadmap_etapas WHERE fase_id = ?",
    [fase.id]
  );
  return rows.map(r => r.habilidade);
}

function lerHabilidadesDoProjeto(fase) {
  const bruto = fase?.projeto_habilidades;
  if (bruto == null || bruto === "") return [];
  try {
    const lista = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
    return Array.isArray(lista) ? lista.filter(n => typeof n === "string" && n.trim()) : [];
  } catch {
    console.warn(`[roadmap] projeto_habilidades inválido na fase ${fase.id}; usando as habilidades das etapas.`);
    return [];
  }
}

// Registra a verificação aprovada em perfil_tecnico_ia — a única tabela de
// "perfil técnico" hoje (user_skills é por skill_id/confidence, não por
// texto); como boas_praticas é uma lista de strings livres, a confirmação
// entra como mais um item nela.
async function registrarProjetoVerificadoNoPerfil(usuarioId, nomeFase, habilidadesConfirmadas) {
  const [[perfilAtual]] = await db.query(
    "SELECT boas_praticas FROM perfil_tecnico_ia WHERE user_id = ?",
    [usuarioId]
  );
  const boasPraticas = perfilAtual ? JSON.parse(perfilAtual.boas_praticas || "[]") : [];
  boasPraticas.push(
    `Projeto da fase "${nomeFase}" verificado por análise de repositório — habilidades confirmadas: ${habilidadesConfirmadas.join(", ")}.`
  );

  await db.query(
    `INSERT INTO perfil_tecnico_ia (user_id, boas_praticas, pontos_melhoria)
     VALUES (?, ?, '[]')
     ON DUPLICATE KEY UPDATE boas_praticas = ?`,
    [usuarioId, JSON.stringify(boasPraticas), JSON.stringify(boasPraticas)]
  );
}

/**
 * Verifica o projeto prático de uma fase contra um repositório do GitHub —
 * exclusivo do plano PRO (o gate de plano é responsabilidade do chamador,
 * igual ao resto do app — ver middlewares/roadmapLimites.js). accessToken
 * é o do próprio usuário (nunca persistido em banco — vem da sessão, como
 * em todo outro serviço que chama a API do GitHub nesse projeto).
 *
 * Retorna sempre um objeto { status, mensagem, ... }, nunca lança por causa
 * de link/repo inválido — só por erro de fato inesperado (fase não existe).
 */
async function verificarProjeto(faseId, repoUrl, accessToken, githubUser = {}) {
  const fase = await carregarFaseComDono(faseId);
  if (!fase) throw new Error(`Fase ${faseId} não encontrada.`);

  // Fase já verificada não é reavaliada: a regra mais rigorosa vale só para
  // envios novos (e nada aqui grava ou chama o GitHub).
  if (fase.projeto_status === "verificado") {
    return { status: "erro", mensagem: "Esta fase já foi verificada." };
  }

  // Sem GitHub conectado não há como provar autoria — nem chama a API.
  if (githubUser?.id == null) {
    return {
      status: "erro",
      mensagem: "Conecte sua conta do GitHub para verificar o projeto.",
    };
  }

  const repoFullName = extrairRepoFullNameDoUrl(repoUrl);
  if (!repoFullName) {
    return {
      status: "erro",
      mensagem: "Link inválido. Use a URL completa do repositório no GitHub (ex.: https://github.com/usuario/repositorio).",
    };
  }

  // A partir daqui o envio chega a consultar o GitHub: conta para o limite
  // de reenvio (erros de validação acima não contam).
  await db.query("UPDATE roadmap_fases SET projeto_ultimo_envio_em = NOW() WHERE id = ?", [faseId]);

  const infoRepo = await verificarRepoPublico(accessToken, repoFullName);
  const { existe, privado, falha } = infoRepo;
  // PRO: grava o html_url que a API devolve; nos caminhos sem resposta da
  // API (repositório inexistente), a URL normalizada.
  const urlSalva = infoRepo.html_url || normalizarUrlRepo(repoUrl);
  // Falha de leitura do GitHub (limite de uso, token inválido, rede): não é
  // "repositório não encontrado" e não mexe em nada da fase.
  if (falha) return { status: "indisponivel", mensagem: MENSAGEM_GITHUB_INDISPONIVEL };
  if (!existe) {
    await db.query("UPDATE roadmap_fases SET projeto_repo_url = ? WHERE id = ?", [urlSalva, faseId]);
    return {
      status: "erro",
      mensagem: "Não encontramos esse repositório. Confira o link (e, se for privado, torne-o público antes de enviar).",
    };
  }
  if (privado) {
    await db.query("UPDATE roadmap_fases SET projeto_repo_url = ? WHERE id = ?", [urlSalva, faseId]);
    return {
      status: "erro",
      mensagem: "Esse repositório está privado. Torne-o público no GitHub e envie o link novamente.",
    };
  }

  // O repositório precisa ser do usuário (ou ter commits dele). Falha de
  // leitura do GitHub → indisponível, nunca "não é autor". Não altera a fase.
  let autoria;
  try {
    autoria = await verificarAutoriaDoRepo(accessToken, repoFullName, githubUser.id, githubUser.login, infoRepo);
  } catch (err) {
    if (err.codigo === "GITHUB_INDISPONIVEL") {
      return { status: "indisponivel", mensagem: MENSAGEM_GITHUB_INDISPONIVEL };
    }
    throw err;
  }
  if (!autoria.autor) {
    return {
      status: "erro",
      mensagem: "Esse repositório não parece ser seu. Envie um repositório da sua conta ou em que você tenha commits.",
    };
  }

  const habilidadesAlvo = await habilidadesExigidasNaFase(fase);
  const [skillRows] = habilidadesAlvo.length
    ? await db.query(
        "SELECT name, github_signals FROM skills WHERE name IN (?) AND github_signals IS NOT NULL",
        [habilidadesAlvo]
      )
    : [[]];
  // "Verificável" = habilidade com skill de mesmo nome e github_signals
  // cadastrados; só essas dá pra checar no repositório. As demais são
  // devolvidas na resposta para o usuário saber o que não foi checado.
  const habilidadesComSinais = skillRows
    .map(s => ({
      habilidade: s.name,
      sinais: s.github_signals.split(",").map(x => x.trim()).filter(Boolean),
    }))
    .filter(h => h.sinais.length > 0);
  const nomesVerificaveis = new Set(habilidadesComSinais.map(h => h.habilidade.toLowerCase()));
  const naoVerificaveis = habilidadesAlvo.filter(h => !nomesVerificaveis.has(String(h).toLowerCase()));

  // Nenhuma habilidade verificável: NÃO aprova sem checagem (limitação 10 do
  // doc). A fase fecha com o selo "não verificada", o mesmo do plano Free.
  if (habilidadesComSinais.length === 0) {
    await db.query(
      "UPDATE roadmap_fases SET projeto_repo_url = ?, projeto_status = 'nao_verificado' WHERE id = ?",
      [urlSalva, faseId]
    );
    return {
      status: "nao_verificavel",
      mensagem: "Não conseguimos verificar este projeto automaticamente. A fase foi concluída com o selo 'não verificada'.",
      naoVerificaveis,
    };
  }

  let resultadoAnalise;
  try {
    resultadoAnalise = await verificarHabilidadesNoRepo(accessToken, repoFullName, habilidadesComSinais);
  } catch (err) {
    // Nunca devolver "faltando" quando a causa foi falha da API: o status do
    // projeto continua como estava.
    if (err.codigo === "GITHUB_INDISPONIVEL") {
      return { status: "indisponivel", mensagem: MENSAGEM_GITHUB_INDISPONIVEL };
    }
    console.error("[verificarProjeto] falha ao analisar o repositório:", err.message);
    return {
      status: "erro",
      mensagem: "Não foi possível analisar o repositório agora. Tente novamente em alguns instantes.",
    };
  }

  const naoEncontradas = resultadoAnalise.filter(r => !r.encontrada);
  const faltando = naoEncontradas.map(r => r.habilidade);

  // O que falta, com o motivo de cada item (tom de orientação).
  const pendencias = naoEncontradas.map(r => r.motivo === MOTIVO_SO_README
    ? `${r.habilidade} — só aparece no README; falta uso no código/dependências`
    : `${r.habilidade} — não encontrada`);
  // Evidência mínima de trabalho: commits do próprio usuário (mesmo sendo o dono).
  if (autoria.commits < COMMITS_MINIMOS) {
    pendencias.push(
      `Faça pelo menos ${COMMITS_MINIMOS} commits com o seu trabalho no repositório. ` +
      "Só contam commits feitos com um e-mail vinculado à sua conta do GitHub."
    );
  }

  // Todas as habilidades verificáveis têm sinal forte e há commits suficientes
  // → aprova. As não verificáveis não entram na decisão, mas são listadas.
  if (pendencias.length === 0) {
    await db.query(
      `UPDATE roadmap_fases
       SET projeto_repo_url = ?, projeto_status = 'verificado', verificado_em = NOW()
       WHERE id = ?`,
      [urlSalva, faseId]
    );
    await registrarProjetoVerificadoNoPerfil(fase.usuario_id, fase.nome, habilidadesComSinais.map(h => h.habilidade));
    return {
      status: "aprovado",
      mensagem: "Projeto aprovado! As habilidades da fase foram confirmadas no seu repositório.",
      naoVerificaveis,
    };
  }

  // Não aprovado — a fase continua aberta (nunca "reprovada"), com a lista
  // do que ainda falta, em tom de orientação.
  await db.query(
    "UPDATE roadmap_fases SET projeto_repo_url = ?, projeto_status = 'em_revisao' WHERE id = ?",
    [urlSalva, faseId]
  );
  return {
    status: "faltando",
    mensagem: "Quase lá! Ainda faltam alguns pontos para verificar o projeto — continue trabalhando e envie de novo quando quiser.",
    faltando,
    pendencias,
    naoVerificaveis,
  };
}

/**
 * Plano Free: não verifica nada (sem acesso à análise de repositório) —
 * só registra o link e fecha a fase por autodeclaração, com o selo "não
 * verificada" (docs/roadmap-spec.md, "Progresso e verificação").
 */
async function fecharProjetoSemVerificar(faseId, repoUrl) {
  const fase = await carregarFaseComDono(faseId);
  if (!fase) throw new Error(`Fase ${faseId} não encontrada.`);

  const urlNormalizada = normalizarUrlRepo(repoUrl);
  if (!urlNormalizada) {
    return {
      status: "erro",
      mensagem: "Link inválido. Use a URL completa do repositório no GitHub (ex.: https://github.com/usuario/repositorio).",
    };
  }

  await db.query(
    `UPDATE roadmap_fases
     SET projeto_repo_url = ?, projeto_status = 'nao_verificado', projeto_ultimo_envio_em = NOW()
     WHERE id = ?`,
    [urlNormalizada, faseId]
  );
  return {
    status: "nao_verificado",
    mensagem: "Projeto registrado — a fase foi fechada por autodeclaração (selo \"não verificada\"). "
             + "Faça upgrade para PRO para ter o projeto verificado automaticamente.",
  };
}

module.exports = {
  montarGap,
  gerarRoadmap,
  regenerarRoadmap,
  inferirAreaDaVaga,
  verificarProjeto,
  fecharProjetoSemVerificar,
  extrairRepoFullNameDoUrl,
  normalizarUrlRepo,
  validarEnvioDaFase,
};
