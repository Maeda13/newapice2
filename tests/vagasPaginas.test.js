// tests/vagasPaginas.test.js
// Páginas públicas de vagas refeitas igual ao protótipo: /vagas (vitrine com
// busca e filtros) e /vagas/:id (detalhe com o match real do dev).
//   - services/vagasPublicas.js: formatação (datas por extenso, salário,
//     benefícios pontuados...), leitura do banco e o card do match;
//   - views/vagas.ejs e views/vaga-publica.ejs: HTML semântico sem <div>,
//     tudo vindo do banco, e os estados de visitante / dev / empresa.
// Banco falso em memória — nada aqui toca no MySQL de verdade.
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));

const fs   = require("fs");
const path = require("path");
const ejs  = require("ejs");
const db   = require("../database/db");
const vp   = require("../services/vagasPublicas");

const VIEWS  = path.join(__dirname, "..", "views");
const render = (view, locals) => ejs.renderFile(path.join(VIEWS, view), { currentPage: "vagas", origem: "https://exemplo.com", ...locals }, { views: [VIEWS] });

// ── Banco falso ──────────────────────────────────────────
const SKILLS = [
  { id: 1, name: "React" }, { id: 2, name: "TypeScript" }, { id: 3, name: "Node.js" }, { id: 4, name: "JavaScript" },
  { id: 5, name: "REST API" }, { id: 6, name: "Python" }, { id: 7, name: "UiPath" },
  { id: 10, name: "React.js" }, { id: 11, name: "Node" },
];
const JOBS = [
  {
    id: 1, company_id: 100, company: "Azyra", active: 1,
    title: "Estágio em Desenvolvimento de Software", short_title: "Estágio Dev Software",
    summary: "Atue no desenvolvimento de aplicações web/mobile.",
    description: "Buscamos estudantes de tecnologia.\nVocê atuará no ciclo de vida do software.",
    location: "Rio de Janeiro - RJ", modality: "hibrido", tags: "Vaga inclusiva", level: "estagio", area: "full-stack",
    salary_min: 1800, salary_max: 2500, english_level: "intermediario", foreign_language: "ingles", foreign_level: "intermediario",
    responsibilities: "• Desenvolvimento: Criação de interfaces e integração de APIs RESTful.\n• Qualidade & Manutenção: Correção de bugs.",
    benefits: "Bolsa Auxílio\nVale Transporte\nVR/VA",
    created_at: new Date(2026, 9, 15, 12, 0, 0), expires_at: new Date(2026, 11, 14),
  },
  {
    id: 2, company_id: 200, company: "Fuse", active: 1,
    title: "Estágio em Automação", short_title: null, summary: "Mapeie fluxos e desenvolva automações.",
    description: "Buscamos pessoas interessadas em otimizar processos.", location: "Osasco - SP", modality: "hibrido",
    tags: "Vaga inclusiva", level: "estagio", area: "back-end", salary_min: 1800, salary_max: 2000, english_level: "basico",
    foreign_language: "ingles", foreign_level: "basico", responsibilities: null, benefits: "Bolsa Auxílio; Vale Transporte",
    created_at: new Date(2026, 9, 10, 12, 0, 0), expires_at: null,
  },
  {
    id: 3, company_id: 100, company: "Azyra", active: 0, title: "Vaga encerrada", level: "junior",
    created_at: new Date(2026, 9, 20, 12, 0, 0),
  },
  {
    id: 4, company_id: 200, company: "Fuse", active: 1, title: "Dev React Pleno", level: "pleno", modality: "remoto",
    created_at: new Date(2026, 9, 12, 12, 0, 0),
  },
];
const JOB_SKILLS = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 6], [2, 7], [2, 4],
  [4, 1],
].map(([job_id, skill_id], i) => ({ id: i + 1, job_id, skill_id, importance: "obrigatoria", learn_order: i + 1 }));
const PERFIS = [
  { user_id: 100, razao_social: "Azyra Ltda", nome_fantasia: "Azyra", logo_url: "/images/empresas/azyra.svg" },
  { user_id: 200, razao_social: "Fuse Tecnologia", nome_fantasia: "Fuse", logo_url: null },
];
// Dev 9 (github 555): React.js e Node no perfil, JavaScript com confiança 0 (não conta),
// TypeScript aprendido num módulo concluído do roadmap (o de JavaScript está em andamento).
const USER_SKILLS = [
  { github_id: 555, skill_id: 10, confidence: 80 },
  { github_id: 555, skill_id: 11, confidence: 60 },
  { github_id: 555, skill_id: 4,  confidence: 0 },
];
const ETAPAS = [
  { usuario_id: 9, habilidade: "TypeScript", status: "concluida" },
  { usuario_id: 9, habilidade: "JavaScript", status: "em_andamento" },
];

function bancoFalso({ candidaturas = [] } = {}) {
  const nome = (id) => SKILLS.find(s => s.id === id)?.name;
  const skillsDaVaga = (ids) => JOB_SKILLS.filter(js => ids.includes(js.job_id)).map(js => ({ ...js, name: nome(js.skill_id), type: "hard" }));
  return {
    query: async (sql, params = []) => {
      const q = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (q.startsWith("select * from jobs where active = 1")) {
        return [JOBS.filter(j => j.active).sort((a, b) => b.created_at - a.created_at || b.id - a.id)];
      }
      if (q === "select * from jobs where id = ?") return [JOBS.filter(j => j.id === params[0])];
      if (q.startsWith("select * from user_company_profiles where user_id in (?)")) return [PERFIS.filter(p => params[0].includes(p.user_id))];
      if (q.startsWith("select js.job_id, js.skill_id, s.name from job_skills")) return [skillsDaVaga(params[0])];
      if (q.startsWith("select js.skill_id, js.importance, js.learn_order, s.name, s.type from job_skills")) return [skillsDaVaga([params[0]])];
      if (q.includes("from user_skills us join skills s")) {
        return [USER_SKILLS.filter(u => params[0].map(String).includes(String(u.github_id)) && u.confidence > 0).map(u => ({ ...u, name: nome(u.skill_id) }))];
      }
      if (q.includes("from roadmaps r join roadmap_fases")) {
        return [ETAPAS.filter(e => params[0].includes(e.usuario_id) && e.status === "concluida").map(({ usuario_id, habilidade }) => ({ usuario_id, habilidade }))];
      }
      if (q === "select id from job_applications where job_id = ? and dev_github_id = ?") {
        return [candidaturas.filter(c => c.job_id === params[0] && String(c.dev_github_id) === String(params[1]))];
      }
      throw new Error(`SQL inesperado no teste: ${q}`);
    },
  };
}

const DEV       = { id: 9, github_id: 555, type: "dev", nivel: "iniciante" };
const DEV_VAZIO = { id: 10, github_id: 777, type: "dev", nivel: "iniciante" };
const AZYRA     = { id: 100, type: "empresa" };
const FUSE      = { id: 200, type: "empresa" };

let conn;
beforeEach(() => {
  conn = bancoFalso();
  db.query.mockReset();
  db.query.mockImplementation((...args) => conn.query(...args)); // o cálculo do match usa o pool
});

// ── Formatação ───────────────────────────────────────────
describe("formatação dos dados da vaga", () => {
  test("datas por extenso e no formato do <time>, no mesmo dia (data local)", () => {
    expect(vp.dataPorExtenso(new Date(2026, 9, 15, 12))).toBe("15 de outubro de 2026");
    expect(vp.dataPorExtenso("2026-12-14")).toBe("14 de dezembro de 2026");
    expect(vp.dataPorExtenso(null)).toBeNull();
    expect(vp.dataPorExtenso("lixo")).toBeNull();
    expect(vp.dataIso(new Date(2026, 11, 14))).toBe("2026-12-14");
    expect(vp.dataIso(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
    expect(vp.dataIso("2026-10-15 12:00:00")).toBe("2026-10-15");
    expect(vp.dataIso(new Date("x"))).toBeNull();
  });

  test("faixa salarial em reais", () => {
    expect(vp.faixaSalarial(1800, 2500)).toBe("R$ 1.800 – R$ 2.500");
    expect(vp.faixaSalarial(2000, 2000)).toBe("R$ 2.000");
    expect(vp.faixaSalarial(1800, null)).toBe("A partir de R$ 1.800");
    expect(vp.faixaSalarial(null, 2500)).toBe("Até R$ 2.500");
    expect(vp.faixaSalarial(0, 0)).toBeNull();
  });

  test("cidade do card, etiqueta curta e iniciais do logo provisório", () => {
    expect(vp.cidadeDe("Rio de Janeiro - RJ")).toBe("Rio de Janeiro");
    expect(vp.cidadeDe("Osasco, SP")).toBe("Osasco");
    expect(vp.cidadeDe("  ")).toBeNull();
    expect(vp.tagCurta("Vaga inclusiva")).toBe("Inclusiva");
    expect(vp.tagsDe("Vaga inclusiva, Remoto ,")).toEqual(["Vaga inclusiva", "Remoto"]);
    expect(vp.iniciais("Azyra")).toBe("A");
    expect(vp.iniciais("Tech Corp Brasil")).toBe("TC");
    expect(vp.iniciais("")).toBe("?");
  });

  test("responsabilidades: rótulo curto antes dos dois-pontos vira negrito; marcadores saem", () => {
    expect(vp.responsabilidadesDe("• Desenvolvimento: Criar interfaces.\n- Sem rótulo nenhum\n\n")).toEqual([
      { rotulo: "Desenvolvimento", texto: "Criar interfaces." },
      { rotulo: null, texto: "Sem rótulo nenhum" },
    ]);
    const longo = "Uma frase comprida demais para ser um rótulo de verdade: continua";
    expect(vp.responsabilidadesDe(longo)).toEqual([{ rotulo: null, texto: longo }]);
  });

  test('benefícios: cada um termina em ";" e o último em "."', () => {
    expect(vp.beneficiosDe("Bolsa Auxílio\nVale Transporte;\nVR/VA.")).toEqual(["Bolsa Auxílio;", "Vale Transporte;", "VR/VA."]);
    expect(vp.beneficiosDe("Plano de saúde; Plano odontológico")).toEqual(["Plano de saúde;", "Plano odontológico."]);
    expect(vp.beneficiosDe("Gympass")).toEqual(["Gympass."]);
    expect(vp.beneficiosDe(null)).toEqual([]);
  });

  test("área do filtro: a escolhida pela empresa vira o valor do chip", () => {
    expect(vp.areaDoFiltro({ area: "front-end" }, [])).toBe("frontend");
    expect(vp.areaDoFiltro({ area: "back-end" }, [])).toBe("backend");
    expect(vp.areaDoFiltro({ area: "full-stack" }, [])).toBe("fullstack");
    expect(vp.areaDoFiltro({ area: null }, [])).toBeNull();
  });

  test("busca sem acentos e sem maiúsculas", () => {
    expect(vp.normalizar("Júnior em São Paulo")).toBe("junior em sao paulo");
  });
});

// ── Vitrine (/vagas) ─────────────────────────────────────
describe("listarVitrine — vagas ativas, das mais recentes para as mais antigas", () => {
  test("só as ativas, na ordem de publicação", async () => {
    const vagas = await vp.listarVitrine(conn);
    expect(vagas.map(v => v.id)).toEqual([1, 4, 2]);
  });

  test("match nos cards: só para dev logado, igual ao da página da vaga", async () => {
    expect((await vp.listarVitrine(conn)).every(v => v.match === null)).toBe(true); // visitante
    expect((await vp.listarVitrine(conn, { type: "empresa", id: 100 })).every(v => v.match === null)).toBe(true);

    const vagas = await vp.listarVitrine(conn, DEV);
    for (const v of vagas) {
      const detalhe = await vp.detalheDaVaga(conn, v.id, DEV);
      expect(v.match.pct).toBe(detalhe.match.total);
      expect(v.match.faixa).toBe(detalhe.match.faixa);
    }
    expect(vagas.find(v => v.id === 1).match.pct).toBeGreaterThan(0);
    // dev sem nenhuma skill: 0%
    expect((await vp.listarVitrine(conn, DEV_VAZIO)).every(v => v.match.pct === 0)).toBe(true);
  });

  test("card: título curto, resumo, empresa com logo, chips e as 3 primeiras skills", async () => {
    const [azyra] = await vp.listarVitrine(conn);
    expect(azyra).toMatchObject({
      titulo: "Estágio Dev Software",
      resumo: "Atue no desenvolvimento de aplicações web/mobile.",
      empresa: { nome: "Azyra", logo: "/images/empresas/azyra.svg", iniciais: "A" },
      cidade: "Rio de Janeiro", modalidade: "Híbrido", tag: "Inclusiva",
      skills: ["React", "TypeScript", "Node.js"],
      nivel: "estagio", area: "fullstack",
    });
    expect(azyra.publicada).toBe(new Date(2026, 9, 15, 12).getTime());
    expect(azyra.busca).toContain("estagio em desenvolvimento de software"); // o título completo também é achado
    expect(azyra.busca).toContain("rest api");
  });

  test("sem título curto usa o título; sem logo, as iniciais", async () => {
    const fuse = (await vp.listarVitrine(conn)).find(v => v.id === 2);
    expect(fuse.titulo).toBe("Estágio em Automação");
    expect(fuse.empresa).toEqual({ nome: "Fuse", logo: null, iniciais: "F" });
    expect(fuse.area).toBe("backend");
  });
});

// ── Detalhe (/vagas/:id) ─────────────────────────────────
describe("detalheDaVaga", () => {
  test("vaga que não existe → null", async () => {
    expect(await vp.detalheDaVaga(conn, 999, DEV)).toBeNull();
  });

  test("dados da vaga prontos para a página", async () => {
    const { vaga } = await vp.detalheDaVaga(conn, 1, undefined);
    expect(vaga).toMatchObject({
      titulo: "Estágio em Desenvolvimento de Software",
      empresa: { nome: "Azyra" },
      publicadaEm: "15 de outubro de 2026", inscricoesAte: "14 de dezembro de 2026",
      publicadaIso: "2026-10-15", expiraIso: "2026-12-14",
      local: "Rio de Janeiro - RJ", modalidade: "Híbrido", tags: ["Vaga inclusiva"], nivel: "Estágio",
      salario: "R$ 1.800 – R$ 2.500", idioma: { idioma: "Inglês", nivel: "Intermediário" },
      beneficios: ["Bolsa Auxílio;", "Vale Transporte;", "VR/VA."],
    });
    expect(vaga.paragrafos).toHaveLength(2);
    expect(vaga.responsabilidades[0]).toEqual({ rotulo: "Desenvolvimento", texto: "Criação de interfaces e integração de APIs RESTful." });
  });

  test("visitante: match 0% com convite para entrar (volta para a vaga depois do login)", async () => {
    const d = await vp.detalheDaVaga(conn, 1, undefined);
    expect(d.viewer).toBe("visitante");
    expect(d.match).toMatchObject({ total: 0, faixa: "muito-baixo", convite: { link: "/login?next=/vagas/1", acao: "Entrar" } });
    expect(d.match.skills.itens.every(s => s.tem === null)).toBe(true);
    expect(db.query).not.toHaveBeenCalled(); // visitante não calcula match
  });

  test("dev sem nenhuma skill: 0% e convite para completar o perfil, sem erro", async () => {
    const d = await vp.detalheDaVaga(conn, 1, DEV_VAZIO);
    expect(d.match).toMatchObject({ total: 0, convite: { link: "/perfil", acao: "Completar perfil" } });
  });

  test("dev com skills: nomes equivalentes contam (React.js = React, Node = Node.js) e módulo concluído do roadmap também", async () => {
    const d = await vp.detalheDaVaga(conn, 1, DEV);
    // React ✓ (perfil, "React.js"), TypeScript ✓ (roadmap), Node.js ✓ (perfil, "Node"),
    // JavaScript ✕ (confiança 0 e módulo em andamento), REST API ✕ → skills 3/5 = 60%
    expect(d.match.skills.itens).toEqual([
      { nome: "React", tem: true }, { nome: "TypeScript", tem: true }, { nome: "Node.js", tem: true },
      { nome: "JavaScript", tem: false }, { nome: "REST API", tem: false },
    ]);
    expect(d.match.skills).toMatchObject({ pct: 60, faixa: "medio" });
    // iniciante numa vaga de estágio: atende (100%)
    expect(d.match.senioridade).toMatchObject({ pct: 100, faixa: "alto", atende: true, requisito: "Estágio" });
    // 60 × 0,7 + 100 × 0,3 = 72
    expect(d.match).toMatchObject({ total: 72, faixa: "alto", mensagem: "Você está a poucos módulos de aumentar a sua compatibilidade!" });
    expect(d.match.convite).toBeUndefined();
    expect(d.applied).toBe(false);
  });

  test("senioridade acima do nível do dev pesa no total", async () => {
    const d = await vp.detalheDaVaga(conn, 4, DEV); // pleno, só React (que o dev tem)
    expect(d.match.skills.pct).toBe(100);
    expect(d.match.senioridade).toMatchObject({ pct: 10, faixa: "muito-baixo", atende: false, requisito: "Pleno" });
    expect(d.match.total).toBe(73); // 100 × 0,7 + 10 × 0,3
    expect(d.match.mensagem).toBe("Você está a poucos módulos de aumentar a sua compatibilidade!");
  });

  test("dev que já se candidatou", async () => {
    conn = bancoFalso({ candidaturas: [{ job_id: 1, dev_github_id: 555 }] });
    expect((await vp.detalheDaVaga(conn, 1, DEV)).applied).toBe(true);
  });

  test("empresa: sem card de match; dona da vaga só na vaga dela", async () => {
    const dona = await vp.detalheDaVaga(conn, 1, AZYRA);
    expect(dona).toMatchObject({ viewer: "empresa", isOwner: true, match: null });
    expect((await vp.detalheDaVaga(conn, 1, FUSE)).isOwner).toBe(false);
  });

  test("faixas de cor do match", () => {
    const faixa = (pct) => vp.cardDoMatch({ viewer: "dev", skills: [], job: { id: 1, level: "estagio" },
      match: { match: pct, breakdown: [], perfilVazio: false, scores: { skills: pct, seniority: 100 } } }).faixa;
    expect([0, 19, 20, 39, 40, 69, 70, 100].map(faixa))
      .toEqual(["muito-baixo", "muito-baixo", "baixo", "baixo", "medio", "medio", "alto", "alto"]);
  });
});

// ── Views ────────────────────────────────────────────────
// O widget do VLibras (partials/vlibras.ejs, incluído em todas as páginas) traz o
// markup oficial do governo, com <div>; a regra "sem <div>" vale para o HTML da página.
let VLIBRAS;
beforeAll(async () => { VLIBRAS = await ejs.renderFile(path.join(VIEWS, "partials", "vlibras.ejs"), {}); });
const semDiv = (html) => {
  expect(html).toContain(VLIBRAS);
  expect(html.split(VLIBRAS).join("")).not.toMatch(/<div[\s>]/i);
};

describe("views/vagas.ejs (vitrine)", () => {
  test("mostra o % de match no card do dev logado e não mostra para visitante", async () => {
    const dev = await render("vagas.ejs", { vagas: await vp.listarVitrine(conn, DEV), viewer: "dev" });
    expect(dev).toMatch(/<p class="vagas-card__match faixa-(muito-baixo|baixo|medio|alto)"><strong>\d+%<\/strong> de match com o seu perfil<\/p>/);
    const visitante = await render("vagas.ejs", { vagas: await vp.listarVitrine(conn), viewer: "visitante" });
    expect(visitante).not.toContain("vagas-card__match");
  });

  const pagina = async (locals = {}) => render("vagas.ejs", { vagas: await vp.listarVitrine(conn), viewer: "visitante", ...locals });

  test("HTML semântico, sem nenhuma <div> (nem no template, nem na página pronta)", async () => {
    expect(fs.readFileSync(path.join(VIEWS, "vagas.ejs"), "utf8")).not.toMatch(/<div[\s>]/i);
    semDiv(await pagina());
  });

  test("hero, busca, filtros de nível e de área, contador e ordenação", async () => {
    const html = await pagina();
    expect(html).toContain('Encontre sua <span class="vagas-hero__vaga">vaga</span>');
    expect(html).toContain('veja o <span class="vagas-hero__roadmap">roadmap</span> exato');
    expect(html).toMatch(/<form class="vagas-filtros" role="search"/);
    expect(html).toMatch(/<input type="search" name="q" id="vagas-q"/);
    for (const [valor, rotulo] of [["todos", "Todos"], ["estagio", "Estágio"], ["junior", "Júnior"], ["pleno", "Pleno"]]) {
      expect(html).toContain(`data-valor="${valor}" aria-pressed="${valor === "todos"}">${rotulo}</button>`);
    }
    for (const valor of ["todas", "backend", "frontend", "fullstack"]) expect(html).toContain(`data-valor="${valor}"`);
    expect(html).toMatch(/id="vagas-contador"[^>]*>3 vagas encontradas</);
    expect(html).toMatch(/<select[^>]*id="vagas-ordem"[^>]*>\s*<option value="recentes">Mais recentes<\/option>/);
  });

  test("cards: <article> com logo, título, resumo, chips, 3 habilidades e o botão", async () => {
    const html = await pagina();
    expect(html.match(/<article class="vagas-card"/g)).toHaveLength(3);
    expect(html).toContain('<img class="vagas-logo" src="/images/empresas/azyra.svg" alt="Azyra"');
    expect(html).toContain('<span class="vagas-logo vagas-logo--iniciais" role="img" aria-label="Fuse">F</span>');
    expect(html).toContain('<h2 class="vagas-card__titulo" id="vaga-1-titulo">Estágio Dev Software</h2>');
    for (const chip of ["Rio de Janeiro", "Híbrido", "Inclusiva", "React", "TypeScript", "Node.js"]) {
      expect(html).toContain(`<li class="vagas-card__chip">${chip}</li>`);
    }
    expect(html).not.toContain('<li class="vagas-card__chip">REST API</li>'); // 5ª skill da Azyra: o card mostra só 3
    expect(html).toMatch(/<a class="vagas-card__botao" href="\/vagas\/1">Ver vaga e se candidatar<span class="vagas-sr">: Estágio Dev Software<\/span><\/a>/);
    // dados para a busca e os filtros no navegador
    expect(html).toMatch(/<li class="vagas-grade__item"\s+data-nivel="estagio" data-area="fullstack" data-busca="[^"]*azyra[^"]*"/);
  });

  test("empresa vê a vitrine com o atalho para as próprias vagas", async () => {
    const html = await pagina({ viewer: "empresa" });
    expect(html).toContain('<a href="/empresa/vagas" class="vagas-botao">Gerenciar minhas vagas</a>');
    expect(html).toContain("Ver detalhes da vaga");
    expect(html).not.toContain("Ver vaga e se candidatar");
  });

  test("lista vazia e falha no banco têm mensagens próprias", async () => {
    expect(await render("vagas.ejs", { vagas: [], viewer: "visitante" })).toContain("Nenhuma vaga aberta no momento");
    expect(await render("vagas.ejs", { vagas: [], erro: true, viewer: "visitante" })).toContain("Não foi possível carregar as vagas agora");
  });

  test("o script da página só filtra e ordena os cards que já vieram do servidor", () => {
    const src = fs.readFileSync(path.join(VIEWS, "vagas.ejs"), "utf8");
    const script = src.slice(src.lastIndexOf("<script>"));
    expect(script).not.toMatch(/fetch\(|innerHTML/);
    expect(script).toMatch(/dataset\.nivel/);
    expect(script).toMatch(/dataset\.area/);
    expect(script).toMatch(/dataset\.busca/);
    expect(script).toMatch(/history\.replaceState/);
  });
});

describe("views/vaga-publica.ejs (detalhe)", () => {
  const pagina = async (id, sessionUser, extra = {}) => {
    const dados = await vp.detalheDaVaga(conn, id, sessionUser);
    return render("vaga-publica.ejs", { jobId: id, dados, viewer: dados ? dados.viewer : "visitante", ...extra });
  };

  test("HTML semântico, sem nenhuma <div> (nem no template, nem na página pronta)", async () => {
    expect(fs.readFileSync(path.join(VIEWS, "vaga-publica.ejs"), "utf8")).not.toMatch(/<div[\s>]/i);
    semDiv(await pagina(1, undefined));
    semDiv(await pagina(1, DEV));
    semDiv(await pagina(1, AZYRA));
    semDiv(await pagina(999, undefined));
  });

  test("cabeçalho: voltar, empresa, título, datas por extenso e etiquetas", async () => {
    const html = await pagina(1, undefined);
    expect(html).toMatch(/<a href="\/vagas" class="vaga-voltar" id="vagaBack">[\s\S]*?Voltar\s*<\/a>/);
    expect(html).toContain('<figcaption class="vaga-empresa__nome">Azyra</figcaption>');
    expect(html).toContain('<h1 class="vaga-titulo" id="vaga-titulo">Estágio em Desenvolvimento de Software</h1>');
    expect(html).toContain('Publicada em <time datetime="2026-10-15">15 de outubro de 2026</time>');
    expect(html).toContain('Inscrições até <time datetime="2026-12-14">14 de dezembro de 2026</time>');
    for (const e of ["Rio de Janeiro - RJ", "Híbrido", "Vaga inclusiva", "Estágio"]) expect(html).toContain(`<li class="vaga-chip">${e}</li>`);
  });

  test("descrição, responsabilidades com o rótulo em negrito, dados e benefícios pontuados", async () => {
    const html = await pagina(1, undefined);
    expect(html).toContain('<p class="vaga-texto__par">Buscamos estudantes de tecnologia.</p>');
    expect(html).toContain('<strong class="vaga-resp__rotulo">Desenvolvimento:</strong> Criação de interfaces e integração de APIs RESTful.');
    expect(html).toContain('<dt>Faixa salarial</dt><dd class="vaga-dados__salario">R$ 1.800 – R$ 2.500</dd>');
    expect(html).toContain("<dt>Inglês</dt><dd>Intermediário</dd>");
    expect(html).toContain("<dt>Local</dt><dd>Rio de Janeiro - RJ</dd>");
    expect(html).toMatch(/<li>Bolsa Auxílio;<\/li><li>Vale Transporte;<\/li><li>VR\/VA\.<\/li>/);
  });

  test("visitante: 0% com convite, e candidatura e roadmap levam ao login (voltando para a vaga)", async () => {
    const html = await pagina(1, undefined);
    expect(html).toMatch(/<section class="vaga-cartao vaga-match faixa-muito-baixo"/);
    expect(html).toContain('<p class="vaga-match__pct">0%</p>');
    expect(html).toContain('<a class="vaga-link" href="/login?next=/vagas/1">Entrar</a>');
    expect(html).toContain('<a href="/login?next=/vagas/1" class="vaga-botao vaga-botao--primario">Entrar para se candidatar</a>');
    expect(html).toMatch(/<a href="\/login\?next=\/vagas\/1" class="vaga-botao vaga-botao--escuro">[\s\S]*?Gerar roadmap para esta vaga/);
    expect(html).not.toContain('id="btn-apply"');
  });

  test("dev: match real com ✓/✕ (e o texto para leitor de tela), botão de candidatura e roadmap da vaga", async () => {
    const html = await pagina(1, DEV);
    expect(html).toMatch(/<section class="vaga-cartao vaga-match faixa-alto"/);
    expect(html).toContain('<p class="vaga-match__pct">72%</p>');
    expect(html).toContain('<meter class="vaga-barra" min="0" max="100" value="72"');
    expect(html).toContain("Você está a poucos módulos de aumentar a sua compatibilidade!");
    expect(html).toContain('<li class="vaga-item vaga-item--tem"><span class="vaga-item__marca" aria-hidden="true">✓</span> React<span class="vaga-sr"> (você tem)</span></li>');
    expect(html).toContain('<li class="vaga-item vaga-item--falta"><span class="vaga-item__marca" aria-hidden="true">✕</span> REST API<span class="vaga-sr"> (falta)</span></li>');
    expect(html).toMatch(/<li class="vaga-parte faixa-medio">\s*<h3 class="vaga-parte__rotulo" id="match-skills">Skills<\/h3>\s*<p class="vaga-parte__pct">60%<\/p>/);
    expect(html).toMatch(/Requisito: Estágio<span class="vaga-sr"> \(atende\)<\/span>/);
    expect(html).toContain('<button type="button" class="vaga-botao vaga-botao--primario" id="btn-apply" data-vaga="1">Candidatar-se</button>');
    expect(html).toContain('href="/trilha/novo?tipo=vaga&amp;vagaId=1"');
  });

  test("dev que já se candidatou vê o botão desabilitado", async () => {
    conn = bancoFalso({ candidaturas: [{ job_id: 1, dev_github_id: 555 }] });
    const html = await pagina(1, DEV);
    expect(html).toContain('<button type="button" class="vaga-botao vaga-botao--primario" disabled>Você já se candidatou</button>');
    expect(html).not.toContain('id="btn-apply"');
  });

  test("vaga inativa não recebe candidatura", async () => {
    const html = await pagina(3, DEV);
    expect(html).toContain("Esta vaga não está mais recebendo candidaturas.");
    expect(html).not.toContain('id="btn-apply"');
  });

  test("empresa dona: gestão da vaga, sem match nem candidatura; outra empresa só lê", async () => {
    const dona = await pagina(1, AZYRA);
    expect(dona).toContain('<a href="/empresa/vagas/1/editar" class="vaga-botao vaga-botao--primario">Editar vaga</a>');
    expect(dona).toMatch(/<a href="\/empresa\/vagas" class="vaga-voltar"/);
    expect(dona).not.toContain("vaga-match");
    expect(dona).not.toContain("Gerar roadmap");
    const outra = await pagina(1, FUSE);
    expect(outra).toContain("Vaga de outra empresa — visualização somente leitura.");
    expect(outra).not.toContain("Editar vaga");
  });

  test("SEO: canonical e JobPosting com as datas e o salário", async () => {
    const html = await pagina(1, undefined);
    expect(html).toContain('<link rel="canonical" href="https://exemplo.com/vagas/1" />');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(ld).toMatchObject({
      "@type": "JobPosting", title: "Estágio em Desenvolvimento de Software", datePosted: "2026-10-15", validThrough: "2026-12-14",
      hiringOrganization: { name: "Azyra" },
      baseSalary: { currency: "BRL", value: { minValue: 1800, maxValue: 2500, unitText: "MONTH" } },
    });
  });

  test("vaga não encontrada: aviso no lugar do conteúdo", async () => {
    const html = await pagina(999, undefined);
    expect(html).toContain("Vaga não encontrada");
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain("vaga-artigo");
  });
});
