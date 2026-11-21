// Formulário de vaga: ao reabrir uma vaga salva (rascunho ou publicada), o bloco recolhido
// "Mais detalhes (opcional)" já vem aberto quando tem algo preenchido, para a empresa ver o
// rascunho inteiro sem clicar em nada. Vaga nova, ou só com os valores padrão, continua fechado.
const ejs = require("ejs");
const path = require("path");

const VIEWS = path.join(__dirname, "..", "views");
const render = (job) => ejs.renderFile(path.join(VIEWS, "empresa-vaga-form.ejs"), {
  currentPage: "empresa-vagas", job, jobSkills: [], allSkills: [], isEdit: Boolean(job), categories: [],
  user: { type: "empresa", name: "Tech", company: "Tech" },
}, { views: [VIEWS] });

const detalhes = html => html.match(/<details class="form-more"[^>]*>/)[0];
const aberto = html => /\sopen\b/.test(detalhes(html));

const base = { id: 7, title: "Estágio Front", description: "x", level: "estagio", active: 0,
  salary_min: null, salary_max: null, years_experience: 0, max_candidates: 100, benefits: null, tags: null };

describe("empresa-vaga-form — 'Mais detalhes' ao reabrir a vaga", () => {
  test("vaga nova: fechado", async () => {
    expect(aberto(await render(null))).toBe(false);
  });

  test("rascunho só com os valores padrão (sem experiência, 100 candidatos): fechado", async () => {
    expect(aberto(await render(base))).toBe(false);
  });

  test.each([
    ["salário mínimo", { salary_min: 1500 }],
    ["salário máximo", { salary_max: 3000 }],
    ["experiência", { years_experience: 2 }],
    ["máx. de candidatos diferente do padrão", { max_candidates: 30 }],
    ["benefícios", { benefits: "Vale-refeição" }],
    ["tags", { tags: "react,startup" }],
  ])("rascunho com %s: já vem aberto, com o valor no campo", async (_, extra) => {
    const html = await render({ ...base, ...extra });
    expect(aberto(html)).toBe(true);
  });

  test("os valores salvos voltam nos campos de dentro do bloco", async () => {
    const html = await render({ ...base, salary_min: 1500, salary_max: 3000, benefits: "Plano de saúde", tags: "react" });
    expect(html).toMatch(/id="f-sal-min"[^>]*value="1500"/);
    expect(html).toMatch(/id="f-sal-max"[^>]*value="3000"/);
    expect(html).toContain("Plano de saúde</textarea>");
    expect(html).toContain('["react"]'); // as tags viram chips pelo script
  });

  test("texto só com espaços não conta como preenchido", async () => {
    expect(aberto(await render({ ...base, benefits: "   ", tags: "" }))).toBe(false);
  });
});
