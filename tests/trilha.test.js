// tests/trilha.test.js
// Testa routes/trilha.js com supertest. server.js tem efeitos colaterais
// ao ser importado (conecta no banco real, abre a porta) — por isso o
// teste monta um app Express mínimo que só registra sessão fake + o
// router sob teste, igual ao próprio app faria a partir de /trilha.
const request = require("supertest");
const express = require("express");
const path    = require("path");

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

// gerarRoadmap/regenerarRoadmap/verificarProjeto/fecharProjetoSemVerificar
// não são o foco aqui (verificarProjeto/fecharProjetoSemVerificar já têm
// tests/verificarProjeto.test.js próprio) — só precisamos que existam pra
// não quebrar o require do controller.
jest.mock("../services/roadmapService", () => ({
  gerarRoadmap: jest.fn(),
  regenerarRoadmap: jest.fn(),
  verificarProjeto: jest.fn(),
  fecharProjetoSemVerificar: jest.fn(),
  validarEnvioDaFase: jest.fn(),
}));

const db = require("../database/db");
const trilhaRoutes = require("../routes/trilha");

function montarApp(sessionUser) {
  const app = express();
  // mesmo view engine/views do server.js real — os controllers usam
  // res.render("404")/res.render("500") e as views de views/roadmap/*.
  app.set("views", path.join(__dirname, "..", "views"));
  app.set("view engine", "ejs");
  app.use(express.json());
  // express.urlencoded não precisa ser registrado aqui — mora dentro do
  // próprio trilhaRoutes agora (routes/trilha.js), igual em produção.
  // Sessão fake — sem express-session/MySQLStore de verdade, só o shape
  // que requireDev/os controllers leem (req.session.user).
  // Um único objeto por app (persiste entre requisições, como a sessão real
  // via cookie) e com save() — o enviarProjeto grava o flash e salva antes
  // do redirect.
  const sessao = sessionUser ? { user: sessionUser } : {};
  sessao.save = (cb) => cb();
  app.use((req, res, next) => {
    req.session = sessao;
    next();
  });
  app.use("/trilha", trilhaRoutes);
  return app;
}

const DEV_USER = { id: 1, type: "dev" };

beforeEach(() => {
  jest.clearAllMocks();
  require("../services/roadmapService").validarEnvioDaFase.mockResolvedValue(null);
});

describe("GET /trilha — sem login", () => {
  test("redireciona para /login com ?next=", async () => {
    const app = montarApp(null);
    const res = await request(app).get("/trilha");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?next=%2Ftrilha");
  });
});

describe("GET /trilha/:id — roadmap de outro usuário", () => {
  test("responde 404 (não revela se o id existe)", async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.toLowerCase().includes("from roadmaps where id")) {
        return [[]]; // usuario_id não bate no WHERE → nenhuma linha
      }
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const app = montarApp(DEV_USER);
    const res = await request(app).get("/trilha/999");

    expect(res.status).toBe(404);
  });
});

describe("POST /trilha — limite do plano Free atingido", () => {
  test("bloqueia a criação com mensagem amigável (nunca a tela de erro genérica)", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      // subscriptionService.getUserPlan: sem assinatura ativa → cai no
      // DEFAULT_PLAN_BY_TYPE.dev = "dev_free" (config/plans.js real, não mockado).
      if (s.includes("from user_subscriptions")) return [[]];
      // Free = 1 roadmap ativo no máximo — já tem 1.
      if (s.includes("count(*)") && s.includes("from roadmaps")) return [[{ total: 1 }]];
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const app = montarApp(DEV_USER);
    const res = await request(app)
      .post("/trilha")
      .send({ tipo: "area", area: "front-end", horasSemana: 10 });

    expect(res.status).toBe(402); // bloqueio por plano — não é a tela de erro (404/500)
    expect(res.text).toMatch(/limite de 1 roadmap/i);
    expect(res.text).toMatch(/\/planos/); // link de upgrade
  });
});

describe("POST /trilha/:id/regenerar — intervalo entre regenerações (sem IA, o limite é só do plano)", () => {
  const { regenerarRoadmap } = require("../services/roadmapService");

  function mockDbComRoadmap(roadmap) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[roadmap]];
      if (s.includes("from user_subscriptions"))  return [[]]; // sem assinatura ativa → dev_free
      throw new Error(`rota não mapeada: ${sql}`);
    });
  }

  test("roadmap gerado agora (origem='modelo' = algoritmo) → Free bloqueado com 402 até completar o intervalo", async () => {
    mockDbComRoadmap({
      id: 1, usuario_id: 1, origem: "modelo",
      gerado_em: new Date(), // dentro dos 30 dias do plano Free
    });

    const app = montarApp(DEV_USER);
    const res = await request(app).post("/trilha/1/regenerar");

    expect(res.status).toBe(402);
    expect(res.text).toMatch(/próxima regeneração/i);
    expect(regenerarRoadmap).not.toHaveBeenCalled();
  });

  test("roadmap antigo gerado pela IA (origem='ia') segue a mesma regra → 402", async () => {
    mockDbComRoadmap({
      id: 2, usuario_id: 1, origem: "ia",
      gerado_em: new Date(),
    });

    const res = await request(montarApp(DEV_USER)).post("/trilha/2/regenerar");

    expect(res.status).toBe(402);
    expect(regenerarRoadmap).not.toHaveBeenCalled();
  });

  test("passado o intervalo do plano Free (30 dias) → regenera e redireciona pro detalhe", async () => {
    mockDbComRoadmap({
      id: 3, usuario_id: 1, origem: "modelo",
      gerado_em: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    regenerarRoadmap.mockResolvedValue({ roadmapId: 3 });

    const res = await request(montarApp(DEV_USER)).post("/trilha/3/regenerar");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/trilha/3");
    expect(regenerarRoadmap).toHaveBeenCalledWith(3);
  });
});

describe("POST /trilha — envio real do <form> (application/x-www-form-urlencoded)", () => {
  const { gerarRoadmap } = require("../services/roadmapService");

  test("área válida → redireciona para /trilha/:id (bug: req.body vinha vazio sem express.urlencoded)", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from user_subscriptions")) return [[]]; // dev_free
      if (s.includes("count(*)") && s.includes("from roadmaps")) return [[{ total: 0 }]];
      throw new Error(`rota não mapeada: ${sql}`);
    });
    gerarRoadmap.mockResolvedValue({ roadmapId: 42 });

    const app = montarApp(DEV_USER);
    const res = await request(app)
      .post("/trilha")
      .type("form") // supertest: Content-Type application/x-www-form-urlencoded, igual ao <form> real
      .send({ tipo: "area", area: "front-end", horasSemana: "10" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/trilha/42");
    expect(gerarRoadmap).toHaveBeenCalledWith(DEV_USER.id, { tipo: "area", area: "front-end" }, 10);
  });
});

describe("POST /trilha/:id/fases/:faseId/projeto — gate de plano", () => {
  const { verificarProjeto, fecharProjetoSemVerificar } = require("../services/roadmapService");

  function mockDbParaEnvioDeProjeto(roadmap) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[roadmap]];
      if (s.includes("from roadmap_fases where id")) return [[{ id: 7 }]];
      if (s.includes("from jobs where id")) return [[]];
      if (s.includes("from roadmap_fases where roadmap_id")) return [[]];
      if (s.includes("from roadmap_etapas re")) return [[]];
      if (s.includes("from user_subscriptions")) return [[]]; // sem assinatura ativa → dev_free
      throw new Error(`rota não mapeada: ${sql}`);
    });
  }

  test("usuário Free → fecha por autodeclaração, nunca chama verificarProjeto", async () => {
    mockDbParaEnvioDeProjeto({ id: 1, usuario_id: 1 });
    fecharProjetoSemVerificar.mockResolvedValue({ status: "nao_verificado", mensagem: "ok" });

    const app = montarApp(DEV_USER);
    const res = await request(app)
      .post("/trilha/1/fases/7/projeto")
      .type("form")
      .send({ repoUrl: "https://github.com/dev/projeto" });

    expect(res.status).toBe(302); // PRG: nunca re-renderiza o POST
    expect(fecharProjetoSemVerificar).toHaveBeenCalledWith(7, "https://github.com/dev/projeto");
    expect(verificarProjeto).not.toHaveBeenCalled();
  });

  // ── Regras de envio: etapas pendentes / reenvio ──
  const { validarEnvioDaFase } = require("../services/roadmapService");

  test.each([
    ["Free", false],
    ["PRO",  true],
  ])("%s — etapas pendentes → erro, sem verificar nem fechar a fase", async (_nome, pro) => {
    mockDbParaEnvioDeProjeto({ id: 1, usuario_id: 1 });
    const base = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (pro && sql.toLowerCase().includes("from user_subscriptions")) {
        return [[{ plan_id: "dev_pro", status: "active", expires_at: null }]];
      }
      return base(sql, params);
    });
    validarEnvioDaFase.mockResolvedValue({
      status: "erro", mensagem: "Conclua todas as etapas da fase antes de enviar o projeto.", etapasPendentes: 2,
    });

    const app = montarApp(DEV_USER);
    const res = await request(app)
      .post("/trilha/1/fases/7/projeto").type("form")
      .send({ repoUrl: "https://github.com/dev/projeto" });

    expect(res.status).toBe(302);
    expect(validarEnvioDaFase).toHaveBeenCalledWith(7);
    expect(verificarProjeto).not.toHaveBeenCalled();
    expect(fecharProjetoSemVerificar).not.toHaveBeenCalled();
  });

  test("link vazio → erro de validação sem nem consultar as regras de envio", async () => {
    mockDbParaEnvioDeProjeto({ id: 1, usuario_id: 1 });
    const app = montarApp(DEV_USER);
    const res = await request(app).post("/trilha/1/fases/7/projeto").type("form").send({ repoUrl: "  " });
    expect(res.status).toBe(302);
    expect(validarEnvioDaFase).not.toHaveBeenCalled();
  });

  test("PRG: POST responde 302 e o flash aparece uma única vez no GET (F5 não repete nem reenvia)", async () => {
    mockDbParaEnvioDeProjeto({ id: 1, usuario_id: 1, tipo_objetivo: "area", area: "front-end", horas_semana: 10 });
    const base = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmap_fases where roadmap_id")) {
        return [[{ id: 7, nome: "Fase 1", objetivo: "x", projeto_enunciado: "y", projeto_status: "nao_verificado", projeto_repo_url: null }]];
      }
      return base(sql, params);
    });
    fecharProjetoSemVerificar.mockResolvedValue({ status: "nao_verificado", mensagem: "Projeto registrado FLASH-OK" });

    const app = montarApp(DEV_USER);
    const agent = request.agent(app);

    const post = await agent.post("/trilha/1/fases/7/projeto").type("form")
      .send({ repoUrl: "https://github.com/dev/projeto" });
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe("/trilha/1");
    expect(post.text).not.toMatch(/FLASH-OK/);

    const get1 = await agent.get("/trilha/1");
    expect(get1.status).toBe(200);
    expect(get1.text).toMatch(/FLASH-OK/);

    const get2 = await agent.get("/trilha/1"); // "F5"
    expect(get2.text).not.toMatch(/FLASH-OK/);
    expect(fecharProjetoSemVerificar).toHaveBeenCalledTimes(1);
  });
});

describe("GET /trilha/:id — formulário do projeto com etapas pendentes", () => {
  test("troca o formulário pelo aviso e diz quantas etapas faltam", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[{ id: 1, usuario_id: 1, tipo_objetivo: "area", area: "front-end", horas_semana: 10 }]];
      if (s.includes("from roadmap_fases where roadmap_id")) {
        return [[{ id: 7, roadmap_id: 1, ordem: 1, nome: "Fase 1", objetivo: "x", projeto_enunciado: "y", projeto_status: "pendente", projeto_repo_url: null }]];
      }
      if (s.includes("from roadmap_etapas re")) {
        const base = { fase_id: 7, titulo: "t", descricao: "d", habilidade: "JS", horas_estimadas: 2, recurso_id: null };
        return [[
          { ...base, id: 1, ordem: 1, status: "concluida" },
          { ...base, id: 2, ordem: 2, status: "pendente" },
          { ...base, id: 3, ordem: 3, status: "em_andamento" },
        ]];
      }
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const res = await request(montarApp(DEV_USER)).get("/trilha/1");

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Conclua todas as etapas da fase antes de enviar o projeto/);
    expect(res.text).toMatch(/Faltam 2 etapas/);
    // aviso visível; o formulário existe no HTML mas escondido (o roadmap.js o mostra quando as etapas acabam)
    expect(res.text).toMatch(/<p class="rm-alert rm-alert--aviso" role="status" data-rm-projeto-aviso>/);
    expect(res.text).toMatch(/<form [^>]*data-rm-projeto-form hidden>/);
  });

  test("com todas as etapas concluídas: formulário visível e aviso escondido", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[{ id: 1, usuario_id: 1, tipo_objetivo: "area", area: "front-end", horas_semana: 10 }]];
      if (s.includes("from roadmap_fases where roadmap_id")) {
        return [[{ id: 7, roadmap_id: 1, ordem: 1, nome: "Fase 1", objetivo: "x", projeto_enunciado: "y", projeto_status: "pendente", projeto_repo_url: null }]];
      }
      if (s.includes("from roadmap_etapas re")) {
        return [[{ id: 1, fase_id: 7, ordem: 1, titulo: "t", descricao: "d", habilidade: "JS", horas_estimadas: 2, recurso_id: null, status: "concluida" }]];
      }
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const res = await request(montarApp(DEV_USER)).get("/trilha/1");

    expect(res.text).toMatch(/data-rm-projeto-aviso hidden>/);
    expect(res.text).toMatch(/<form [^>]*data-rm-projeto-form>/);
  });

  test("roadmap.js alterna aviso e formulário e atualiza o número de etapas que faltam", () => {
    const js = require("fs").readFileSync(path.join(__dirname, "..", "public", "js", "roadmap.js"), "utf8");
    expect(js).toContain("[data-rm-projeto-aviso]");
    expect(js).toContain("[data-rm-projeto-form]");
    expect(js).toContain("atualizarEnvioDoProjeto(fase, etapasFase.length - concluidasFase)");
    expect(js).toContain("Falta 1 etapa.");
    // o display do formulário venceria o atributo hidden: precisa da regra explícita
    const css = require("fs").readFileSync(path.join(__dirname, "..", "public", "css", "trilha.css"), "utf8");
    expect(css).toContain(".rm-projeto-form[hidden]");
  });
});

describe("POST /trilha/:id/fases/:faseId/projeto — fase já verificada", () => {
  const { verificarProjeto, fecharProjetoSemVerificar, validarEnvioDaFase } = require("../services/roadmapService");

  test.each([["Free"], ["PRO"]])("%s — não reavalia nem rebaixa: nem regras de envio, nem verificação, nem fechamento", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[{ id: 1, usuario_id: 1 }]];
      if (s.includes("from roadmap_fases where id")) return [[{ id: 7, projeto_status: "verificado" }]];
      if (s.includes("from user_subscriptions")) return [[]];
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const res = await request(montarApp(DEV_USER))
      .post("/trilha/1/fases/7/projeto").type("form")
      .send({ repoUrl: "https://github.com/dev/projeto" });

    expect(res.status).toBe(302);
    expect(validarEnvioDaFase).not.toHaveBeenCalled();
    expect(verificarProjeto).not.toHaveBeenCalled();
    expect(fecharProjetoSemVerificar).not.toHaveBeenCalled();
  });
});

describe("views/roadmap/detalhe.ejs — lista do que falta (pendencias)", () => {
  const ejs = require("ejs");
  const fase = {
    id: 7, nome: "Fase 1", objetivo: "x", projeto_enunciado: "y", projeto_status: "em_revisao",
    projeto_repo_url: null, etapas: [], pct: 100,
  };
  const render = (resultadoProjeto) => ejs.renderFile(path.join(__dirname, "..", "views", "roadmap", "detalhe.ejs"), {
    currentPage: "trilha", roadmap: { id: 1, status: "ativo", horas_semana: 10 }, job: null, label: "Front-end",
    fases: [fase], pctTotal: 100, semanasRestantes: 0, resultadoProjeto, user: { id: 1, type: "dev" },
  });

  test("mostra cada pendência (habilidade com motivo e commits) numa lista", async () => {
    const html = await render({
      faseId: 7, status: "faltando", mensagem: "Quase lá!",
      faltando: ["React"],
      pendencias: ["React — só aparece no README; falta uso no código/dependências", "Faça pelo menos 3 commits com o seu trabalho no repositório"],
    });
    expect(html).toMatch(/O que ainda falta:/);
    expect(html).toMatch(/<li>\s*React — só aparece no README; falta uso no código\/dependências\s*<\/li>/);
    expect(html).toMatch(/Faça pelo menos 3 commits/);
  });

  test("sem pendencias, mantém a lista antiga de habilidades", async () => {
    const html = await render({ faseId: 7, status: "faltando", mensagem: "x", faltando: ["React"] });
    expect(html).toMatch(/Ainda não encontramos no repositório: React\./);
  });
});
