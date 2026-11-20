// config/sessao.js
// Opções da sessão de login (express-session + express-mysql-session).
//
// 7 dias, renovados a cada visita (rolling): quem está usando o site não é
// deslogado no meio do uso, e quem volta dentro de uma semana continua logado.
// Antes eram 24 horas contadas do login, sem renovação: no dia seguinte a
// pessoa voltava deslogada e o que estava fazendo se perdia.
const SESSAO_MS = 7 * 24 * 60 * 60 * 1000;

function opcoesDaSessao({ secret, store, isProd }) {
  return {
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // reenvia o cookie a cada resposta, com o prazo cheio
    store,
    cookie: {
      secure:   isProd,
      httpOnly: true,
      sameSite: "lax",
      maxAge:   SESSAO_MS,
    },
  };
}

// O session store guarda a mesma validade (usada quando a sessão chega sem
// cookie.expires; o padrão do express-mysql-session é 1 dia).
const opcoesDoStore = { expiration: SESSAO_MS };

module.exports = { SESSAO_MS, opcoesDaSessao, opcoesDoStore };
