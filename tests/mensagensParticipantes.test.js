// Pop-up "Participantes desta conversa" (a "›" ao lado do nome da empresa) e as
// ações dele: marcar como não lida e favoritar.
const fs   = require("fs");
const path = require("path");
const ejs  = require("ejs");

jest.mock("../database/db", () => ({ query: jest.fn() }));
const db = require("../database/db");
const controller = require("../controllers/messagesController");

const ROOT = path.join(__dirname, "..");
const ler  = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("marcação do pop-up", () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(ROOT, "views/mensagens.ejs"), {
      user: { name: "Igor Gomes", type: "dev", avatar: null },
      currentPage: "mensagens",
    });
  });

  test("é um <dialog> nomeado, com título, fechar e seções com headings em ordem", () => {
    expect(html).toMatch(/<dialog class="msg-part" id="modalParticipantes" aria-labelledby="partTitulo">/);
    expect(html).toMatch(/<h2 class="msg-part-titulo" id="partTitulo">Participantes desta conversa<\/h2>/);
    expect(html).toMatch(/<button type="button" class="msg-part-fechar" id="partFechar" aria-label="Fechar">/);
    expect(html).toMatch(/<h3 id="partAcoes">Ações da conversa<\/h3>/);
    expect(html).toMatch(/<h3 id="partAtendimento">Atendimento<\/h3>/);
  });

  test("lista a empresa e o próprio usuário (\"Você\", com a inicial quando não há avatar)", () => {
    expect(html).toMatch(/id="partEmpresaNome"/);
    expect(html).toMatch(/<span class="msg-part-avatar" aria-hidden="true">I<\/span>\s*<span>Você<\/span>/);
  });

  test("com avatar, mostra a foto (decorativa)", async () => {
    const comFoto = await ejs.renderFile(path.join(ROOT, "views/mensagens.ejs"), {
      user: { name: "Igor", type: "dev", avatar: "/uploads/a.png" }, currentPage: "mensagens",
    });
    expect(comFoto).toMatch(/<img class="msg-part-avatar" src="\/uploads\/a\.png" alt="" \/>/);
  });

  test("ações: não lida, favoritar (aria-pressed) e Central de Ajuda (link externo seguro)", () => {
    expect(html).toMatch(/<button type="button" class="msg-part-acao" id="partNaoLida">[\s\S]*Marcar como não lida/);
    expect(html).toMatch(/<button type="button" class="msg-part-acao" id="partFavorito" aria-pressed="false">/);
    expect(html).toMatch(/<a class="msg-part-acao" href="\/para-devs#faq-title" target="_blank" rel="noopener">[\s\S]*Acesse a Central de Ajuda/);
  });
});

describe("comportamento no front", () => {
  const view = ler("views/mensagens.ejs");

  test('a "›" abre o pop-up (e não mais o painel da empresa)', () => {
    expect(view).toMatch(/\$\("threadEmpresaBtn"\)\.addEventListener\("click", abrirParticipantes\)/);
    expect(view).not.toMatch(/\$\("threadEmpresaBtn"\)\.addEventListener\("click", openInfoPanel\)/);
  });

  test("usa showModal() e devolve o foco ao fechar", () => {
    expect(view).toMatch(/\$\("modalParticipantes"\)\.showModal\(\)/);
    expect(view).toMatch(/\$\("modalParticipantes"\)\.addEventListener\("close", \(\) => \{ focoAntesDoPopup\?\.focus\?\.\(\); \}\)/);
  });

  test("o clique em \"Marcar como não lida\" chama a API e atualiza a lista", () => {
    expect(view).toMatch(/patchConversa\("unread"\)/);
    expect(view).toMatch(/patchConversa\("favorite", \{ favorite: novo \}\)/);
  });

  test("o cabeçalho e o autor das mensagens trazem o prefixo \"Empresa\"", () => {
    expect(view).toMatch(/escapeHtml\(nomeDaEmpresa\(activeConversation\.company_name\)\)/);
  });
});

// ── API ──────────────────────────────────────────────────
const resp = () => {
  const r = { statusCode: 200, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
};
const req = (extra = {}) => ({
  params: { id: "7" },
  body: {},
  session: { user: { id: 10, type: "dev", github_id: 555 } },
  ...extra,
});
const conversaDoDev = [[{ id: 7, dev_github_id: 555, company_id: 20 }]];

beforeEach(() => db.query.mockReset());

describe("PATCH /conversations/:id/unread", () => {
  test("volta a última mensagem recebida para não lida", async () => {
    db.query
      .mockResolvedValueOnce(conversaDoDev)           // ownsConversation
      .mockResolvedValueOnce([[{ id: 99 }]])          // última mensagem do outro lado
      .mockResolvedValueOnce([{}]);                   // UPDATE
    const r = resp();
    await controller.markUnread(req(), r);
    expect(r.body).toEqual({ success: true, unread: 1 });
    const [sql, params] = db.query.mock.calls[2];
    expect(sql).toMatch(/UPDATE messages SET read_at = NULL WHERE id = \?/);
    expect(params).toEqual([99]);
    // a busca olha só mensagens do outro lado
    expect(db.query.mock.calls[1][0]).toMatch(/sender_user_id != \?/);
  });

  test("sem mensagem recebida: 409, nada é alterado", async () => {
    db.query.mockResolvedValueOnce(conversaDoDev).mockResolvedValueOnce([[undefined]]);
    const r = resp();
    await controller.markUnread(req(), r);
    expect(r.statusCode).toBe(409);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test("conversa de outra pessoa: 404", async () => {
    db.query.mockResolvedValueOnce([[{ id: 7, dev_github_id: 1, company_id: 20 }]]);
    const r = resp();
    await controller.markUnread(req(), r);
    expect(r.statusCode).toBe(404);
  });

  test("id inválido: 400", async () => {
    const r = resp();
    await controller.markUnread(req({ params: { id: "abc" } }), r);
    expect(r.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("PATCH /conversations/:id/favorite", () => {
  test("o dev favorita pela própria coluna", async () => {
    db.query.mockResolvedValueOnce(conversaDoDev).mockResolvedValueOnce([{}]);
    const r = resp();
    await controller.setFavorite(req({ body: { favorite: true } }), r);
    expect(r.body).toEqual({ success: true, favorite: true });
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE conversations SET favorite_dev = \?/);
    expect(db.query.mock.calls[1][1]).toEqual([1, 7]);
  });

  test("a empresa usa a coluna dela e pode desfavoritar", async () => {
    db.query.mockResolvedValueOnce([[{ id: 7, dev_github_id: 555, company_id: 20 }]]).mockResolvedValueOnce([{}]);
    const r = resp();
    await controller.setFavorite(req({ body: { favorite: false }, session: { user: { id: 20, type: "empresa" } } }), r);
    expect(db.query.mock.calls[1][0]).toMatch(/favorite_company = \?/);
    expect(db.query.mock.calls[1][1]).toEqual([0, 7]);
  });

  test("exige favorite booleano", async () => {
    const r = resp();
    await controller.setFavorite(req({ body: { favorite: "sim" } }), r);
    expect(r.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("conversa de outra pessoa: 404 e nada é gravado", async () => {
    db.query.mockResolvedValueOnce([[{ id: 7, dev_github_id: 1, company_id: 20 }]]);
    const r = resp();
    await controller.setFavorite(req({ body: { favorite: true } }), r);
    expect(r.statusCode).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe("listagem e rotas", () => {
  test("a lista devolve favorite do lado de quem pede", async () => {
    const linha = { id: 7, job_id: null, company_id: 20, favorite_dev: 1, favorite_company: 0, unread: 0, created_at: "x" };
    db.query.mockResolvedValueOnce([[linha]]);
    const r = resp();
    await controller.listConversations(req(), r);
    expect(r.body[0].favorite).toBe(true);

    db.query.mockResolvedValueOnce([[linha]]);
    const r2 = resp();
    await controller.listConversations(req({ session: { user: { id: 20, type: "empresa" } } }), r2);
    expect(r2.body[0].favorite).toBe(false);
  });

  test("as rotas novas existem e a migração é aditiva (addColumn)", () => {
    const rotas = ler("routes/messages.js");
    expect(rotas).toMatch(/router\.patch\("\/conversations\/:id\/unread",\s+messagesController\.markUnread\)/);
    expect(rotas).toMatch(/router\.patch\("\/conversations\/:id\/favorite", messagesController\.setFavorite\)/);
    const dbjs = ler("database/db.js");
    expect(dbjs).toMatch(/addColumn\("conversations", "favorite_dev", "TINYINT\(1\) NOT NULL DEFAULT 0"\)/);
    expect(dbjs).toMatch(/addColumn\("conversations", "favorite_company", "TINYINT\(1\) NOT NULL DEFAULT 0"\)/);
    expect(dbjs).not.toMatch(/DROP\s+(TABLE|COLUMN)[^\n]*favorite/i);
  });
});
