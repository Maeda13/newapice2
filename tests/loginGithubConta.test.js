// tests/loginGithubConta.test.js
// Login com GitHub: qual conta é a da pessoa.
//
// Antes, a conta era procurada só pelo e-mail público do GitHub. Com o e-mail
// privado (o padrão de muita gente) ou trocado, o login criava outra conta,
// vazia, e o que a pessoa tinha salvo "sumia"; a conta que já tinha o GitHub
// podia até perder o vínculo. No primeiro login com GitHub de quem se
// cadastrou por e-mail, os dados ficavam na chave antiga (o id da conta). E o
// endereço "noreply" montado com o login do GitHub (que muda de dono) levava
// a conta de outra pessoa.
//
// GitHub (axios) e banco são simulados; o banco falso entende o
// ON DUPLICATE KEY UPDATE e as transações (com rollback).
process.env.APP_URL = "http://localhost:3000";

jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock("../services/githubAnalyzer", () => ({ matchSkillsFromGitHub: jest.fn(() => Promise.resolve([])) }));

const axios = require("axios");
const db = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");
const authController = require("../controllers/authController");

// ── banco falso ───────────────────────────────────────────
const UNICAS = { user_skills: ["github_id", "skill_id"], job_applications: ["job_id", "dev_github_id"] };
let banco;
let mockFalharAoMover = null;

function novoBanco({ users = [], perfis = [], linhas = {} } = {}) {
  return {
    users: users.map(u => ({ type: "dev", active: 1, ...u })),
    perfis: perfis.map(p => ({ nome: null, sobrenome: null, github_login: null, github_id: null, nivel: "iniciante", avatar_url: null, ...p })),
    linhas,
    proximoId: 100,
  };
}
const norm = sql => sql.replace(/\s+/g, " ").trim();
const mesmoEmail = (a, b) => String(a).toLowerCase() === String(b).toLowerCase(); // collation do MySQL
const perfilDe = id => banco.perfis.find(p => p.user_id === id);

async function consultar(sql, params = []) {
  const q = norm(sql);
  if (/^SELECT .* FROM user_dev_profiles p JOIN users u ON u\.id = p\.user_id WHERE p\.github_id = \?/.test(q)) {
    const p = banco.perfis.find(x => x.github_id === params[0]);
    const u = p && banco.users.find(x => x.id === p.user_id);
    return [u ? [{ id: u.id, type: u.type, active: u.active, email: u.email, github_id: p.github_id }] : []];
  }
  if (/^SELECT .* FROM users u LEFT JOIN user_dev_profiles p ON p\.user_id = u\.id WHERE u\.email IN \(\?\)/.test(q)) {
    return [banco.users.filter(u => params[0].some(e => mesmoEmail(e, u.email)))
      .map(u => ({ id: u.id, type: u.type, active: u.active, email: u.email, github_id: perfilDe(u.id)?.github_id ?? null }))];
  }
  if (/^SELECT id, type, active FROM users WHERE email = \?/.test(q)) {
    return [banco.users.filter(u => mesmoEmail(u.email, params[0])).map(({ id, type, active }) => ({ id, type, active }))];
  }
  if (/^INSERT INTO users \(email, type\)/.test(q)) {
    if (banco.users.some(u => mesmoEmail(u.email, params[0]))) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    const id = banco.proximoId++;
    banco.users.push({ id, email: params[0], type: "dev", active: 1 });
    return [{ insertId: id, affectedRows: 1 }];
  }
  if (/^INSERT INTO user_dev_profiles \(user_id, nome, github_login, github_id, nivel\)/.test(q)) {
    const [user_id, nome, login, gid] = params;
    const existente = perfilDe(user_id) ?? banco.perfis.find(p => p.github_id === gid); // chaves únicas: user_id e github_id
    if (!existente) {
      banco.perfis.push({ user_id, nome, sobrenome: null, github_login: login, github_id: gid, nivel: "iniciante", avatar_url: null });
      return [{ affectedRows: 1 }];
    }
    const update = q.slice(q.indexOf("ON DUPLICATE KEY UPDATE"));
    if (/github_login = IF\(github_id = VALUES\(github_id\)/.test(update)) {
      if (existente.github_id === gid) existente.github_login = login;
    } else if (/github_login = VALUES\(github_login\)/.test(update)) {
      existente.github_login = login;
    }
    if (/github_id = VALUES\(github_id\)/.test(update.replace("IF(github_id = VALUES(github_id)", ""))) existente.github_id = gid;
    return [{ affectedRows: 2 }];
  }
  if (/^SELECT .* FROM user_dev_profiles WHERE user_id = \?/.test(q)) {
    const p = perfilDe(params[0]);
    return [p ? [{ ...p }] : []];
  }
  if (/^UPDATE user_dev_profiles SET avatar_url = \? WHERE user_id = \?/.test(q)) {
    const p = perfilDe(params[1]);
    if (p) p.avatar_url = params[0];
    return [{ affectedRows: p ? 1 : 0 }];
  }
  throw new Error(`SQL inesperado no teste: ${q}`);
}

function conexao() {
  let copia = null;
  return {
    beginTransaction: async () => { copia = structuredClone(banco); },
    commit: async () => { copia = null; },
    rollback: async () => { if (copia) { banco = copia; copia = null; } },
    release: () => {},
    query: async (sql, params) => {
      const q = norm(sql);
      let m;
      if (/^UPDATE user_dev_profiles SET github_id = \?, github_login = \? WHERE user_id = \? AND github_id IS NULL$/.test(q)) {
        const p = perfilDe(params[2]);
        if (!p || p.github_id != null) return [{ affectedRows: 0 }];
        p.github_id = params[0];
        p.github_login = params[1];
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT user_id FROM user_dev_profiles WHERE github_id = \? AND user_id <> \? LIMIT 1$/.test(q)) {
        return [banco.perfis.filter(p => p.github_id === params[0] && p.user_id !== params[1]).map(p => ({ user_id: p.user_id }))];
      }
      if ((m = q.match(/^UPDATE IGNORE `(\w+)` SET `(\w+)` = \? WHERE `\2` = \?$/))) {
        const [, tabela, coluna] = m;
        if (tabela === mockFalharAoMover) throw Object.assign(new Error("falha simulada"), { code: "ER_LOCK_WAIT_TIMEOUT" });
        const linhas = banco.linhas[tabela] ?? [];
        let n = 0;
        for (const l of linhas) {
          if (l[coluna] !== params[1]) continue;
          const nova = { ...l, [coluna]: params[0] };
          if (UNICAS[tabela] && linhas.some(o => o !== l && UNICAS[tabela].every(c => o[c] === nova[c]))) continue; // IGNORE
          l[coluna] = params[0];
          n++;
        }
        return [{ affectedRows: n }];
      }
      throw new Error(`SQL inesperado na transação: ${q}`);
    },
  };
}

// ── GitHub falso ──────────────────────────────────────────
async function entrarComGithub(githubUser, emails = []) {
  axios.post.mockResolvedValue({ data: { access_token: "token-de-teste" } });
  axios.get.mockImplementation(async (url) => {
    if (url === "https://api.github.com/user") return { data: githubUser };
    if (url.startsWith("https://api.github.com/user/repos")) return { data: [] };
    if (url === "https://api.github.com/user/emails") {
      if (emails instanceof Error) throw emails;
      return { data: emails };
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  });
  const req = { query: { code: "codigo", state: "s1" }, session: { oauthStates: [{ state: "s1", next: null, exp: Date.now() + 60000 }] } };
  let destino = null;
  await authController.githubCallback(req, { redirect: (u) => { destino = u; } });
  return { destino, user: req.session.user };
}

const ANA = { id: 7, email: "ana@exemplo.com" };
const PERFIL_ANA = { user_id: 7, nome: "Ana", sobrenome: "Lima", nivel: "junior" };
const GITHUB_ANA = { id: 9001, login: "ana-gh", name: "Ana no GitHub", email: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockFalharAoMover = null;
  db.query.mockImplementation(consultar);
  db.getConnection.mockImplementation(async () => conexao());
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("cadastrou por e-mail e depois entrou com GitHub", () => {
  beforeEach(() => {
    banco = novoBanco({
      users: [ANA],
      perfis: [PERFIL_ANA],
      linhas: {
        user_skills: [{ github_id: 7, skill_id: 1 }, { github_id: 7, skill_id: 2 }],
        job_applications: [{ dev_github_id: 7, job_id: 3 }],
        user_roadmap_progress: [{ github_id: 7, job_id: 3, skill_id: 1 }],
        conversations: [{ dev_github_id: 7, company_id: 8 }],
      },
    });
  });

  test("mesma conta, e o que estava salvo continua aparecendo (passa para a chave do GitHub)", async () => {
    const { destino, user } = await entrarComGithub({ ...GITHUB_ANA, email: "Ana@Exemplo.com" });
    expect(destino).toBe("/dashboard");
    expect(user).toMatchObject({ id: 7, github_id: 9001 });
    expect(banco.users).toHaveLength(1); // nenhuma conta nova
    expect(perfilDe(7)).toMatchObject({ github_id: 9001, github_login: "ana-gh" });
    const chave = user.github_id ?? user.id; // getUserId
    expect(banco.linhas.user_skills.map(l => l.github_id)).toEqual([chave, chave]);
    expect(banco.linhas.job_applications[0].dev_github_id).toBe(chave);
    expect(banco.linhas.user_roadmap_progress[0].github_id).toBe(chave);
    expect(banco.linhas.conversations[0].dev_github_id).toBe(chave);
    expect(matchSkillsFromGitHub).toHaveBeenCalledWith("token-de-teste", 9001, [], { userId: 7 });
  });

  test("com o e-mail privado no GitHub, acha a conta pelo e-mail verificado", async () => {
    const { user } = await entrarComGithub(GITHUB_ANA, [
      { email: "ana.trabalho@exemplo.com", verified: true, primary: false },
      { email: "ana@exemplo.com", verified: true, primary: true },
    ]);
    expect(user).toMatchObject({ id: 7, github_id: 9001 });
    expect(banco.users).toHaveLength(1);
  });

  test("e-mail não verificado no GitHub não dá acesso à conta", async () => {
    const { user } = await entrarComGithub(GITHUB_ANA, [{ email: "ana@exemplo.com", verified: false, primary: true }]);
    expect(user.id).not.toBe(7);
    expect(perfilDe(7).github_id).toBeNull();
  });

  test("o nome do cabeçalho é o salvo no perfil, não o do GitHub", async () => {
    const { user } = await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
    expect(user.name).toBe("Ana Lima");
  });

  test("linha que colidiria na chave nova fica na antiga: nada é apagado", async () => {
    banco.linhas.user_skills.push({ github_id: 9001, skill_id: 1 });
    await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
    expect(banco.linhas.user_skills).toHaveLength(3);
    expect(banco.linhas.user_skills.filter(l => l.github_id === 9001).map(l => l.skill_id).sort()).toEqual([1, 2]);
  });

  test("se mover os dados falhar, a conta fica como estava (sem GitHub, dados à vista) e o login segue", async () => {
    mockFalharAoMover = "job_applications";
    const { destino, user } = await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
    expect(destino).toBe("/dashboard");
    expect(perfilDe(7).github_id).toBeNull();                       // vínculo desfeito junto
    expect(banco.linhas.user_skills.map(l => l.github_id)).toEqual([7, 7]);
    expect(user.github_id ?? user.id).toBe(7);                      // a sessão lê onde os dados estão
    expect(matchSkillsFromGitHub).toHaveBeenCalledWith("token-de-teste", 7, [], { userId: 7 });
    mockFalharAoMover = null;                                       // e o próximo login tenta de novo
    expect((await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" })).user.github_id).toBe(9001);
    expect(banco.linhas.job_applications[0].dev_github_id).toBe(9001);
  });

  test("se o id da conta for o github_id de outro dev, as linhas dessa chave não são movidas", async () => {
    banco.users.push({ id: 50, email: "outro@exemplo.com", type: "dev", active: 1 });
    banco.perfis.push({ user_id: 50, nome: "Outro", sobrenome: null, github_login: "outro", github_id: 7, nivel: "iniciante", avatar_url: null });
    const { user } = await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
    expect(user).toMatchObject({ id: 7, github_id: 9001 });
    expect(banco.linhas.user_skills.map(l => l.github_id)).toEqual([7, 7]);
  });
});

describe("conta que já tem o GitHub", () => {
  beforeEach(() => {
    banco = novoBanco({
      users: [{ id: 10, email: "ana-gh@users.noreply.github.com" }],
      perfis: [{ user_id: 10, nome: "Ana", github_login: "ana-gh", github_id: 9001 }],
    });
  });

  test("continua a mesma quando o e-mail do GitHub fica público ou muda (achada pelo github_id)", async () => {
    const { user } = await entrarComGithub({ ...GITHUB_ANA, email: "ana.nova@exemplo.com" });
    expect(user).toMatchObject({ id: 10, github_id: 9001 });
    expect(banco.users).toHaveLength(1);
  });

  test("o login do GitHub que mudou de dono não entra na conta de outra pessoa", async () => {
    const { user } = await entrarComGithub({ id: 7777, login: "ana-gh", name: "Outra pessoa", email: null });
    expect(user.id).not.toBe(10);
    expect(user.github_id).toBe(7777);
    expect(perfilDe(10)).toMatchObject({ github_id: 9001, github_login: "ana-gh" });
    expect(banco.users.find(u => u.id === user.id).email).toBe("7777+ana-gh@users.noreply.github.com");
  });
});

test("conta de e-mail com OUTRO GitHub já vinculado: a chave dos dados não é trocada", async () => {
  banco = novoBanco({ users: [ANA], perfis: [{ ...PERFIL_ANA, github_login: "ana-antiga", github_id: 5000 }] });
  const { user } = await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
  expect(user).toMatchObject({ id: 7, github_id: 5000 });
  expect(perfilDe(7)).toMatchObject({ github_id: 5000, github_login: "ana-antiga" });
});

test("e-mail público de uma conta empresa: recusado, como antes", async () => {
  banco = novoBanco({ users: [{ id: 8, email: "rh@empresa.com", type: "empresa" }] });
  const { destino, user } = await entrarComGithub({ ...GITHUB_ANA, email: "rh@empresa.com" });
  expect(destino).toBe("/login?error=email_in_use_company");
  expect(user).toBeUndefined();
});

test.each([
  ["achada pelo github_id", { users: [{ id: 10, email: "x@users.noreply.github.com", active: 0 }], perfis: [{ user_id: 10, github_id: 9001 }] }],
  ["achada pelo e-mail", { users: [{ ...ANA, active: 0 }], perfis: [PERFIL_ANA] }],
])("conta suspensa (%s): recusada", async (_caso, dados) => {
  banco = novoBanco(dados);
  const { destino } = await entrarComGithub({ ...GITHUB_ANA, email: "ana@exemplo.com" });
  expect(destino).toBe("/login?error=account_suspended");
});

test("conta nova: usa o e-mail público, ou um endereço noreply único (id+login)", async () => {
  banco = novoBanco();
  const comEmail = await entrarComGithub({ id: 1, login: "um", name: "Um", email: "um@exemplo.com" });
  expect(banco.users.find(u => u.id === comEmail.user.id).email).toBe("um@exemplo.com");
  expect(perfilDe(comEmail.user.id)).toMatchObject({ github_id: 1, github_login: "um", nome: "Um" });
  const semEmail = await entrarComGithub({ id: 2, login: "dois", name: null, email: null }, new Error("sem permissão"));
  expect(banco.users.find(u => u.id === semEmail.user.id).email).toBe("2+dois@users.noreply.github.com");
  expect(semEmail.user).toMatchObject({ github_id: 2, name: "dois" });
});
