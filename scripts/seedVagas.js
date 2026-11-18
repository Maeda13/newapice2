// ============================================
// scripts/seedVagas.js
// Garante as contas das empresas Azyra e Fuse e cria a vaga de cada uma,
// vinculada à conta certa (jobs.company_id = users.id da empresa).
//
// Idempotente — pode rodar quantas vezes quiser:
//   - conta: procurada pelo e-mail; se já existe, é reaproveitada (a senha
//     dela NÃO é tocada); se não existe, é criada como no cadastro (bcrypt);
//   - vaga: procurada pela empresa + título; se já existe, fica como está;
//   - skills: as da vaga usam a tabela skills do site, comparando nomes sem
//     maiúsculas, acentos e com equivalentes ("APIs REST" = "REST API");
//     só a que não existe (UiPath) é criada.
//
// Variáveis de ambiente (veja .env.example):
//   SEED_AZYRA_PASSWORD, SEED_FUSE_PASSWORD  senhas — só para CRIAR a conta
//   SEED_AZYRA_CNPJ, SEED_FUSE_CNPJ          opcionais; sem elas, um CNPJ de
//                                            teste com dígitos verificadores válidos
//
// Como usar:  npm run seed:vagas   (ou: node scripts/seedVagas.js)
// ATENÇÃO: grava no banco configurado em DB_HOST/DB_NAME.
// ============================================
const bcrypt = require("bcrypt");
const { chaveSkill } = require("../services/matchCalculator");
const { isValidCNPJ } = require("../validators/auth.validator");

const SALT_ROUNDS = 10; // o mesmo do cadastro (controllers/usersController.js)

// CNPJ de teste: base fixa (2026000x/0001) e os dois dígitos verificadores calculados.
function cnpjDeTeste(base12) {
  const dv = (num, pesos) => { const s = pesos.reduce((acc, p, i) => acc + Number(num[i]) * p, 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

const EMPRESAS = [
  {
    chave: "AZYRA",
    email: "contatorazyra@gmail.com",
    nome: "Azyra",
    logo: "/images/empresas/azyra.svg",
    cnpjPadrao: cnpjDeTeste("202600010001"),
    vaga: {
      title: "Estágio em Desenvolvimento de Software",
      short_title: "Estágio Dev Software",
      summary: "Atue no desenvolvimento de aplicações web/mobile, aprenda boas práticas de código e evolua em um ambiente colaborativo.",
      description: [
        "Buscamos estudantes de tecnologia apaixonados por inovação e aprendizado contínuo para integrar nosso time de engenharia.",
        "Nesta oportunidade, você atuará diretamente no ciclo de vida de desenvolvimento de software, colaborando com desenvolvedores experientes na criação, evolução e manutenção de aplicações web e mobile de alto impacto.",
      ].join("\n"),
      location: "Rio de Janeiro - RJ",
      modality: "hibrido",
      tags: "Vaga inclusiva",
      level: "estagio",
      area: "full-stack",
      created_at: "2026-10-15 12:00:00",
      expires_at: "2026-12-14",
      skills: ["React", "TypeScript", "Node.js", "JavaScript", "APIs REST"],
      salary_min: 1800,
      salary_max: 2500,
      ingles: "intermediario",
      responsibilities: [
        "Desenvolvimento: Criação de interfaces, código no servidor e integração de APIs RESTful.",
        "Qualidade & Manutenção: Correção de bugs, melhorias contínuas e documentação de código limpo.",
        "Metodologia & Ferramentas: Uso diário de Git/GitHub e participação em reuniões do time (dailies/sprints).",
      ],
      benefits: ["Bolsa Auxílio", "Vale Transporte", "VR/VA", "Plano de saúde", "Plano odontológico"],
    },
  },
  {
    chave: "FUSE",
    email: "recrutamentofuse.io@gmail.com",
    nome: "Fuse",
    logo: "/images/empresas/fuse.svg",
    cnpjPadrao: cnpjDeTeste("202600020001"),
    vaga: {
      title: "Estágio em Automação",
      short_title: null,
      summary: "Mapeie fluxos de trabalho, desenvolva rotinas de automação (RPA/scripts) e integre sistemas para aumentar a eficiência de operações.",
      description: "Buscamos pessoas interessadas em otimizar processos, integrar sistemas e eliminar tarefas manuais e repetitivas. Você atuará diretamente no mapeamento de fluxos operacionais, na criação de scripts de automação e no desenvolvimento de robôs (RPA/QA). Aprenderá a aumentar a eficiência das operações e transformar rotinas complexas em soluções ágeis e automatizadas.",
      location: "Osasco - SP",
      modality: "hibrido",
      tags: "Vaga inclusiva",
      level: "estagio",
      area: "back-end",
      created_at: "2026-10-15 12:00:00",
      expires_at: "2026-12-14",
      skills: ["Python", "UiPath", "JavaScript"],
      salary_min: 1800,
      salary_max: 2000,
      ingles: "basico",
      responsibilities: [
        "Desenvolvimento: Criação de scripts (RPA/Python), consumo de APIs e integração de sistemas.",
        "Mapeamento & Testes: Mapeamento de processos manuais e execução de testes automatizados.",
        "Ferramentas: Uso de Git/GitHub, documentação de fluxos e participação em reuniões do time.",
      ],
      benefits: ["Bolsa Auxílio", "Vale Transporte", "VR/VA", "Plano de saúde"],
    },
  },
];

// Skills que podem faltar no catálogo (o resto já existe em database/seed-skills.js)
const SKILLS_NOVAS = { uipath: { name: "UiPath", type: "hard", category: "Backend", github_signals: "uipath,rpa" } };

async function emTransacao(conn, fn) {
  if (typeof conn.getConnection !== "function") return fn(conn);
  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}

/** Ids das skills (do catálogo, por nome normalizado), criando só as que faltam. */
async function garantirSkills(conn, nomes, log) {
  const [rows] = await conn.query("SELECT id, name FROM skills");
  const porChave = new Map();
  for (const r of rows) if (!porChave.has(chaveSkill(r.name))) porChave.set(chaveSkill(r.name), r.id);
  const ids = [];
  for (const nome of nomes) {
    const k = chaveSkill(nome);
    if (!porChave.has(k)) {
      const nova = SKILLS_NOVAS[k] ?? { name: nome, type: "hard", category: null, github_signals: k };
      const [res] = await conn.query(
        "INSERT INTO skills (name, type, category, github_signals) VALUES (?, ?, ?, ?)",
        [nova.name, nova.type, nova.category, nova.github_signals]
      );
      porChave.set(k, res.insertId);
      log(`  + skill criada no catálogo: ${nova.name}`);
    }
    ids.push(porChave.get(k));
  }
  return ids;
}

/** CNPJ para um perfil novo: o do .env (ou o de teste), válido e ainda livre (cnpj é UNIQUE). */
async function cnpjLivre(conn, emp, env) {
  const cnpj = String(env[`SEED_${emp.chave}_CNPJ`] || emp.cnpjPadrao).replace(/\D/g, "");
  if (!isValidCNPJ(cnpj)) throw new Error(`${emp.nome}: SEED_${emp.chave}_CNPJ não é um CNPJ válido.`);
  const [usado] = await conn.query("SELECT COUNT(*) AS total FROM user_company_profiles WHERE cnpj = ?", [cnpj]);
  if (usado[0].total > 0) throw new Error(`${emp.nome}: o CNPJ ${cnpj} já pertence a outra empresa — defina SEED_${emp.chave}_CNPJ.`);
  return cnpj;
}

/** Conta da empresa (reaproveitada ou criada) → users.id. */
async function garantirEmpresa(conn, emp, env, log) {
  const email = emp.email.toLowerCase().trim();
  const [existentes] = await conn.query("SELECT id, type FROM users WHERE email = ? LIMIT 1", [email]);

  if (existentes.length) {
    const u = existentes[0];
    if (u.type !== "empresa") throw new Error(`${email} já existe e não é uma conta de empresa (tipo: ${u.type}) — nada foi alterado.`);
    log(`= ${emp.nome}: conta já existe (id ${u.id}), reaproveitada; a senha não foi alterada.`);
    const [perfil] = await conn.query("SELECT id, logo_url FROM user_company_profiles WHERE user_id = ? LIMIT 1", [u.id]);
    if (!perfil.length) {
      const cnpj = await cnpjLivre(conn, emp, env);
      await conn.query(
        "INSERT INTO user_company_profiles (user_id, razao_social, nome_fantasia, cnpj, logo_url) VALUES (?, ?, ?, ?, ?)",
        [u.id, emp.nome, emp.nome, cnpj, emp.logo]
      );
      log(`  + perfil da empresa criado.`);
    } else if (!perfil[0].logo_url) {
      await conn.query("UPDATE user_company_profiles SET logo_url = ? WHERE user_id = ?", [emp.logo, u.id]);
      log(`  + logo provisório definido (${emp.logo}).`);
    }
    return u.id;
  }

  const senha = env[`SEED_${emp.chave}_PASSWORD`];
  if (!senha) throw new Error(`Defina SEED_${emp.chave}_PASSWORD para criar a conta ${email}.`);
  if (String(senha).length < 8) throw new Error(`SEED_${emp.chave}_PASSWORD precisa ter pelo menos 8 caracteres.`);
  const cnpj = await cnpjLivre(conn, emp, env);

  const hash = await bcrypt.hash(String(senha), SALT_ROUNDS);
  const id = await emTransacao(conn, async (c) => {
    const [res] = await c.query("INSERT INTO users (email, password_hash, type) VALUES (?, ?, 'empresa')", [email, hash]);
    await c.query(
      "INSERT INTO user_company_profiles (user_id, razao_social, nome_fantasia, cnpj, logo_url) VALUES (?, ?, ?, ?, ?)",
      [res.insertId, emp.nome, emp.nome, cnpj, emp.logo]
    );
    return res.insertId;
  });
  log(`+ ${emp.nome}: conta criada (id ${id}, ${email}).`);
  return id;
}

/** Vaga da empresa (criada só se ainda não existe uma com o mesmo título) → jobs.id. */
async function garantirVaga(conn, empresaId, emp, log) {
  const v = emp.vaga;
  const [existentes] = await conn.query("SELECT id FROM jobs WHERE company_id = ? AND title = ? LIMIT 1", [empresaId, v.title]);
  if (existentes.length) {
    log(`= ${emp.nome}: a vaga "${v.title}" já existe (id ${existentes[0].id}), nada foi alterado.`);
    return existentes[0].id;
  }
  const skillIds = await garantirSkills(conn, v.skills, log);
  const id = await emTransacao(conn, async (c) => {
    const [res] = await c.query(
      `INSERT INTO jobs
         (title, short_title, summary, company, company_id, description, level, modality, contract_type,
          salary_min, salary_max, location, english_level, foreign_language, foreign_level,
          responsibilities, benefits, tags, area, active, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'estagio', ?, ?, ?, ?, 'ingles', ?, ?, ?, ?, ?, 1, ?, ?)`,
      [v.title, v.short_title, v.summary, emp.nome, empresaId, v.description, v.level, v.modality,
       v.salary_min, v.salary_max, v.location, v.ingles, v.ingles,
       v.responsibilities.map(r => `• ${r}`).join("\n"), v.benefits.join("\n"), v.tags, v.area,
       v.created_at, v.expires_at]
    );
    for (const [i, skillId] of skillIds.entries()) {
      await c.query("INSERT INTO job_skills (job_id, skill_id, importance, learn_order) VALUES (?, ?, 'obrigatoria', ?)", [res.insertId, skillId, i + 1]);
    }
    return res.insertId;
  });
  log(`+ ${emp.nome}: vaga "${v.title}" criada (id ${id}) com ${skillIds.length} skills.`);
  return id;
}

/** Roda o seed num banco (pool do mysql2 ou objeto com query()). */
async function semear(conn, { env = process.env, log = console.log } = {}) {
  const resultado = [];
  for (const emp of EMPRESAS) {
    const empresaId = await garantirEmpresa(conn, emp, env, log);
    const vagaId = await garantirVaga(conn, empresaId, emp, log);
    resultado.push({ empresa: emp.nome, empresaId, vagaId });
  }
  return resultado;
}

module.exports = { semear, cnpjDeTeste, EMPRESAS };

if (require.main === module) {
  require("dotenv").config();
  const db = require("../database/db");
  (async () => {
    try {
      console.log(`Seed de vagas no banco "${process.env.DB_NAME}" em ${process.env.DB_HOST}.`);
      await db.ready; // migrações automáticas (short_title, summary, logo_url) antes de gravar
      const r = await semear(db);
      console.log("\n🎉 Seed de vagas concluído:", r.map(x => `${x.empresa} (empresa ${x.empresaId}, vaga ${x.vagaId})`).join("; "));
      process.exit(0);
    } catch (err) {
      console.error("❌ Seed de vagas:", err.message);
      process.exit(1);
    }
  })();
}
