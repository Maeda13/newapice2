// ============================================
// models/User.js
// Funções de acesso aos dados da tabela `users` e perfis relacionados.
// ============================================
const db = require("../database/db");

module.exports = {
  findByEmail: async (email) => {
    const e = String(email).toLowerCase().trim();
    const [rows] = await db.query("SELECT * FROM users WHERE email = ? LIMIT 1", [e]);
    return rows[0] || null;
  },

  // `conn`: a conexão da transação (criarContaComPerfil); sem ela, o pool.
  create: async ({ email, passwordHash, type }, conn = db) => {
    const e = String(email).toLowerCase().trim();
    const [result] = await conn.query(
      "INSERT INTO users (email, password_hash, type) VALUES (?, ?, ?)",
      [e, passwordHash, type]
    );
    return result.insertId;
  },

  createDevProfile: async ({ userId, nome, sobrenome, githubLogin, nivel }, conn = db) => {
    await conn.query(
      `INSERT INTO user_dev_profiles (user_id, nome, sobrenome, github_login, nivel)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, nome, sobrenome, githubLogin, nivel]
    );
  },

  cnpjExists: async (cnpj) => {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM user_company_profiles WHERE cnpj = ?", [cnpj]);
    return rows[0] && rows[0].total > 0;
  },

  createCompanyProfile: async ({ userId, razaoSocial, nomeFantasia, cnpj, setor, tamanho, site }, conn = db) => {
    await conn.query(
      `INSERT INTO user_company_profiles (user_id, razao_social, nome_fantasia, cnpj, setor, tamanho, site)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, razaoSocial, nomeFantasia, cnpj, setor, tamanho, site]
    );
  },

  // Conta e perfil juntos, numa transação: ou os dois, ou nenhum. Antes, se o
  // perfil falhasse, a conta ficava gravada sem ele: o e-mail passava a "já
  // cadastrado", o login entrava numa conta vazia e nada do que a pessoa
  // salvava pegava. `perfil`: os campos de createDevProfile ou de
  // createCompanyProfile, sem o userId.
  criarContaComPerfil: async ({ email, passwordHash, type, perfil }) => {
    const User = module.exports;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const userId = await User.create({ email, passwordHash, type }, conn);
      if (type === "dev") await User.createDevProfile({ userId, ...perfil }, conn);
      else await User.createCompanyProfile({ userId, ...perfil }, conn);
      await conn.commit();
      return userId;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  },

  findDevProfile: async (userId) => {
    const [rows] = await db.query("SELECT * FROM user_dev_profiles WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },

  findCompanyProfile: async (userId) => {
    const [rows] = await db.query("SELECT * FROM user_company_profiles WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },

  findAdminProfile: async (userId) => {
    const [rows] = await db.query("SELECT * FROM user_admin_profiles WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },
};
