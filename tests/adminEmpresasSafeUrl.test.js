const fs = require("fs");
const path = require("path");

const ler = (f) => fs.readFileSync(path.join(__dirname, "..", "views", f), "utf8");

describe("admin: páginas de empresas definem o que usam", () => {
  test.each(["admin-empresas.ejs", "admin-empresa.ejs", "admin-relatorio-empresas.ejs"])(
    "%s define safeUrl antes de usar",
    (f) => {
      const html = ler(f);
      const def = html.indexOf("const safeUrl");
      expect(def).toBeGreaterThan(-1);
      expect(def).toBeLessThan(html.indexOf("safeUrl(e.logo_url)") > -1 ? html.indexOf("safeUrl(e.logo_url)") : html.indexOf("safeUrl(co.logo_url)"));
    }
  );

  test("safeUrl aceita https e caminho local, rejeita javascript: e //", () => {
    const m = ler("admin-empresas.ejs").match(/const safeUrl = .*;/)[0];
    const safeUrl = new Function(`${m}; return safeUrl;`)();
    expect(safeUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(safeUrl("/uploads/a.png")).toBe("/uploads/a.png");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("//evil.com/a.png")).toBe("");
  });

  test("empresa recente no dashboard abre o perfil da própria empresa", () => {
    expect(ler("admin-dashboard.ejs")).toContain('href="/admin/empresas/${Number(e.id)}"');
  });
});
