// tests/roadmapStatusSalvo.test.js
// Roadmap (roadmap.ejs): marcar uma skill como "em progresso"/"concluída"
// mostrava o botão marcado (e "undefined%" no match) mesmo com o servidor
// recusando: sessão vencida, erro. Ao recarregar, o status voltava.
//
// O script da página roda fora do navegador (vm), com DOM e fetch falsos.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fonte = fs.readFileSync(path.join(__dirname, "..", "views", "roadmap.ejs"), "utf8");

// Recorta uma função do <script> pelas chaves.
function trecho(nome) {
  const inicio = fonte.search(new RegExp(`(async )?function ${nome}\\(`));
  if (inicio === -1) throw new Error(`não achei ${nome}`);
  let i = fonte.indexOf("{", inicio), nivel = 0;
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}" && --nivel === 0) break;
  }
  return fonte.slice(inicio, i + 1);
}

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

function pagina(res) {
  const marcados = [];
  const item = {
    className: "skill-item learn status-pendente",
    querySelectorAll: () => [],
    querySelector: () => ({ textContent: "Pendente" }),
  };
  const btn = { disabled: false, classList: { add: c => marcados.push(c), remove() {} }, closest: () => item };
  const els = { "match-percent": { textContent: "40%" }, "match-bar": { value: 40 }, "match-tip": { textContent: "dica" } };
  const location = { pathname: "/roadmap", search: "?job=3", href: "/roadmap?job=3" };
  const ctx = vm.createContext({
    jobId: "3",
    document: { getElementById: id => els[id] },
    window: { location }, location,
    fetch: async () => res,
    console: { error() {} },
  });
  vm.runInContext(["updateStatus", "matchTip", "statusLabel"].map(trecho).join("\n"), ctx);
  return { ctx, btn, item, els, marcados, location };
}

test("servidor recusou: a skill não aparece marcada e o match não muda", async () => {
  const p = pagina(resposta(500, { error: "Erro interno." }));
  await p.ctx.updateStatus(5, "concluido", p.btn);
  expect(p.marcados).not.toContain("active");
  expect(p.item.className).toBe("skill-item learn status-pendente");
  expect(p.els["match-percent"].textContent).toBe("40%");
  expect(p.btn.disabled).toBe(false);
});

test("sessão vencida: vai para o login e depois volta para o roadmap", async () => {
  const p = pagina(resposta(401, { error: "Não autenticado." }));
  await p.ctx.updateStatus(5, "concluido", p.btn);
  expect(p.location.href).toBe(`/login?next=${encodeURIComponent("/roadmap?job=3")}`);
  expect(p.marcados).not.toContain("active");
});

test("salvo: marca a skill e atualiza o match", async () => {
  const p = pagina(resposta(200, { success: true, newMatch: 55 }));
  await p.ctx.updateStatus(5, "concluido", p.btn);
  expect(p.marcados).toContain("active");
  expect(p.item.className).toBe("skill-item learn status-concluido");
  expect(p.els["match-percent"].textContent).toBe("55%");
});
