// middlewares/sessaoAtualizada.js
// Mantém req.session.user em dia com o banco.
//
// A sessão guardava uma cópia do usuário feita no login e nunca mais a
// conferia. Sessões de dev abertas por e-mail ficavam sem o github_id, que é
// a chave dos dados do dev (getUserId = github_id ?? id), e liam e gravavam
// habilidades, roadmap, candidaturas e conversas noutra chave. O que mudava
// noutro aparelho ou pelo admin (nome, foto, nível) não chegava a quem já
// estava logado, e conta suspensa ou excluída continuava navegando até a
// sessão vencer.
//
// Confere no máximo uma vez a cada INTERVALO_MS por sessão (a marca fica na
// própria sessão, então vale entre instâncias). Se o banco falhar, segue com
// a sessão como está e tenta de novo na próxima requisição.
const db = require("../database/db");
const { fotoPublica } = require("../services/fotoPerfil");

const INTERVALO_MS = 5 * 60 * 1000;

async function atualizarDev(u) {
  const [[p]] = await db.query(
    "SELECT nome, sobrenome, github_login, github_id, nivel, avatar_url FROM user_dev_profiles WHERE user_id = ? LIMIT 1",
    [u.id]
  );
  if (!p) return;
  if (p.nome) u.name = `${p.nome} ${p.sobrenome ?? ""}`.trim();
  if (p.github_login) u.github_login = p.github_login;
  if (p.github_id != null) u.github_id = Number(p.github_id); // a chave dos dados é a do banco
  if (p.nivel) u.nivel = p.nivel;
  u.avatar = fotoPublica(p.avatar_url); // a mesma foto que os outros veem
}

async function atualizarEmpresa(u) {
  const [[p]] = await db.query(
    "SELECT nome_fantasia, razao_social, logo_url FROM user_company_profiles WHERE user_id = ? LIMIT 1",
    [u.id]
  );
  if (!p) return;
  const nome = p.nome_fantasia || p.razao_social;
  if (nome) u.name = nome;
  if (p.razao_social) u.razao_social = p.razao_social;
  u.avatar = fotoPublica(p.logo_url);
}

async function atualizarAdmin(u) {
  const [[p]] = await db.query("SELECT nome FROM user_admin_profiles WHERE user_id = ? LIMIT 1", [u.id]);
  if (p?.nome) u.name = p.nome;
}

const ATUALIZAR = { dev: atualizarDev, empresa: atualizarEmpresa, admin: atualizarAdmin };

async function sessaoAtualizada(req, res, next) {
  const s = req.session;
  const u = s?.user;
  if (!u?.id) return next();
  const agora = Date.now();
  if (s.usuarioConferidoEm && agora - s.usuarioConferidoEm < INTERVALO_MS) return next();

  try {
    const [[conta]] = await db.query("SELECT type, active FROM users WHERE id = ? LIMIT 1", [u.id]);
    if (!conta || !conta.active || conta.type !== u.type) {
      // conta excluída, suspensa ou trocada: a sessão termina aqui
      return s.destroy(err => {
        if (err) console.error("[sessão] não foi possível encerrar a sessão:", err.message);
        next();
      });
    }
    await ATUALIZAR[u.type]?.(u);
    s.usuarioConferidoEm = agora;
  } catch (err) {
    console.error("[sessão] não foi possível conferir o usuário no banco:", err.message);
  }
  next();
}

module.exports = { sessaoAtualizada, INTERVALO_MS };
