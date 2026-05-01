// ============================================
// routes/auth.js
// Rotas de autenticação com GitHub OAuth
// ============================================
const express = require("express");
const axios   = require("axios");
const router  = express.Router();

const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");

// --------------------------------------------
// GET /auth/github
// Redireciona o usuário para a tela de login do GitHub
// --------------------------------------------
router.get("/github", (req, res) => {
  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&scope=read:user,user:email,public_repo`;

  res.redirect(githubAuthUrl);
});

// --------------------------------------------
// GET /auth/github/callback
// GitHub redireciona aqui após o usuário aceitar
// --------------------------------------------
router.get("/github/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) return res.redirect("/login?error=auth_failed");

  try {
    // Troca o code pelo access_token
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id:     process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) return res.redirect("/login?error=token_failed");

    // Busca dados do usuário na API do GitHub
    const { data: githubUser } = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Busca repositórios do usuário
    const { data: repos } = await axios.get(
      "https://api.github.com/user/repos?sort=updated&per_page=30",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Analisa os repositórios e salva as skills detectadas no banco
    await matchSkillsFromGitHub(accessToken, githubUser.id, repos);

    // Salva o usuário na sessão
    req.session.user = {
      id:          githubUser.id,
      name:        githubUser.name || githubUser.login,
      login:       githubUser.login,
      email:       githubUser.email,
      avatar:      githubUser.avatar_url,
      bio:         githubUser.bio,
      publicRepos: githubUser.public_repos,
      followers:   githubUser.followers,
      following:   githubUser.following,
      githubUrl:   githubUser.html_url,
      accessToken, // Guardado para chamadas futuras à API do GitHub
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

    // ✅ Redireciona para o dashboard após login com GitHub
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Erro no callback:", error.message);
    res.redirect("/login?error=server_error");
  }
});

// --------------------------------------------
// GET /auth/logout
// Encerra a sessão do usuário
// --------------------------------------------
router.get("/logout", (req, res) => {
  req.session.destroy();
  // ✅ Redireciona para a landing page (não para /dashboard)
  res.redirect("/");
});

module.exports = router;