// tests/troca-plano-so-admin.test.js
// Trocar de plano sem pagamento é privilégio do admin
// (PATCH /api/admin/users/:id/plan). A demonstração antiga, em que o
// próprio dev trocava Gratuito ⇄ PRO pelo perfil (POST /api/user/plano,
// liberada por ALLOW_SELF_PLAN_SWITCH), foi removida: com a cobrança
// real pelo Mercado Pago, ela deixaria qualquer um virar PRO de graça.
//
// Mesmo padrão de tests/trilha.test.js: app Express mínimo com sessão
// fake + os routers sob teste, sem importar server.js.
const request = require("supertest");
const express = require("express");
const fs      = require("fs");
const path    = require("path");

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

jest.mock("../services/subscriptionService", () => ({
  getUserPlan: jest.fn(),
  setUserPlan: jest.fn(),
  getPlanCodesBulk: jest.fn(),
}));

// Dependências dos controllers que não são o foco aqui.
jest.mock("../services/githubAnalyzer", () => ({ matchSkillsFromGitHub: jest.fn() }));
jest.mock("../services/matchCalculator", () => ({ computeMatch: jest.fn() }));

const db = require("../database/db");
const { setUserPlan } = require("../services/subscriptionService");
const profileRoutes = require("../routes/profile");
const adminRoutes   = require("../routes/admin");

function montarApp(sessionUser) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessionUser ? { user: sessionUser } : {};
    next();
  });
  // mesmos prefixos do server.js
  app.use("/api/user",  profileRoutes);
  app.use("/api/admin", adminRoutes);
  return app;
}

const DEV_USER   = { id: 7, type: "dev" };
const ADMIN_USER = { id: 1, type: "admin" };

const envOriginal = process.env.ALLOW_SELF_PLAN_SWITCH;

beforeEach(() => {
  jest.clearAllMocks();
  // Nem com a variável antiga ligada o dev pode trocar o próprio plano.
  process.env.ALLOW_SELF_PLAN_SWITCH = "true";
});

afterAll(() => {
  if (envOriginal === undefined) delete process.env.ALLOW_SELF_PLAN_SWITCH;
  else process.env.ALLOW_SELF_PLAN_SWITCH = envOriginal;
});

describe("dev não troca o próprio plano sem pagamento", () => {
  test("POST /api/user/plano não existe, mesmo com ALLOW_SELF_PLAN_SWITCH=true", async () => {
    const res = await request(montarApp(DEV_USER))
      .post("/api/user/plano")
      .send({ plan_code: "dev_pro" });

    expect(res.status).toBe(404);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  test("o perfil do dev não mostra mais os botões de troca", () => {
    const view = fs.readFileSync(path.join(__dirname, "..", "views", "perfil-dev.ejs"), "utf8");
    expect(view).not.toMatch(/\/api\/user\/plano/);
    expect(view).not.toMatch(/plan-switch|btn-plan-(free|pro)/);
  });
});

describe("admin continua trocando o plano de um dev", () => {
  test("PATCH /api/admin/users/:id/plan aplica o plano", async () => {
    db.query.mockResolvedValueOnce([[{ id: 7 }]]);
    setUserPlan.mockResolvedValueOnce();

    const res = await request(montarApp(ADMIN_USER))
      .patch("/api/admin/users/7/plan")
      .send({ plan_code: "dev_pro" });

    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledWith(7, "dev_pro");
  });

  test("um dev não acessa a rota do admin", async () => {
    const res = await request(montarApp(DEV_USER))
      .patch("/api/admin/users/7/plan")
      .send({ plan_code: "dev_pro" });

    expect(res.status).toBe(403);
    expect(setUserPlan).not.toHaveBeenCalled();
  });
});
