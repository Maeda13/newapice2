const axios  = require("axios");
const crypto = require("crypto");
const db     = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");
const { safeNextPath } = require("../middlewares/auth");
const { fotoPublica } = require("../services/fotoPerfil");
const { vincularGithub } = require("../services/vinculoGithub");

// APP_URL é validada em server.js na subida do processo — aqui já é garantida.
const GITHUB_CALLBACK_PATH = "/auth/github/callback";
const REDIRECT_URI = `${process.env.APP_URL}${GITHUB_CALLBACK_PATH}`;
const APP_HOST = new URL(process.env.APP_URL).host;

// Logins com GitHub em andamento nesta sessão (state anti-CSRF + página de
// retorno). São vários, não só o último: quem clica de novo em "Continuar
// com GitHub" (ou abre duas abas) enquanto o GitHub pede a verificação do
// dispositivo sobrescrevia o state, e a volta do primeiro login dava
// "state inválido". Cada state vale por 10 minutos e só uma vez.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_MAX_PENDING  = 5;

function pendingLogins(session, now) {
  return (Array.isArray(session.oauthStates) ? session.oauthStates : [])
    .filter(p => p && typeof p.state === "string" && p.exp > now);
}

// ── Qual conta é a deste GitHub ───────────────────────────
const NOREPLY = /@users\.noreply\.github\.com$/i;

// E-mail de verdade (não o endereço "noreply" do GitHub), normalizado.
function emailReal(email) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  return e && !NOREPLY.test(e) ? e : null;
}

// E-mails verificados da conta GitHub, o principal primeiro. O e-mail do
// perfil (githubUser.email) só vem quando é público; o escopo user:email, já
// pedido no login, dá acesso aos outros. Se falhar, segue só com o público.
async function emailsVerificadosDoGithub(accessToken) {
  try {
    const { data } = await axios.get("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (Array.isArray(data) ? data : [])
      .filter(e => e?.verified)
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
      .map(e => emailReal(e.email))
      .filter(Boolean);
  } catch (err) {
    console.warn("[github-oauth] Não foi possível ler os e-mails verificados do GitHub:", err.message);
    return [];
  }
}

async function contaPeloGithubId(githubId) {
  const [rows] = await db.query(
    `SELECT u.id, u.type, u.active, u.email, p.github_id
       FROM user_dev_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.github_id = ? LIMIT 1`,
    [githubId]
  );
  return rows[0]?.type === "dev" ? rows[0] : null;
}

async function contasPorEmail(emails) {
  if (!emails.length) return [];
  const [rows] = await db.query(
    `SELECT u.id, u.type, u.active, u.email, p.github_id
       FROM users u LEFT JOIN user_dev_profiles p ON p.user_id = u.id
      WHERE u.email IN (?)`,
    [emails]
  );
  return rows.map(r => ({ ...r, email: String(r.email).toLowerCase() }));
}

const authController = {
  githubLogin: (req, res) => {
    // O GitHub sempre volta para APP_URL. Se o login começou em outro
    // endereço (ex.: 127.0.0.1:3000 com APP_URL=http://localhost:3000), o
    // cookie da sessão não voltaria junto e o state se perderia — então,
    // em desenvolvimento, recomeça o login no endereço certo.
    if (process.env.NODE_ENV !== "production" && req.get("host") !== APP_HOST) {
      return res.redirect(`${process.env.APP_URL}${req.originalUrl}`);
    }

    const now   = Date.now();
    const state = crypto.randomBytes(16).toString("hex");
    // Página para voltar depois do login (ex.: /planos/dev_pro/assinar),
    // vinda do ?next= da tela de login. Só paths internos.
    const next = safeNextPath(req.query.next);
    req.session.oauthStates = [
      ...pendingLogins(req.session, now),
      { state, next, exp: now + OAUTH_STATE_TTL_MS },
    ].slice(-OAUTH_MAX_PENDING);
    delete req.session.oauthState; // formato antigo (um state só)
    delete req.session.oauthNext;

    const url =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${process.env.GITHUB_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=read:user,user:email,public_repo` +
      `&state=${state}`;
    res.redirect(url);
  },

  githubCallback: async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.redirect("/login?error=auth_failed");

    const pending = pendingLogins(req.session, Date.now());
    const login = typeof state === "string" ? pending.find(p => p.state === state) : undefined;
    const rest = pending.filter(p => p !== login); // state é de uso único
    if (rest.length) req.session.oauthStates = rest;
    else delete req.session.oauthStates;

    if (!login) {
      const motivo = !state
        ? "o GitHub voltou sem o parâmetro state"
        : !pending.length
          ? "não há login com GitHub em andamento nesta sessão (expirou, ou o cookie da sessão não voltou junto)"
          : "o state não corresponde a nenhum login em andamento nesta sessão";
      console.warn(`[github-oauth] Login recusado: ${motivo}.`);
      return res.redirect("/login?error=invalid_state");
    }

    try {
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
        },
        { headers: { Accept: "application/json" } }
      );

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        console.error(
          "[github-oauth] token exchange falhou:",
          tokenResponse.data,
          { client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: REDIRECT_URI }
        );
        return res.redirect("/login?error=token_failed");
      }

      const { data: githubUser } = await axios.get("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const { data: repos } = await axios.get(
        "https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Qual conta é esta? 1) a que já tem este github_id (o e-mail do GitHub
      // pode ter mudado, ou deixado de ser público); 2) uma conta dev com um
      // dos e-mails verificados no GitHub (quem se cadastrou por e-mail e
      // senha); 3) uma conta nova. Antes era só pelo e-mail público: com ele
      // privado (o padrão de muita gente) ou trocado, o login criava outra
      // conta, vazia, e o que a pessoa tinha salvo "sumia". O endereço
      // "noreply" nunca serve para achar conta: o login do GitHub muda de dono.
      const emailPublico = emailReal(githubUser.email);
      let conta = await contaPeloGithubId(githubUser.id);
      if (!conta) {
        const emails = [...new Set([emailPublico, ...(await emailsVerificadosDoGithub(accessToken))].filter(Boolean))];
        const contas = await contasPorEmail(emails);
        // Esse e-mail já pertence a uma conta empresa — não hijackar a
        // conta para uma sessão "dev". Login com GitHub só serve dev.
        if (emailPublico && contas.some(c => c.email === emailPublico && c.type !== "dev")) {
          return res.redirect("/login?error=email_in_use_company");
        }
        conta = emails.map(e => contas.find(c => c.email === e && c.type === "dev")).find(Boolean) ?? null;
      }
      if (conta && !conta.active) {
        return res.redirect("/login?error=account_suspended");
      }

      let internalId, emailDaConta;
      if (conta) {
        internalId = conta.id;
        emailDaConta = conta.email;
        if (conta.github_id == null) {
          // Primeiro login com GitHub numa conta de e-mail e senha: vincula e
          // traz para a chave do GitHub o que já estava salvo (uma transação;
          // se falhar, a conta segue sem GitHub e o próximo login tenta de novo).
          try {
            const { movidas } = await vincularGithub(db, conta.id, githubUser.id, githubUser.login);
            if (movidas) console.log(`[github-oauth] Conta ${conta.id} vinculada ao GitHub; ${movidas} registro(s) passaram para a chave do GitHub.`);
          } catch (err) {
            console.error("[github-oauth] Não foi possível vincular o GitHub à conta:", err.message);
          }
        }
      } else {
        // Sem e-mail público, um endereço do GitHub que é só desta conta
        // GitHub (id+login: o login pode mudar de dono, o id não).
        emailDaConta = emailPublico || `${githubUser.id}+${githubUser.login}@users.noreply.github.com`;
        const [result] = await db.query(
          "INSERT INTO users (email, type) VALUES (?, 'dev')",
          [emailDaConta]
        );
        internalId = result.insertId;
      }

      // Conta nova: o perfil já nasce com o GitHub. Conta existente: o
      // github_id gravado não é trocado (os dados estão nessa chave), e o
      // login do GitHub só é atualizado quando é a mesma conta GitHub.
      await db.query(`
        INSERT INTO user_dev_profiles (user_id, nome, github_login, github_id, nivel)
        VALUES (?, ?, ?, ?, 'iniciante')
        ON DUPLICATE KEY UPDATE
          github_login = IF(github_id = VALUES(github_id), VALUES(github_login), github_login)
      `, [internalId, githubUser.name || githubUser.login, githubUser.login, githubUser.id]);

      const [devProfiles] = await db.query(
        "SELECT nome, sobrenome, github_id, nivel, avatar_url FROM user_dev_profiles WHERE user_id = ?",
        [internalId]
      );
      const devProfile = devProfiles[0] ?? {};
      // A chave dos dados é a gravada no perfil (getUserId = github_id ?? id).
      const githubIdDaConta = devProfile.github_id != null ? Number(devProfile.github_id) : undefined;

      // Sem foto salva, a do GitHub vira a do perfil: antes ela ficava só na
      // sessão do próprio dev, e quem via o perfil de fora (empresa, admin)
      // via só as iniciais. Foto que o dev enviou não é trocada (só a antiga
      // em disco que já sumiu, no Render).
      if (!fotoPublica(devProfile.avatar_url) && githubUser.avatar_url) {
        await db.query("UPDATE user_dev_profiles SET avatar_url = ? WHERE user_id = ?", [githubUser.avatar_url, internalId])
          .then(() => { devProfile.avatar_url = githubUser.avatar_url; })
          .catch(err => console.error("[auth/github] Não foi possível salvar a foto do GitHub:", err.message));
      }

      // Fire-and-forget: falha aqui não deve bloquear o login. Roda depois de
      // conhecer o usuário interno para usar os repositórios que ele importou
      // em /repositorios (se houver) em vez dos 30 mais recentes.
      matchSkillsFromGitHub(accessToken, githubIdDaConta ?? internalId, repos, { userId: internalId }).catch(err => {
        console.error("[github-analyzer]", err.message);
      });

      req.session.user = {
        id:          internalId,
        github_id:   githubIdDaConta,
        type:        "dev",
        // o nome salvo no perfil (o do GitHub só na conta nova)
        name:        [devProfile.nome, devProfile.sobrenome].filter(Boolean).join(" ").trim() || githubUser.name || githubUser.login,
        login:       githubUser.login,
        email:       emailDaConta,
        avatar:      fotoPublica(devProfile.avatar_url) ?? githubUser.avatar_url,
        nivel:       devProfile.nivel ?? "iniciante",
        bio:         githubUser.bio,
        publicRepos: githubUser.public_repos,
        followers:   githubUser.followers,
        following:   githubUser.following,
        githubUrl:   githubUser.html_url,
        accessToken,
        repos: repos.map(repo => ({
          name:        repo.name,
          full_name:   repo.full_name,
          description: repo.description,
          language:    repo.language,
          stars:       repo.stargazers_count,
          forks:       repo.forks_count,
          url:         repo.html_url,
          updatedAt:   repo.updated_at,
        })),
      };

      res.redirect(safeNextPath(login.next) ?? "/dashboard");
    } catch (error) {
      console.error("Erro no callback:", error.message);
      res.redirect("/login?error=server_error");
    }
  },

  logout: (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("[logout] Erro ao destruir sessão:", err.message);
      res.redirect("/");
    });
  },
};

module.exports = authController;
 