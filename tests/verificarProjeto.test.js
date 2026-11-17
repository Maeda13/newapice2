// tests/verificarProjeto.test.js
// Testa roadmapService.verificarProjeto/fecharProjetoSemVerificar com a
// análise de repositório mockada (services/githubAnalyzer) e o banco
// mockado — sem chamar a API do GitHub nem precisar de MySQL.
jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

jest.mock("../services/githubAnalyzer", () => ({
  verificarRepoPublico: jest.fn(),
  verificarHabilidadesNoRepo: jest.fn(),
  verificarAutoriaDoRepo: jest.fn(),
  // matchSkillsFromGitHub/fetchRepoLanguages/fetchRepoReadme não são
  // usados por roadmapService diretamente — só o necessário é mockado.
}));

const db = require("../database/db");
const { verificarRepoPublico, verificarHabilidadesNoRepo, verificarAutoriaDoRepo } = require("../services/githubAnalyzer");
const { verificarProjeto, fecharProjetoSemVerificar } = require("../services/roadmapService");

const FASE = { id: 10, roadmap_id: 1, nome: "Fase 1", usuario_id: 5 };
const REPO_URL = "https://github.com/dev/meu-projeto";
const USUARIO = { id: 111, login: "dev" };

function instalarFakeDb({ skillRows = [], perfilExistente = null, habilidades = ["JavaScript"] } = {}) {
  const handler = jest.fn(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.includes("from roadmap_fases rf") && s.includes("join roadmaps r")) {
      return [[FASE]];
    }
    if (s.startsWith("select distinct habilidade from roadmap_etapas")) {
      return [habilidades.map(habilidade => ({ habilidade }))];
    }
    if (s.startsWith("select name, github_signals from skills")) {
      return [skillRows];
    }
    if (s.startsWith("update roadmap_fases")) {
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith("select boas_praticas from perfil_tecnico_ia")) {
      return [[perfilExistente]];
    }
    if (s.startsWith("insert into perfil_tecnico_ia")) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
  db.query.mockImplementation(handler);
  return handler;
}

beforeEach(() => {
  jest.clearAllMocks();
  verificarAutoriaDoRepo.mockResolvedValue(true);
});

describe("verificarProjeto", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];

  test("aprovado — habilidade encontrada no repositório", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "JavaScript", confidence: 60, encontrada: true },
    ]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("aprovado");
    const chamadaVerificado = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'verificado'")
    );
    expect(chamadaVerificado).toBeTruthy();
    const chamadaPerfil = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into perfil_tecnico_ia")
    );
    expect(chamadaPerfil).toBeTruthy();
  });

  test("faltando habilidade — projeto continua aberto (em_revisao), nunca 'reprovado'", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "JavaScript", confidence: 0, encontrada: false },
    ]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("faltando");
    expect(resultado.faltando).toEqual(["JavaScript"]);
    expect(resultado.mensagem.toLowerCase()).not.toMatch(/reprovad/);
    const chamadaRevisao = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'em_revisao'")
    );
    expect(chamadaRevisao).toBeTruthy();
  });

  test("repositório privado — mensagem clara, fase continua aberta, sem chamar a análise", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: true });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/privado/);
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("URL inválida — nem chega a consultar o GitHub", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });

    const resultado = await verificarProjeto(FASE.id, "não é uma url", "token-fake", USUARIO);

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/link inválido/);
    expect(verificarRepoPublico).not.toHaveBeenCalled();
  });
});

describe("fecharProjetoSemVerificar (plano Free)", () => {
  test("fecha a fase com o selo 'não verificada', sem chamar a análise de repositório", async () => {
    const handler = instalarFakeDb();

    const resultado = await fecharProjetoSemVerificar(FASE.id, REPO_URL);

    expect(resultado.status).toBe("nao_verificado");
    expect(verificarRepoPublico).not.toHaveBeenCalled();
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
    const chamada = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'nao_verificado'")
    );
    expect(chamada).toBeTruthy();
  });
});

// ETAPA 2: falha de leitura do GitHub nunca vira "faltando" nem "repositório
// não encontrado", e não mexe no projeto_status da fase.
describe("verificarProjeto — GitHub indisponível (falha da API)", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];
  const { GitHubIndisponivelError, MENSAGEM_GITHUB_INDISPONIVEL } = require("../services/githubErrors");

  const escritas = (handler) =>
    handler.mock.calls.filter(([sql]) => sql.toLowerCase().trim().startsWith("update roadmap_fases"));

  test("falha ao consultar o repositório → indisponivel, sem nenhuma escrita na fase", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: true });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado).toEqual({ status: "indisponivel", mensagem: MENSAGEM_GITHUB_INDISPONIVEL });
    expect(escritas(handler)).toEqual([]); // nem projeto_repo_url, nem projeto_status
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("falha ao ler linguagens/README → indisponivel (nunca 'faltando') e status inalterado", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });
    verificarHabilidadesNoRepo.mockRejectedValue(new GitHubIndisponivelError("dev/meu-projeto"));

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("indisponivel");
    expect(resultado.status).not.toBe("faltando");
    expect(resultado.mensagem).toBe("Não conseguimos ler seu GitHub agora. Tente de novo em alguns minutos.");
    expect(resultado.faltando).toBeUndefined();
    expect(escritas(handler)).toEqual([]);
  });

  test("repositório que realmente não existe continua sendo 'erro' (não confundir com falha)", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: false });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/não encontramos/);
  });
});

// ETAPA 3: fase sem nenhuma habilidade verificável não é mais aprovada sem
// checagem (limitação 10 do doc); as não verificáveis são listadas.
describe("verificarProjeto — habilidades verificáveis e não verificáveis", () => {
  const atualizacoesDeStatus = (handler) =>
    handler.mock.calls
      .map(([sql]) => sql.toLowerCase())
      .filter(sql => sql.trim().startsWith("update roadmap_fases") && sql.includes("projeto_status"));

  test("nenhuma habilidade verificável → nao_verificavel, status 'nao_verificado', sem chamar a análise", async () => {
    const handler = instalarFakeDb({ skillRows: [], habilidades: ["Comunicação", "Scrum"] });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("nao_verificavel");
    expect(resultado.mensagem).toBe(
      "Não conseguimos verificar este projeto automaticamente. A fase foi concluída com o selo 'não verificada'."
    );
    expect(resultado.naoVerificaveis).toEqual(["Comunicação", "Scrum"]);
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
    const updates = atualizacoesDeStatus(handler);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("projeto_status = 'nao_verificado'");
    expect(updates.join(" ")).not.toContain("'verificado', verificado_em");
  });

  test("skill com github_signals vazio ('') também não é verificável", async () => {
    instalarFakeDb({ skillRows: [{ name: "Git", github_signals: " , " }], habilidades: ["Git"] });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("nao_verificavel");
    expect(resultado.naoVerificaveis).toEqual(["Git"]);
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("2 verificáveis encontradas + 1 não verificável → aprovado, com a não verificável listada", async () => {
    const handler = instalarFakeDb({
      habilidades: ["JavaScript", "React", "Comunicação"],
      skillRows: [
        { name: "JavaScript", github_signals: "javascript,js" },
        { name: "React", github_signals: "react,jsx" },
      ],
    });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "JavaScript", confidence: 40, encontrada: true },
      { habilidade: "React", confidence: 20, encontrada: true },
    ]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("aprovado");
    expect(resultado.naoVerificaveis).toEqual(["Comunicação"]);
    // só as verificáveis vão para a análise do repositório
    expect(verificarHabilidadesNoRepo.mock.calls[0][2].map(h => h.habilidade)).toEqual(["JavaScript", "React"]);
    expect(atualizacoesDeStatus(handler).join(" ")).toContain("projeto_status = 'verificado'");
  });

  test("verificável não encontrada + não verificável → faltando lista só a verificável e informa a outra", async () => {
    instalarFakeDb({
      habilidades: ["JavaScript", "Comunicação"],
      skillRows: [{ name: "JavaScript", github_signals: "javascript,js" }],
    });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });
    verificarHabilidadesNoRepo.mockResolvedValue([{ habilidade: "JavaScript", confidence: 0, encontrada: false }]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("faltando");
    expect(resultado.faltando).toEqual(["JavaScript"]);
    expect(resultado.naoVerificaveis).toEqual(["Comunicação"]);
  });

  test("nome da habilidade com outra caixa (javascript × JavaScript) ainda conta como verificável", async () => {
    instalarFakeDb({
      habilidades: ["javascript"],
      skillRows: [{ name: "JavaScript", github_signals: "javascript,js" }],
    });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });
    verificarHabilidadesNoRepo.mockResolvedValue([{ habilidade: "JavaScript", confidence: 40, encontrada: true }]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(resultado.status).toBe("aprovado");
    expect(resultado.naoVerificaveis).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// Autoria do repositório — roadmapService (decisão) e githubAnalyzer real
// (regras de dono/commit) com axios mockado.
// ──────────────────────────────────────────────────────────
describe("verificarProjeto — autoria do repositório", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];
  const MSG = "Esse repositório não parece ser seu. Envie um repositório da sua conta ou em que você tenha commits.";

  function escritasNaFase(handler) {
    return handler.mock.calls.filter(([sql]) => sql.trim().toLowerCase().startsWith("update roadmap_fases"));
  }

  test("autor → segue para a verificação de habilidades", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, owner: { id: 111, login: "dev" }, fork: false });
    verificarHabilidadesNoRepo.mockResolvedValue([{ habilidade: "JavaScript", confidence: 60, encontrada: true }]);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(verificarAutoriaDoRepo).toHaveBeenCalledWith(
      "token-fake", "dev/meu-projeto", 111, "dev",
      expect.objectContaining({ owner: { id: 111, login: "dev" } })
    );
    expect(r.status).toBe("aprovado");
  });

  test("não é autor → erro, sem mudar projeto_status nem analisar", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, owner: { id: 999, login: "outro" }, fork: false });
    verificarAutoriaDoRepo.mockResolvedValue(false);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r).toEqual({ status: "erro", mensagem: MSG });
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
    expect(escritasNaFase(handler)).toEqual([]);
  });

  test("GitHub fora do ar na checagem de autoria → indisponivel (não 'não é autor')", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, owner: { id: 999 }, fork: false });
    const { GitHubIndisponivelError } = require("../services/githubErrors");
    verificarAutoriaDoRepo.mockRejectedValue(new GitHubIndisponivelError("dev/meu-projeto"));

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.status).toBe("indisponivel");
    expect(escritasNaFase(handler)).toEqual([]);
  });

  test("sessão sem github_id → erro pedindo para conectar, sem chamar a API", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", { id: undefined, login: "dev" });

    expect(r.status).toBe("erro");
    expect(r.mensagem.toLowerCase()).toMatch(/conecte/);
    expect(verificarRepoPublico).not.toHaveBeenCalled();
    expect(verificarAutoriaDoRepo).not.toHaveBeenCalled();
  });
});

jest.mock("axios");
describe("verificarAutoriaDoRepo (githubAnalyzer real, axios mockado)", () => {
  const axios = require("axios");
  const real = jest.requireActual("../services/githubAnalyzer");
  const repo = (id, fork = false) => ({ owner: { id }, fork });

  beforeEach(() => axios.get.mockReset());

  test("dono (por id) de repositório não-fork → autor, sem consultar commits", async () => {
    expect(await real.verificarAutoriaDoRepo("t", "dev/r", 111, "dev", repo(111))).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("login renomeado não atrapalha: compara pelo id", async () => {
    expect(await real.verificarAutoriaDoRepo("t", "novo/r", 111, "login-antigo", repo(111))).toBe(true);
  });

  test("repositório de outro usuário sem commits dele → não é autor", async () => {
    axios.get.mockResolvedValue({ data: [] });
    expect(await real.verificarAutoriaDoRepo("t", "outro/r", 111, "dev", repo(999))).toBe(false);
    expect(axios.get.mock.calls[0][0]).toBe("https://api.github.com/repos/outro/r/commits");
    expect(axios.get.mock.calls[0][1].params).toEqual({ author: "dev", per_page: 1 });
  });

  test("repositório de organização com commit do usuário → autor", async () => {
    axios.get.mockResolvedValue({ data: [{ sha: "abc" }] });
    expect(await real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500))).toBe(true);
  });

  test("fork próprio sem commits do usuário → não é autor", async () => {
    axios.get.mockResolvedValue({ data: [] });
    expect(await real.verificarAutoriaDoRepo("t", "dev/fork", 111, "dev", repo(111, true))).toBe(false);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test("repositório vazio (409) → não é autor", async () => {
    axios.get.mockRejectedValue({ response: { status: 409 } });
    expect(await real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500))).toBe(false);
  });

  test.each([[500], [429], [401]])("HTTP %i na busca de commits → GitHubIndisponivelError", async (status) => {
    axios.get.mockRejectedValue({ response: { status } });
    await expect(real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500)))
      .rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });

  test("erro de rede (sem resposta) → GitHubIndisponivelError", async () => {
    axios.get.mockRejectedValue(new Error("ECONNRESET"));
    await expect(real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500)))
      .rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });
});
