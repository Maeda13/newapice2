// tests/seedVagas.test.js
// scripts/seedVagas.js — contas das empresas Azyra e Fuse e as vagas delas.
// Roda contra um MySQL falso em memória (com as UNIQUE de users.email e
// user_company_profiles.cnpj/user_id e transações com rollback), nunca no banco
// de verdade. As senhas aqui são de teste; as reais só existem no .env.
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));

const fs     = require("fs");
const path   = require("path");
const bcrypt = require("bcrypt");
const { semear, cnpjDeTeste, EMPRESAS } = require("../scripts/seedVagas");
const { isValidCNPJ } = require("../validators/auth.validator");

const SENHAS = { SEED_AZYRA_PASSWORD: "senha-de-teste-azyra", SEED_FUSE_PASSWORD: "senha-de-teste-fuse" };
const EMAIL_AZYRA = "contatorazyra@gmail.com";
const EMAIL_FUSE  = "recrutamentofuse.io@gmail.com";

// Catálogo como o de database/seed-skills.js: "REST API" (não "APIs REST") e sem UiPath.
const CATALOGO = ["React", "TypeScript", "Node.js", "JavaScript", "REST API", "Python", "Git"]
  .map((name, i) => ({ id: i + 1, name, type: "hard", category: null, github_signals: null }));

function bancoFalso(inicial = {}, { falharEm = null } = {}) {
  let t = {
    users: [], user_company_profiles: [], skills: structuredClone(CATALOGO), jobs: [], job_skills: [],
    ...structuredClone(inicial),
  };
  const consultas = [];
  const proximoId = (tabela) => Math.max(0, ...t[tabela].map(r => r.id)) + 1;
  const unico = (tabela, coluna, valor) => {
    if (t[tabela].some(r => r[coluna] === valor)) {
      throw Object.assign(new Error(`Duplicate entry '${valor}' for key '${tabela}.${coluna}'`), { code: "ER_DUP_ENTRY" });
    }
  };

  function inserir(q, params) {
    const [, tabela, cols, vals] = q.match(/^INSERT INTO (\w+) ?\(([^)]*)\) VALUES ?\((.*)\)$/i);
    let p = 0;
    const valores = vals.split(",").map(s => s.trim()).map(tok => (tok === "?" ? params[p++] : /^'.*'$/.test(tok) ? tok.slice(1, -1) : Number(tok)));
    const linha = { id: proximoId(tabela) };
    cols.split(",").map(s => s.trim()).forEach((c, i) => { linha[c] = valores[i]; });
    if (tabela === "users") unico("users", "email", linha.email);
    if (tabela === "user_company_profiles") { unico(tabela, "cnpj", linha.cnpj); unico(tabela, "user_id", linha.user_id); }
    t[tabela].push(linha);
    return [{ insertId: linha.id, affectedRows: 1 }];
  }

  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    consultas.push({ sql: q, params });
    if (falharEm && falharEm.test(q)) throw new Error("falha simulada");
    if (/^INSERT INTO/i.test(q)) return inserir(q, params);
    switch (q) {
      case "SELECT id, type FROM users WHERE email = ? LIMIT 1":
        return [t.users.filter(u => u.email === params[0]).slice(0, 1).map(({ id, type }) => ({ id, type }))];
      case "SELECT id, logo_url FROM user_company_profiles WHERE user_id = ? LIMIT 1":
        return [t.user_company_profiles.filter(p => p.user_id === params[0]).slice(0, 1).map(({ id, logo_url }) => ({ id, logo_url }))];
      case "UPDATE user_company_profiles SET logo_url = ? WHERE user_id = ?":
        t.user_company_profiles.filter(p => p.user_id === params[1]).forEach(p => { p.logo_url = params[0]; });
        return [{ affectedRows: 1 }];
      case "SELECT COUNT(*) AS total FROM user_company_profiles WHERE cnpj = ?":
        return [[{ total: t.user_company_profiles.filter(p => p.cnpj === params[0]).length }]];
      case "SELECT id FROM jobs WHERE company_id = ? AND title = ? LIMIT 1":
        return [t.jobs.filter(j => j.company_id === params[0] && j.title === params[1]).slice(0, 1).map(j => ({ id: j.id }))];
      case "SELECT id, name FROM skills":
        return [t.skills.map(({ id, name }) => ({ id, name }))];
      default:
        throw new Error(`SQL inesperado no teste: ${q}`);
    }
  }

  return {
    query,
    getConnection: async () => {
      let foto = null;
      return {
        query,
        beginTransaction: async () => { foto = structuredClone(t); },
        commit: async () => { foto = null; },
        rollback: async () => { if (foto) t = foto; foto = null; },
        release: () => {},
      };
    },
    get tabelas() { return t; },
    consultas,
  };
}

const rodar = (banco, env = SENHAS) => {
  const log = [];
  return semear(banco, { env, log: (m) => log.push(m) }).then(r => ({ r, log }));
};
const usuario = (banco, email) => banco.tabelas.users.find(u => u.email === email);
const vagaDe  = (banco, email) => banco.tabelas.jobs.find(j => j.company_id === usuario(banco, email).id);
const skillsDaVaga = (banco, job) => banco.tabelas.job_skills
  .filter(js => js.job_id === job.id).sort((a, b) => a.learn_order - b.learn_order)
  .map(js => banco.tabelas.skills.find(s => s.id === js.skill_id).name);

describe("seed das vagas — primeira execução", () => {
  test("cria as duas contas de empresa, com a senha em hash bcrypt (nunca em texto puro)", async () => {
    const banco = bancoFalso();
    await rodar(banco);
    const azyra = usuario(banco, EMAIL_AZYRA);
    const fuse  = usuario(banco, EMAIL_FUSE);
    expect(azyra.type).toBe("empresa");
    expect(fuse.type).toBe("empresa");
    expect(azyra.password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare(SENHAS.SEED_AZYRA_PASSWORD, azyra.password_hash)).toBe(true);
    expect(await bcrypt.compare(SENHAS.SEED_FUSE_PASSWORD, fuse.password_hash)).toBe(true);
    // a senha pura não vai para o banco em consulta nenhuma
    const valores = banco.consultas.flatMap(c => c.params);
    expect(valores).not.toContain(SENHAS.SEED_AZYRA_PASSWORD);
    expect(valores).not.toContain(SENHAS.SEED_FUSE_PASSWORD);
  });

  test("perfil da empresa com nome, logo provisório e CNPJ de teste válido", async () => {
    const banco = bancoFalso();
    await rodar(banco);
    const perfis = banco.tabelas.user_company_profiles;
    expect(perfis).toHaveLength(2);
    expect(perfis.find(p => p.user_id === usuario(banco, EMAIL_AZYRA).id))
      .toMatchObject({ razao_social: "Azyra", nome_fantasia: "Azyra", logo_url: "/images/empresas/azyra.svg" });
    expect(perfis.find(p => p.user_id === usuario(banco, EMAIL_FUSE).id))
      .toMatchObject({ nome_fantasia: "Fuse", logo_url: "/images/empresas/fuse.svg" });
    for (const p of perfis) expect(isValidCNPJ(p.cnpj)).toBe(true);
    for (const logo of ["azyra.svg", "fuse.svg"]) {
      expect(fs.existsSync(path.join(__dirname, "..", "public", "images", "empresas", logo))).toBe(true);
    }
  });

  test("a vaga de cada empresa fica vinculada à conta dela, com os dados do anúncio", async () => {
    const banco = bancoFalso();
    await rodar(banco);
    expect(banco.tabelas.jobs).toHaveLength(2);
    expect(vagaDe(banco, EMAIL_AZYRA)).toMatchObject({
      title: "Estágio em Desenvolvimento de Software", short_title: "Estágio Dev Software", company: "Azyra",
      level: "estagio", modality: "hibrido", contract_type: "estagio", location: "Rio de Janeiro - RJ", tags: "Vaga inclusiva",
      area: "full-stack", salary_min: 1800, salary_max: 2500, english_level: "intermediario",
      foreign_language: "ingles", foreign_level: "intermediario", active: 1,
      created_at: "2026-10-15 12:00:00", expires_at: "2026-12-14",
    });
    expect(vagaDe(banco, EMAIL_AZYRA).responsibilities.split("\n")).toEqual([
      "• Desenvolvimento: Criação de interfaces, código no servidor e integração de APIs RESTful.",
      "• Qualidade & Manutenção: Correção de bugs, melhorias contínuas e documentação de código limpo.",
      "• Metodologia & Ferramentas: Uso diário de Git/GitHub e participação em reuniões do time (dailies/sprints).",
    ]);
    expect(vagaDe(banco, EMAIL_AZYRA).benefits.split("\n")).toEqual(["Bolsa Auxílio", "Vale Transporte", "VR/VA", "Plano de saúde", "Plano odontológico"]);
    expect(vagaDe(banco, EMAIL_FUSE)).toMatchObject({
      title: "Estágio em Automação", short_title: null, location: "Osasco - SP", area: "back-end",
      salary_min: 1800, salary_max: 2000, english_level: "basico", foreign_level: "basico",
    });
    expect(vagaDe(banco, EMAIL_FUSE).benefits.split("\n")).toEqual(["Bolsa Auxílio", "Vale Transporte", "VR/VA", "Plano de saúde"]);
  });

  test('skills da vaga usam o catálogo do site ("APIs REST" = "REST API"); só a UiPath é criada', async () => {
    const banco = bancoFalso();
    const { log } = await rodar(banco);
    expect(skillsDaVaga(banco, vagaDe(banco, EMAIL_AZYRA))).toEqual(["React", "TypeScript", "Node.js", "JavaScript", "REST API"]);
    expect(skillsDaVaga(banco, vagaDe(banco, EMAIL_FUSE))).toEqual(["Python", "UiPath", "JavaScript"]);
    const novas = banco.tabelas.skills.filter(s => !CATALOGO.some(c => c.id === s.id));
    expect(novas).toEqual([expect.objectContaining({ name: "UiPath", type: "hard", category: "Backend", github_signals: "uipath,rpa" })]);
    expect(log.filter(l => l.includes("skill criada"))).toHaveLength(1);
    expect(banco.tabelas.job_skills.every(js => js.importance === "obrigatoria")).toBe(true);
  });

  test("os logs não mostram as senhas", async () => {
    const { log } = await rodar(bancoFalso());
    const texto = log.join("\n");
    expect(texto).not.toContain(SENHAS.SEED_AZYRA_PASSWORD);
    expect(texto).not.toContain(SENHAS.SEED_FUSE_PASSWORD);
    expect(texto).toContain(`conta criada`);
  });
});

describe("seed das vagas — idempotente", () => {
  test("rodar de novo não duplica nada e não grava nada", async () => {
    const banco = bancoFalso();
    const primeira = await rodar(banco);
    const antes = structuredClone(banco.tabelas);
    const nConsultas = banco.consultas.length;
    const segunda = await rodar(banco);

    expect(banco.tabelas).toEqual(antes);
    expect(segunda.r).toEqual(primeira.r); // mesmos ids de empresa e de vaga
    expect(banco.consultas.slice(nConsultas).filter(c => /^(INSERT|UPDATE|DELETE)/i.test(c.sql))).toEqual([]);
    expect(segunda.log.join("\n")).toMatch(/já existe/);
  });

  test("conta existente é reaproveitada: a senha não muda (nem é exigida) e o logo entra se faltava", async () => {
    const cnpj = cnpjDeTeste("123456780001");
    const banco = bancoFalso({
      users: [{ id: 50, email: EMAIL_AZYRA, password_hash: "hash-que-ja-existia", type: "empresa" }],
      user_company_profiles: [{ id: 1, user_id: 50, razao_social: "Azyra SA", nome_fantasia: "Azyra", cnpj, logo_url: null }],
    });
    await rodar(banco, { SEED_FUSE_PASSWORD: SENHAS.SEED_FUSE_PASSWORD }); // sem SEED_AZYRA_PASSWORD
    expect(usuario(banco, EMAIL_AZYRA).password_hash).toBe("hash-que-ja-existia");
    expect(banco.tabelas.user_company_profiles.find(p => p.user_id === 50))
      .toMatchObject({ razao_social: "Azyra SA", cnpj, logo_url: "/images/empresas/azyra.svg" });
    expect(vagaDe(banco, EMAIL_AZYRA).company_id).toBe(50);
  });

  test("logo que a empresa já tinha não é trocado", async () => {
    const banco = bancoFalso({
      users: [{ id: 50, email: EMAIL_AZYRA, password_hash: "x", type: "empresa" }],
      user_company_profiles: [{ id: 1, user_id: 50, razao_social: "Azyra", nome_fantasia: "Azyra", cnpj: cnpjDeTeste("123456780001"), logo_url: "/uploads/logo-real.png" }],
    });
    await rodar(banco);
    expect(banco.tabelas.user_company_profiles[0].logo_url).toBe("/uploads/logo-real.png");
  });

  test("conta de empresa sem perfil ganha o perfil", async () => {
    const banco = bancoFalso({ users: [{ id: 50, email: EMAIL_AZYRA, password_hash: "x", type: "empresa" }] });
    await rodar(banco);
    expect(banco.tabelas.user_company_profiles.find(p => p.user_id === 50)).toMatchObject({ nome_fantasia: "Azyra", logo_url: "/images/empresas/azyra.svg" });
  });
});

describe("seed das vagas — erros claros, sem gravar pela metade", () => {
  test("sem a senha no .env não cria a conta", async () => {
    const banco = bancoFalso();
    await expect(rodar(banco, {})).rejects.toThrow("Defina SEED_AZYRA_PASSWORD");
    expect(banco.tabelas.users).toEqual([]);
  });

  test("senha com menos de 8 caracteres", async () => {
    await expect(rodar(bancoFalso(), { ...SENHAS, SEED_FUSE_PASSWORD: "curta" })).rejects.toThrow("SEED_FUSE_PASSWORD precisa ter pelo menos 8 caracteres");
  });

  test("e-mail que já é de uma conta de dev: não mexe nela", async () => {
    const banco = bancoFalso({ users: [{ id: 7, email: EMAIL_AZYRA, password_hash: "do-dev", type: "dev" }] });
    await expect(rodar(banco)).rejects.toThrow(/não é uma conta de empresa/);
    expect(banco.tabelas.users).toEqual([{ id: 7, email: EMAIL_AZYRA, password_hash: "do-dev", type: "dev" }]);
    expect(banco.tabelas.user_company_profiles).toEqual([]);
    expect(banco.tabelas.jobs).toEqual([]);
  });

  test("CNPJ inválido no .env", async () => {
    await expect(rodar(bancoFalso(), { ...SENHAS, SEED_AZYRA_CNPJ: "11.111.111/1111-11" })).rejects.toThrow("SEED_AZYRA_CNPJ não é um CNPJ válido");
  });

  test("CNPJ que já é de outra empresa (conta nova ou conta sem perfil)", async () => {
    const outra = { id: 1, user_id: 99, razao_social: "Outra", cnpj: EMPRESAS[0].cnpjPadrao, logo_url: null };
    await expect(rodar(bancoFalso({ user_company_profiles: [outra] }))).rejects.toThrow(/já pertence a outra empresa/);
    const semPerfil = bancoFalso({ users: [{ id: 50, email: EMAIL_AZYRA, password_hash: "x", type: "empresa" }], user_company_profiles: [outra] });
    await expect(rodar(semPerfil)).rejects.toThrow(/já pertence a outra empresa/);
  });

  test("CNPJ do .env é usado quando informado", async () => {
    const cnpj = cnpjDeTeste("987654320001");
    const banco = bancoFalso();
    await rodar(banco, { ...SENHAS, SEED_FUSE_CNPJ: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") });
    expect(banco.tabelas.user_company_profiles.find(p => p.user_id === usuario(banco, EMAIL_FUSE).id).cnpj).toBe(cnpj);
  });

  test("se gravar as skills da vaga falhar, a vaga não fica pela metade (transação)", async () => {
    const banco = bancoFalso({}, { falharEm: /^INSERT INTO job_skills/ });
    await expect(rodar(banco)).rejects.toThrow("falha simulada");
    expect(banco.tabelas.jobs).toEqual([]);
    expect(banco.tabelas.job_skills).toEqual([]);
    expect(usuario(banco, EMAIL_AZYRA)).toBeDefined(); // a conta (transação anterior) continua
  });
});

describe("seed das vagas — segredos fora do código", () => {
  test("CNPJs de teste têm dígitos verificadores válidos e são diferentes", () => {
    expect(isValidCNPJ(cnpjDeTeste("202600010001"))).toBe(true);
    expect(EMPRESAS.map(e => isValidCNPJ(e.cnpjPadrao))).toEqual([true, true]);
    expect(EMPRESAS[0].cnpjPadrao).not.toBe(EMPRESAS[1].cnpjPadrao);
  });

  test("a senha vem só do ambiente: nenhuma senha escrita no script", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "seedVagas.js"), "utf8");
    expect(src).toContain("env[`SEED_${emp.chave}_PASSWORD`]");
    expect(src).not.toMatch(/(senha|password)\s*[:=]\s*["'`][^"'`]/i);
    expect(src).not.toMatch(/bcrypt\.hash\(\s*["'`]/);
  });

  test(".env.example lista as chaves do seed sem valor", () => {
    const exemplo = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    for (const chave of ["SEED_AZYRA_PASSWORD", "SEED_FUSE_PASSWORD", "SEED_AZYRA_CNPJ", "SEED_FUSE_CNPJ"]) {
      expect(exemplo).toMatch(new RegExp(`^${chave}=$`, "m"));
    }
  });

  test("npm run seed:vagas roda o script", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["seed:vagas"]).toBe("node scripts/seedVagas.js");
  });
});
