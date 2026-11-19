// tests/cadastroConta.test.js
// Cadastro: a conta e o perfil são gravados juntos, ou nenhum dos dois.
//
// Antes, a conta (users) era criada antes de conferir o CNPJ e fora de
// transação. Com o CNPJ já cadastrado, ou se a gravação do perfil falhasse,
// a conta ficava sem perfil: o e-mail passava a "já cadastrado", o login
// entrava numa conta vazia e nada do que a pessoa salvava pegava (as
// gravações no perfil não acham a linha). O banco é simulado.
jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
jest.mock("../models/User", () => ({
  findByEmail: jest.fn(), cnpjExists: jest.fn(), create: jest.fn(), createDevProfile: jest.fn(),
  createCompanyProfile: jest.fn(), criarContaComPerfil: jest.fn(),
}));
jest.mock("bcrypt", () => ({ hash: jest.fn().mockResolvedValue("hash-de-teste"), compare: jest.fn() }));

const db = require("../database/db");
const User = require("../models/User");
const UserReal = jest.requireActual("../models/User");
const usersController = require("../controllers/usersController");

const EMPRESA = { type: "empresa", email: "rh@azul.com", password: "senha-de-teste-1", razao_social: "Azul Tecnologia Ltda", nome_fantasia: "Azul Tech", cnpj: "12.345.678/0001-90" };
const DEV = { type: "dev", email: "ana@exemplo.com", password: "senha-de-teste-1", nome: "Ana", sobrenome: "Lima", nivel: "junior" };

async function cadastrar(body) {
  const req = { body, session: {} };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await usersController.register(req, res);
  return { res, req };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findByEmail.mockResolvedValue(null);
  User.cnpjExists.mockResolvedValue(false);
  User.create.mockResolvedValue(41);
  User.criarContaComPerfil.mockResolvedValue(41);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("cadastro (controller)", () => {
  test("empresa com CNPJ já cadastrado: 409 e nenhuma conta é criada", async () => {
    User.cnpjExists.mockResolvedValue(true);
    const { res, req } = await cadastrar(EMPRESA);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("Este CNPJ já está cadastrado.");
    expect(User.create).not.toHaveBeenCalled();
    expect(User.criarContaComPerfil).not.toHaveBeenCalled();
    expect(req.session.user).toBeUndefined();
  });

  test("empresa: conta e perfil numa gravação só, com o CNPJ só com dígitos", async () => {
    const { res, req } = await cadastrar(EMPRESA);
    expect(res.statusCode).toBe(201);
    expect(User.criarContaComPerfil).toHaveBeenCalledWith({
      email: "rh@azul.com", passwordHash: "hash-de-teste", type: "empresa",
      perfil: { razaoSocial: "Azul Tecnologia Ltda", nomeFantasia: "Azul Tech", cnpj: "12345678000190", setor: null, tamanho: null, site: null },
    });
    expect(req.session.user).toMatchObject({ id: 41, type: "empresa", name: "Azul Tech" });
  });

  test("dev: conta e perfil numa gravação só", async () => {
    const { res, req } = await cadastrar(DEV);
    expect(res.statusCode).toBe(201);
    expect(User.criarContaComPerfil).toHaveBeenCalledWith({
      email: "ana@exemplo.com", passwordHash: "hash-de-teste", type: "dev",
      perfil: { nome: "Ana", sobrenome: "Lima", githubLogin: null, nivel: "junior" },
    });
    expect(req.session.user).toMatchObject({ id: 41, type: "dev", name: "Ana Lima", nivel: "junior" });
  });

  test.each([
    ["e-mail", "Duplicate entry 'rh@azul.com' for key 'users.uq_users_email'", "Este e-mail já está cadastrado."],
    ["CNPJ", "Duplicate entry '12345678000190' for key 'user_company_profiles.uq_company_cnpj'", "Este CNPJ já está cadastrado."],
  ])("o mesmo %s cadastrado ao mesmo tempo noutra aba: 409 (não 500) e sem sessão", async (_c, mensagem, erro) => {
    User.criarContaComPerfil.mockRejectedValue(Object.assign(new Error(mensagem), { code: "ER_DUP_ENTRY" }));
    const { res, req } = await cadastrar(EMPRESA);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe(erro);
    expect(req.session.user).toBeUndefined();
  });
});

describe("User.criarContaComPerfil (transação)", () => {
  let conn, gravacoes;
  beforeEach(() => {
    gravacoes = [];
    conn = {
      beginTransaction: jest.fn(async () => {}), commit: jest.fn(async () => {}),
      rollback: jest.fn(async () => {}), release: jest.fn(),
      query: jest.fn(async (sql) => {
        const q = sql.replace(/\s+/g, " ").trim();
        gravacoes.push(q.slice(0, 40));
        if (q.startsWith("INSERT INTO users")) return [{ insertId: 41 }];
        if (q.startsWith("INSERT INTO user_company_profiles") && conn.falharPerfil) throw Object.assign(new Error("Data too long for column 'site'"), { code: "ER_DATA_TOO_LONG" });
        return [{ affectedRows: 1 }];
      }),
    };
    db.getConnection.mockResolvedValue(conn);
  });

  const perfilEmpresa = { razaoSocial: "Azul", nomeFantasia: null, cnpj: "12345678000190", setor: null, tamanho: null, site: "x" };

  test("conta e perfil na mesma conexão, confirmados juntos", async () => {
    const id = await UserReal.criarContaComPerfil({ email: " RH@Azul.com ", passwordHash: "h", type: "empresa", perfil: perfilEmpresa });
    expect(id).toBe(41);
    expect(gravacoes).toEqual([expect.stringMatching(/^INSERT INTO users/), expect.stringMatching(/^INSERT INTO user_company_profiles/)]);
    expect(conn.query.mock.calls[0][1]).toEqual(["rh@azul.com", "h", "empresa"]);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled(); // nada fora da transação
  });

  test("se o perfil falhar, a conta também é desfeita (nada fica pela metade)", async () => {
    conn.falharPerfil = true;
    await expect(UserReal.criarContaComPerfil({ email: "rh@azul.com", passwordHash: "h", type: "empresa", perfil: perfilEmpresa }))
      .rejects.toMatchObject({ code: "ER_DATA_TOO_LONG" });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  test("dev: grava o perfil de dev", async () => {
    await UserReal.criarContaComPerfil({ email: "ana@exemplo.com", passwordHash: "h", type: "dev", perfil: { nome: "Ana", sobrenome: null, githubLogin: null, nivel: "iniciante" } });
    expect(gravacoes[1]).toMatch(/^INSERT INTO user_dev_profiles/);
    expect(conn.query.mock.calls[1][1]).toEqual([41, "Ana", null, null, "iniciante"]);
  });
});
