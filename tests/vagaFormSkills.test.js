// tests/vagaFormSkills.test.js
// Formulário de vaga (empresa-vaga-form.ejs): as skills vão num segundo pedido
// (PUT .../skills), e a tela dizia "Vaga publicada!" e voltava para a lista
// mesmo se ele falhasse; ao abrir a vaga de novo, as skills eram as antigas.
// E, numa vaga nova, tentar de novo criava OUTRA vaga.
//
// O script da página roda fora do navegador (vm), com DOM e fetch falsos.
const path = require("path");
const vm = require("vm");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "..", "views");

// Recorta uma função do <script> pelas chaves (ou uma declaração de uma linha).
function trecho(fonte, nome, { opcional = false } = {}) {
  const inicio = fonte.search(new RegExp(`(async )?function ${nome}\\(`));
  if (inicio !== -1) {
    let i = fonte.indexOf("{", inicio), nivel = 0;
    for (; i < fonte.length; i++) {
      if (fonte[i] === "{") nivel++;
      else if (fonte[i] === "}" && --nivel === 0) break;
    }
    return fonte.slice(inicio, i + 1);
  }
  const linha = fonte.match(new RegExp(`^\\s*(?:let|const) ${nome}\\s*=.*;$`, "m"));
  if (linha) return linha[0];
  if (opcional) return "";
  throw new Error(`não achei ${nome}`);
}

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const elemento = (valor = "") => ({ value: valor, textContent: "", disabled: false, focus() {}, classList: { add() {}, remove() {} } });

let fonte;
beforeAll(async () => {
  fonte = await ejs.renderFile(path.join(VIEWS, "empresa-vaga-form.ejs"), {
    user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-vagas",
    allSkills: [{ id: 1, name: "React", type: "hard", category: "Frontend" }], jobSkills: [], job: null, isEdit: false,
  }, { views: [VIEWS] });
});

function pagina(respostas, { isEdit = false, editJobId = null } = {}) {
  const chamadas = [], toasts = [];
  const els = { "f-title": elemento("Dev Júnior"), "f-level": elemento("junior") };
  const ctx = vm.createContext({
    document: { getElementById: id => (els[id] ??= elemento()) },
    window: { location: { href: "/empresa/vagas/nova" } },
    fetch: async (url, opcoes = {}) => { chamadas.push({ url, method: opcoes.method ?? "GET" }); return respostas.shift(); },
    setTimeout: fn => fn(),
    showToast: (msg, erro = false) => toasts.push({ msg, erro }),
    addToList() {}, marcarErro() {},
    lists: { location: [], resp: [] }, formTags: [],
    requiredSkills: [{ id: 1 }], desiredSkills: [], softSkills: [],
    isEdit, editJobId,
  });
  vm.runInContext([trecho(fonte, "vagaCriadaId", { opcional: true }), trecho(fonte, "submit")].join("\n"), ctx);
  return { ctx, chamadas, toasts };
}
const pedidos = chamadas => chamadas.map(c => `${c.method} ${c.url}`);

test("se salvar as skills falhar, mostra o erro e não diz que a vaga foi salva", async () => {
  const { ctx, chamadas, toasts } = pagina([resposta(201, { id: 77 }), resposta(400, { error: "Skill inválida." })]);
  await ctx.submit(true);
  expect(pedidos(chamadas)).toEqual(["POST /api/empresa/jobs", "PUT /api/empresa/jobs/77/skills"]);
  expect(toasts).toEqual([{ msg: "Skill inválida.", erro: true }]);
  expect(ctx.window.location.href).toBe("/empresa/vagas/nova"); // continua no formulário
});

test("tentar de novo atualiza a vaga já criada, em vez de criar outra", async () => {
  const { ctx, chamadas } = pagina([
    resposta(201, { id: 77 }), resposta(500, { error: "Erro interno." }),
    resposta(200, { success: true }), resposta(200, { success: true }),
  ]);
  await ctx.submit(true);
  await ctx.submit(true);
  expect(pedidos(chamadas).slice(2)).toEqual(["PATCH /api/empresa/jobs/77", "PUT /api/empresa/jobs/77/skills"]);
});

test("editando: falha nas skills também aparece, e nada de 'Vaga atualizada!'", async () => {
  const { ctx, chamadas, toasts } = pagina([resposta(200, { success: true }), resposta(500, {})], { isEdit: true, editJobId: 9 });
  await ctx.submit(true);
  expect(pedidos(chamadas)).toEqual(["PATCH /api/empresa/jobs/9", "PUT /api/empresa/jobs/9/skills"]);
  expect(toasts).toEqual([{ msg: "Erro ao salvar vaga", erro: true }]);
});

test("com tudo salvo, confirma e volta para a lista", async () => {
  const { ctx, toasts } = pagina([resposta(201, { id: 77 }), resposta(200, { success: true })]);
  await ctx.submit(true);
  expect(toasts).toEqual([{ msg: "Vaga publicada!", erro: false }]);
  expect(ctx.window.location.href).toBe("/empresa/vagas");
});
