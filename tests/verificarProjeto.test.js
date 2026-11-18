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
  // constantes de rigor: as reais, para o serviço e os testes usarem os mesmos valores
  ...(({ COMMITS_MINIMOS, MOTIVO_NAO_ENCONTRADA, MOTIVO_SO_README, LIMITE_LINGUAGEM_FORTE }) =>
    ({ COMMITS_MINIMOS, MOTIVO_NAO_ENCONTRADA, MOTIVO_SO_README, LIMITE_LINGUAGEM_FORTE }))(
    jest.requireActual("../services/githubAnalyzer")),
  // matchSkillsFromGitHub/fetchRepoLanguages/fetchRepoReadme não são
  // usados por roadmapService diretamente — só o necessário é mockado.
}));

const db = require("../database/db");
const { verificarRepoPublico, verificarHabilidadesNoRepo, verificarAutoriaDoRepo } = require("../services/githubAnalyzer");
const { verificarProjeto, fecharProjetoSemVerificar } = require("../services/roadmapService");

const FASE = { id: 10, roadmap_id: 1, nome: "Fase 1", usuario_id: 5 };
const REPO_URL = "https://github.com/dev/meu-projeto";
const USUARIO = { id: 111, login: "dev" };
// UPDATE só do horário de envio (limite de reenvio) — não conta como escrita de status/URL.
const soHorarioDeEnvio = (sql) => /set projeto_ultimo_envio_em = now\(\) where/i.test(sql.replace(/\s+/g, " "));

function instalarFakeDb({ skillRows = [], perfilExistente = null, habilidades = ["JavaScript"], projetoHabilidades = null } = {}) {
  const handler = jest.fn(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.includes("from roadmap_fases rf") && s.includes("join roadmaps r")) {
      return [[{ ...FASE, projeto_habilidades: projetoHabilidades }]];
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
  verificarAutoriaDoRepo.mockResolvedValue({ autor: true, commits: 3 });
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
    handler.mock.calls.filter(([sql]) => sql.toLowerCase().trim().startsWith("update roadmap_fases") && !soHorarioDeEnvio(sql));

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
    return handler.mock.calls.filter(([sql]) => sql.trim().toLowerCase().startsWith("update roadmap_fases") && !soHorarioDeEnvio(sql));
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
    verificarAutoriaDoRepo.mockResolvedValue({ autor: false, commits: 0 });

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
  const commits = (n) => ({ data: Array.from({ length: n }, (_, i) => ({ sha: `c${i}` })) });

  beforeEach(() => axios.get.mockReset());

  test("dono (por id) de repositório não-fork → autor, e conta os commits dele (per_page = mínimo exigido)", async () => {
    axios.get.mockResolvedValue(commits(3));
    expect(await real.verificarAutoriaDoRepo("t", "dev/r", 111, "dev", repo(111))).toEqual({ autor: true, commits: 3 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][1].params).toEqual({ author: "dev", per_page: real.COMMITS_MINIMOS });
  });

  test("dono sem commits no repositório continua autor, com 0 commits", async () => {
    axios.get.mockResolvedValue({ data: [] });
    expect(await real.verificarAutoriaDoRepo("t", "dev/r", 111, "dev", repo(111))).toEqual({ autor: true, commits: 0 });
  });

  test("login renomeado não atrapalha: compara pelo id", async () => {
    axios.get.mockResolvedValue(commits(1));
    expect((await real.verificarAutoriaDoRepo("t", "novo/r", 111, "login-antigo", repo(111))).autor).toBe(true);
  });

  test("repositório de outro usuário sem commits dele → não é autor", async () => {
    axios.get.mockResolvedValue({ data: [] });
    expect(await real.verificarAutoriaDoRepo("t", "outro/r", 111, "dev", repo(999))).toEqual({ autor: false, commits: 0 });
    expect(axios.get.mock.calls[0][0]).toBe("https://api.github.com/repos/outro/r/commits");
  });

  test("repositório de organização com commit do usuário → autor", async () => {
    axios.get.mockResolvedValue(commits(1));
    expect(await real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500))).toEqual({ autor: true, commits: 1 });
  });

  test("fork próprio sem commits do usuário → não é autor", async () => {
    axios.get.mockResolvedValue({ data: [] });
    expect(await real.verificarAutoriaDoRepo("t", "dev/fork", 111, "dev", repo(111, true))).toEqual({ autor: false, commits: 0 });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test("repositório vazio (409) → não é autor", async () => {
    axios.get.mockRejectedValue({ response: { status: 409 } });
    expect(await real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500))).toEqual({ autor: false, commits: 0 });
  });

  test.each([[500], [429], [401]])("HTTP %i na busca de commits → GitHubIndisponivelError", async (status) => {
    axios.get.mockRejectedValue({ response: { status } });
    await expect(real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500)))
      .rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });

  test("busca de commits falhando também para o DONO → GitHubIndisponivelError (a contagem é obrigatória)", async () => {
    axios.get.mockRejectedValue({ response: { status: 500 } });
    await expect(real.verificarAutoriaDoRepo("t", "dev/r", 111, "dev", repo(111)))
      .rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });

  test("erro de rede (sem resposta) → GitHubIndisponivelError", async () => {
    axios.get.mockRejectedValue(new Error("ECONNRESET"));
    await expect(real.verificarAutoriaDoRepo("t", "org/r", 111, "dev", repo(500)))
      .rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });
});

// ──────────────────────────────────────────────────────────
// Rigor da verificação — sinal forte obrigatório (analisador real, axios
// mockado) e evidência mínima de trabalho (commits).
// ──────────────────────────────────────────────────────────
describe("verificarHabilidadesNoRepo — sinal forte obrigatório", () => {
  const axios = require("axios");
  const real = jest.requireActual("../services/githubAnalyzer");

  // linguagens (bytes), README e arquivos da raiz do repositório
  function instalarRepo({ languages = {}, readme = "", arquivos = {} } = {}) {
    axios.get.mockReset();
    axios.get.mockImplementation(async (url) => {
      if (url.endsWith("/languages")) return { data: languages };
      if (url.endsWith("/readme")) return { data: readme };
      if (url.endsWith("/contents")) return { data: Object.keys(arquivos).map(name => ({ name, type: "file" })) };
      const arq = decodeURIComponent(url.split("/contents/")[1] ?? "");
      if (arq in arquivos) return { data: arquivos[arq] };
      throw Object.assign(new Error("404"), { response: { status: 404, headers: {}, data: {} } });
    });
  }
  const verificar = (habilidade, sinais) => real.verificarHabilidadesNoRepo("t", "dev/r", [{ habilidade, sinais }]).then(r => r[0]);

  test("habilidade só no README → não encontrada, motivo 'só README' (a confiança ainda soma os 20 pontos)", async () => {
    instalarRepo({ readme: "Projeto feito com React e Express" });
    expect(await verificar("React", ["react", "reactjs"])).toEqual({
      habilidade: "React", confidence: 20, encontrada: false, motivo: real.MOTIVO_SO_README,
    });
  });

  test("habilidade sem nenhum sinal → não encontrada, motivo 'não encontrada'", async () => {
    instalarRepo({ languages: { Python: 100 }, readme: "script de dados" });
    expect(await verificar("React", ["react"])).toEqual({
      habilidade: "React", confidence: 0, encontrada: false, motivo: real.MOTIVO_NAO_ENCONTRADA,
    });
  });

  test("habilidade com dependência declarada → encontrada (mesmo sem README)", async () => {
    instalarRepo({
      languages: { Python: 100 },
      arquivos: { "package.json": JSON.stringify({ dependencies: { express: "^4.18.0" } }) },
    });
    const r = await verificar("Express.js", ["express", "expressjs"]);
    expect(r.encontrada).toBe(true);
    expect(r.confidence).toBe(40);
    expect(r.motivo).toBeUndefined();
  });

  test("linguagem abaixo de 5% dos bytes, sem dependência → não encontrada", async () => {
    instalarRepo({ languages: { Python: 96, JavaScript: 4 } });
    expect(await verificar("JavaScript", ["javascript"])).toMatchObject({
      encontrada: false, motivo: real.MOTIVO_NAO_ENCONTRADA,
    });
  });

  test("linguagem abaixo de 5% + README → não encontrada, motivo 'só README'", async () => {
    instalarRepo({ languages: { Python: 96, JavaScript: 4 }, readme: "usa javascript no front" });
    expect(await verificar("JavaScript", ["javascript"])).toMatchObject({
      encontrada: false, motivo: real.MOTIVO_SO_README,
    });
  });

  test("linguagem com 5% ou mais dos bytes → encontrada", async () => {
    instalarRepo({ languages: { Python: 95, JavaScript: 5 } });
    expect(await verificar("JavaScript", ["javascript"])).toMatchObject({ encontrada: true });
    instalarRepo({ languages: { Python: 50, JavaScript: 50 } });
    expect(await verificar("JavaScript", ["javascript"])).toMatchObject({ encontrada: true });
  });

  test("sinônimo no limite: o sinal que passa dos 5% basta", async () => {
    instalarRepo({ languages: { Python: 60, JavaScript: 2, TypeScript: 38 } });
    expect(await verificar("TS ou JS", ["javascript", "typescript"])).toMatchObject({ encontrada: true });
  });
});

describe("verificarProjeto — evidência mínima de trabalho (commits) e motivos", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];
  const COMMITS_MSG = "Faça pelo menos 3 commits com o seu trabalho no repositório. " +
    "Só contam commits feitos com um e-mail vinculado à sua conta do GitHub.";
  const repoDe = (extra = {}) => ({ existe: true, privado: false, owner: { id: 111, login: "dev" }, fork: false, ...extra });
  const forte = [{ habilidade: "JavaScript", confidence: 60, encontrada: true }];
  const statusGravados = (handler) =>
    handler.mock.calls.map(([sql]) => sql.toLowerCase()).filter(sql => sql.includes("projeto_status"));

  test("fork com 1 commit do usuário → em_revisao, com o item de commits na lista do que falta", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue(repoDe({ owner: { id: 999, login: "outro" }, fork: true }));
    verificarAutoriaDoRepo.mockResolvedValue({ autor: true, commits: 1 });
    verificarHabilidadesNoRepo.mockResolvedValue(forte);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.status).toBe("faltando");
    expect(r.pendencias).toEqual([COMMITS_MSG]);
    expect(r.faltando).toEqual([]);
    expect(statusGravados(handler).join(" ")).toContain("projeto_status = 'em_revisao'");
    expect(statusGravados(handler).join(" ")).not.toContain("'verificado'");
  });

  test("dono com 2 commits (menos que o mínimo) → em_revisao mesmo com habilidades fortes", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue(repoDe());
    verificarAutoriaDoRepo.mockResolvedValue({ autor: true, commits: 2 });
    verificarHabilidadesNoRepo.mockResolvedValue(forte);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);
    expect(r.status).toBe("faltando");
    expect(r.pendencias).toContain(COMMITS_MSG);
  });

  test("dono com 3 commits e todas as habilidades fortes → verificado", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue(repoDe());
    verificarAutoriaDoRepo.mockResolvedValue({ autor: true, commits: 3 });
    verificarHabilidadesNoRepo.mockResolvedValue(forte);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.status).toBe("aprovado");
    expect(r.pendencias).toBeUndefined();
    expect(statusGravados(handler).join(" ")).toContain("projeto_status = 'verificado'");
  });

  test("a lista do que falta diz o motivo de cada habilidade (só README × não encontrada) e junta o item de commits", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue(repoDe());
    verificarAutoriaDoRepo.mockResolvedValue({ autor: true, commits: 0 });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "React", confidence: 20, encontrada: false, motivo: "so_readme" },
      { habilidade: "Docker", confidence: 0, encontrada: false, motivo: "nao_encontrada" },
      { habilidade: "JavaScript", confidence: 60, encontrada: true },
    ]);

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.faltando).toEqual(["React", "Docker"]);
    expect(r.pendencias).toEqual([
      "React — só aparece no README; falta uso no código/dependências",
      "Docker — não encontrada",
      COMMITS_MSG,
    ]);
  });

  test("busca de commits falhando → indisponivel, sem mexer no status da fase", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue(repoDe());
    const { GitHubIndisponivelError } = require("../services/githubErrors");
    verificarAutoriaDoRepo.mockRejectedValue(new GitHubIndisponivelError("dev/meu-projeto"));

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.status).toBe("indisponivel");
    expect(statusGravados(handler)).toEqual([]);
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("fase já 'verificado' não é reavaliada: nem GitHub, nem escrita", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    handler.getMockImplementation?.();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (sql.toLowerCase().includes("from roadmap_fases rf") && sql.toLowerCase().includes("join roadmaps r")) {
        return [[{ ...FASE, projeto_status: "verificado" }]];
      }
      return original(sql, params);
    });

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r).toEqual({ status: "erro", mensagem: "Esta fase já foi verificada." });
    expect(verificarRepoPublico).not.toHaveBeenCalled();
    expect(verificarAutoriaDoRepo).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.trim().toLowerCase().startsWith("update"))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Regras de envio (validarEnvioDaFase), limite de reenvio e URL normalizada
// ──────────────────────────────────────────────────────────
describe("validarEnvioDaFase — etapas e limite de reenvio", () => {
  const { validarEnvioDaFase } = require("../services/roadmapService");

  function fakeDb({ pendentes = 0, segundos = null } = {}) {
    const handler = jest.fn(async (sql) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
      if (s.startsWith("select count(*) as pendentes from roadmap_etapas")) return [[{ pendentes }]];
      if (s.includes("timestampdiff") && s.includes("from roadmap_fases")) return [[{ segundos }]];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
    db.query.mockImplementation(handler);
    return handler;
  }

  test("etapas pendentes → erro com a quantidade; não grava nada nem olha o limite de reenvio", async () => {
    const handler = fakeDb({ pendentes: 3 });
    const r = await validarEnvioDaFase(FASE.id);
    expect(r).toMatchObject({
      status: "erro",
      mensagem: "Conclua todas as etapas da fase antes de enviar o projeto.",
      etapasPendentes: 3,
    });
    expect(handler.mock.calls.every(([sql]) => sql.trim().toLowerCase().startsWith("select"))).toBe(true);
  });

  test("etapas concluídas e nunca enviou → liberado", async () => {
    fakeDb({ pendentes: 0, segundos: null });
    expect(await validarEnvioDaFase(FASE.id)).toBeNull();
  });

  test("reenvio com menos de 5 min → recusado com 'Aguarde X min'", async () => {
    fakeDb({ segundos: 60 }); // 1 min atrás → faltam 4
    const r = await validarEnvioDaFase(FASE.id);
    expect(r.status).toBe("erro");
    expect(r.mensagem).toBe("Aguarde 4 min para reenviar.");
  });

  test("faltando poucos segundos arredonda para cima (mínimo 1 min)", async () => {
    fakeDb({ segundos: 299 });
    expect((await validarEnvioDaFase(FASE.id)).mensagem).toBe("Aguarde 1 min para reenviar.");
  });

  test("depois de 5 min → aceito", async () => {
    fakeDb({ segundos: 300 });
    expect(await validarEnvioDaFase(FASE.id)).toBeNull();
    fakeDb({ segundos: 3600 });
    expect(await validarEnvioDaFase(FASE.id)).toBeNull();
  });
});

describe("projeto_ultimo_envio_em — só grava quando o envio chega a rodar", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];
  const gravacoesDeHorario = (handler) =>
    handler.mock.calls.filter(([sql]) => /projeto_ultimo_envio_em\s*=\s*NOW\(\)/i.test(sql));

  test("PRO: link inválido (erro de validação) não grava o horário", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    const r = await verificarProjeto(FASE.id, "não é uma url", "token-fake", USUARIO);
    expect(r.status).toBe("erro");
    expect(gravacoesDeHorario(handler)).toEqual([]);
  });

  test("PRO: sem github_id (erro de validação) não grava o horário", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    await verificarProjeto(FASE.id, REPO_URL, "token-fake", { login: "dev" });
    expect(gravacoesDeHorario(handler)).toEqual([]);
  });

  test("PRO: envio que chega a consultar o GitHub grava o horário (mesmo se indisponível)", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: true });
    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);
    expect(r.status).toBe("indisponivel");
    expect(gravacoesDeHorario(handler)).toHaveLength(1);
  });

  test("Free: link inválido não grava o horário e não fecha a fase", async () => {
    const handler = instalarFakeDb();
    const r = await fecharProjetoSemVerificar(FASE.id, "https://exemplo.com/x/y");
    expect(r.status).toBe("erro");
    expect(handler.mock.calls.filter(([sql]) => sql.trim().toLowerCase().startsWith("update"))).toEqual([]);
  });

  test("Free: fechar a fase grava o horário junto com o status", async () => {
    const handler = instalarFakeDb();
    const r = await fecharProjetoSemVerificar(FASE.id, REPO_URL);
    expect(r.status).toBe("nao_verificado");
    expect(gravacoesDeHorario(handler)).toHaveLength(1);
  });
});

describe("URL do repositório normalizada", () => {
  const { normalizarUrlRepo } = require("../services/roadmapService");
  const CANONICA = "https://github.com/dev/meu-projeto";
  const VARIACOES = [
    "https://github.com/dev/meu-projeto",
    "https://github.com/dev/meu-projeto.git",
    "https://github.com/dev/meu-projeto/",
    "https://github.com/dev/meu-projeto/tree/main",
    "https://github.com/dev/meu-projeto/tree/feature/x/src",
    "https://github.com/dev/meu-projeto?tab=readme-ov-file",
    "https://github.com/dev/meu-projeto/#readme",
    "http://www.github.com/dev/meu-projeto.git",
    "github.com/dev/meu-projeto/",
    "  https://github.com/dev/meu-projeto  ",
  ];

  test.each(VARIACOES)("normaliza %p", (entrada) => {
    expect(normalizarUrlRepo(entrada)).toBe(CANONICA);
  });

  test("nome de repositório com ponto não é cortado", () => {
    expect(normalizarUrlRepo("https://github.com/dev/meu.projeto.git")).toBe("https://github.com/dev/meu.projeto");
  });

  test("não é repositório do GitHub → null", () => {
    expect(normalizarUrlRepo("https://gitlab.com/dev/meu-projeto")).toBeNull();
    expect(normalizarUrlRepo("https://github.com/dev")).toBeNull();
    expect(normalizarUrlRepo("")).toBeNull();
  });

  test("Free grava a URL normalizada", async () => {
    const handler = instalarFakeDb();
    await fecharProjetoSemVerificar(FASE.id, "https://github.com/dev/meu-projeto.git/tree/main?tab=x");
    const upd = handler.mock.calls.find(([sql]) => /update roadmap_fases/i.test(sql) && /nao_verificado/.test(sql));
    expect(upd[1][0]).toBe(CANONICA);
  });

  test("PRO grava o html_url devolvido pela API (não o que o usuário digitou)", async () => {
    const handler = instalarFakeDb({ skillRows: [{ name: "JavaScript", github_signals: "javascript,js" }] });
    verificarRepoPublico.mockResolvedValue({
      existe: true, privado: false, owner: { id: 111, login: "dev" }, fork: false,
      html_url: "https://github.com/Dev/Meu-Projeto",
    });
    verificarHabilidadesNoRepo.mockResolvedValue([{ habilidade: "JavaScript", confidence: 60, encontrada: true }]);

    await verificarProjeto(FASE.id, "https://github.com/dev/meu-projeto.git/tree/main", "token-fake", USUARIO);

    const upd = handler.mock.calls.find(([sql]) => /projeto_status = 'verificado'/i.test(sql));
    expect(upd[1][0]).toBe("https://github.com/Dev/Meu-Projeto");
  });

  test("repositório não encontrado: continua sem mudar projeto_status; salva a URL normalizada", async () => {
    const handler = instalarFakeDb();
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: false });

    const r = await verificarProjeto(FASE.id, "https://github.com/dev/meu-projeto.git", "token-fake", USUARIO);

    expect(r.status).toBe("erro");
    const upd = handler.mock.calls.find(([sql]) => /set projeto_repo_url = \? where/i.test(sql.replace(/\s+/g, " ")));
    expect(upd[1][0]).toBe(CANONICA);
    expect(handler.mock.calls.some(([sql]) => /projeto_status/i.test(sql))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Habilidades-alvo: projeto_habilidades (novo) × habilidades das etapas (roadmaps antigos)
// ──────────────────────────────────────────────────────────
describe("verificarProjeto — habilidades-alvo da fase", () => {
  const repoOk = { existe: true, privado: false, owner: { id: 111, login: "dev" }, fork: false };
  const normalizar = (sql) => sql.toLowerCase().replace(/\s+/g, " ").trim();
  const chamou = (handler, prefixo) => handler.mock.calls.some(([sql]) => normalizar(sql).startsWith(prefixo));
  const consultaDeSkills = (handler) =>
    handler.mock.calls.find(([sql]) => normalizar(sql).startsWith("select name, github_signals from skills"));

  beforeEach(() => {
    verificarRepoPublico.mockResolvedValue(repoOk);
    verificarHabilidadesNoRepo.mockImplementation(async (_t, _r, habs) =>
      habs.map(h => ({ habilidade: h.habilidade, confidence: 60, encontrada: true })));
  });

  test("fase com projeto_habilidades → verifica essas habilidades, não as das etapas", async () => {
    const handler = instalarFakeDb({
      projetoHabilidades: JSON.stringify(["React", "Node.js"]),
      habilidades: ["JavaScript"], // etapas — devem ser ignoradas
      skillRows: [
        { name: "React", github_signals: "react" },
        { name: "Node.js", github_signals: "nodejs,node" },
      ],
    });

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(consultaDeSkills(handler)[1][0]).toEqual(["React", "Node.js"]);
    expect(chamou(handler, "select distinct habilidade from roadmap_etapas")).toBe(false);
    expect(verificarHabilidadesNoRepo.mock.calls[0][2].map(h => h.habilidade)).toEqual(["React", "Node.js"]);
    expect(r.status).toBe("aprovado");
  });

  test.each([
    ["NULL (roadmap antigo)", null],
    ["string vazia", ""],
    ["lista vazia", "[]"],
    ["JSON inválido", "{não é json"],
  ])("fase sem projeto_habilidades (%s) → usa as habilidades das etapas, como antes", async (_nome, valor) => {
    const aviso = jest.spyOn(console, "warn").mockImplementation(() => {});
    const handler = instalarFakeDb({
      projetoHabilidades: valor,
      habilidades: ["JavaScript"],
      skillRows: [{ name: "JavaScript", github_signals: "javascript,js" }],
    });

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(chamou(handler, "select distinct habilidade from roadmap_etapas")).toBe(true);
    expect(consultaDeSkills(handler)[1][0]).toEqual(["JavaScript"]);
    expect(r.status).toBe("aprovado");
    aviso.mockRestore();
  });

  test("habilidade do projeto sem sinais cadastrados continua sendo listada como não verificável", async () => {
    instalarFakeDb({
      projetoHabilidades: JSON.stringify(["JavaScript", "Comunicação"]),
      skillRows: [{ name: "JavaScript", github_signals: "javascript,js" }],
    });

    const r = await verificarProjeto(FASE.id, REPO_URL, "token-fake", USUARIO);

    expect(r.status).toBe("aprovado");
    expect(r.naoVerificaveis).toEqual(["Comunicação"]);
  });
});
