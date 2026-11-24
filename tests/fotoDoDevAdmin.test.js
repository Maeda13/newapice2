// tests/fotoDoDevAdmin.test.js
// Foto do dev no admin (dashboard, Usuários e relatórios): contas antigas não
// têm avatar_url salvo (a foto do GitHub só passou a ser gravada no login), e as
// de disco sumiram. Sem foto salva, vale a foto pública do GitHub pelo github_id;
// sem GitHub, as iniciais.
const { avatarDoDev } = require("../services/fotoPerfil");

describe("avatarDoDev", () => {
  test("a foto salva (do banco ou do GitHub) vale primeiro", () => {
    expect(avatarDoDev("/api/fotos/7?v=1", 123)).toBe("/api/fotos/7?v=1");
    expect(avatarDoDev("https://avatars.githubusercontent.com/u/5?v=4", 123)).toBe("https://avatars.githubusercontent.com/u/5?v=4");
  });
  test("sem foto salva, ou com a de disco que sumiu, usa a do GitHub pelo github_id", () => {
    expect(avatarDoDev(null, 9001)).toBe("https://avatars.githubusercontent.com/u/9001?v=4");
    expect(avatarDoDev("/uploads/avatars/999999.jpg", "9001")).toBe("https://avatars.githubusercontent.com/u/9001?v=4");
  });
  test("sem foto e sem GitHub (ou github_id inválido), null: ficam as iniciais", () => {
    for (const id of [null, undefined, 0, -3, "abc", 1.5]) expect(avatarDoDev(null, id)).toBeNull();
  });
});

describe("telas do admin usam a foto do dev com a reserva do GitHub", () => {
  const fs = require("fs");
  const path = require("path");
  const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  test.each(["controllers/adminController.js", "services/relatorioPlanos.js", "services/relatorioMatchs.js"])("%s", (f) => {
    const s = ler(f);
    expect(s).toMatch(/avatarDoDev\(/);
    expect(s).not.toMatch(/fotoPublica\((d|u|r|dev\??)\.avatar_url\)/);
  });
  test("os relatórios pedem o github_id ao banco", () => {
    expect(ler("services/relatorioPlanos.js")).toMatch(/SELECT user_id, nome, sobrenome, github_login, github_id, avatar_url/);
    expect(ler("services/relatorioMatchs.js")).toMatch(/COALESCE\(github_id, user_id\) AS chave, github_id,/);
  });
});
