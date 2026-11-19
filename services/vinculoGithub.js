// services/vinculoGithub.js
// Primeiro login com GitHub numa conta criada por e-mail e senha.
//
// Os dados do dev são gravados com a chave github_id ?? id da conta
// (getUserId). Enquanto a conta não tem GitHub, a chave é o id da conta; ao
// vincular, passa a ser o github_id, e tudo o que foi salvo antes ficaria
// para trás ("sumiria"). Por isso o vínculo e a troca de chave acontecem
// juntos, numa transação: ou os dois, ou nenhum. Se der errado, a conta
// continua sem GitHub (e com os dados à vista) e o próximo login tenta de novo.
//
// Nada é apagado: UPDATE IGNORE deixa na chave antiga a linha que colidiria
// com uma já existente na chave nova (ex.: a mesma skill dos dois lados).

// Tabelas cuja coluna guarda a chave do dev (github_id ?? id da conta).
const TABELAS_COM_CHAVE_DO_DEV = [
  ["user_skills",            "github_id"],
  ["user_skill_declaracoes", "github_id"],
  ["user_skill_evidencias",  "github_id"],
  ["user_roadmap_progress",  "github_id"],
  ["match_ia_cache",         "github_id"],
  ["job_applications",       "dev_github_id"],
  ["company_match_actions",  "dev_github_id"],
  ["conversations",          "dev_github_id"],
];

/**
 * Vincula githubId à conta userId (se ela ainda não tem GitHub) e move os
 * dados da chave antiga (userId) para githubId.
 * @returns {Promise<{ vinculou: boolean, movidas: number }>}
 */
async function vincularGithub(db, userId, githubId, githubLogin) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      "UPDATE user_dev_profiles SET github_id = ?, github_login = ? WHERE user_id = ? AND github_id IS NULL",
      [githubId, githubLogin, userId]
    );
    if (!r.affectedRows) { // sem perfil, ou já vinculada (outra aba, outro login)
      await conn.commit();
      return { vinculou: false, movidas: 0 };
    }

    // Se o id da conta for também o github_id de outro dev, as linhas com essa
    // chave podem ser dele: não move nada.
    const [[outro]] = await conn.query(
      "SELECT user_id FROM user_dev_profiles WHERE github_id = ? AND user_id <> ? LIMIT 1",
      [userId, userId]
    );
    let movidas = 0;
    if (!outro && Number(userId) !== Number(githubId)) {
      for (const [tabela, coluna] of TABELAS_COM_CHAVE_DO_DEV) {
        try {
          const [u] = await conn.query(
            `UPDATE IGNORE \`${tabela}\` SET \`${coluna}\` = ? WHERE \`${coluna}\` = ?`,
            [githubId, userId]
          );
          movidas += u.affectedRows || 0;
        } catch (err) {
          if (err.code !== "ER_NO_SUCH_TABLE") throw err; // tabela de recurso ausente neste banco
        }
      }
    }
    await conn.commit();
    return { vinculou: true, movidas };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { vincularGithub, TABELAS_COM_CHAVE_DO_DEV };
