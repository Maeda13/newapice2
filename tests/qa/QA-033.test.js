// QA-033 — Estado vazio de listas usa role="status" como filho direto de
// role="list", violando a estrutura ARIA exigida (regra aria-required-children
// do axe-core, impacto "critical"). progresso.ejs e empresa-matchs.ejs
// injetavam o bloco de estado vazio (role="status") como único filho do
// container role="list"/role="listitem", quebrando a expectativa de que um
// role="list" só tenha filhos role="listitem"/group. vagas.ejs usava
// <article role="listitem">, role não permitido nesse elemento (allowed-role).
// Corrigido: o estado vazio agora é um elemento IRMÃO do container de lista
// (escondido/mostrado via `hidden`), nunca um filho dele; e o card de vaga
// virou <div role="listitem"> (role permitido nesse elemento). Depois, a página
// de vagas foi refeita sem <div>: lista nativa <ul> > <li> > <article>.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-033 — estado vazio de listas não é filho de role="list"', () => {
  test('progresso.ejs: #roadmap-empty existe como elemento irmão de #roadmap-list', () => {
    const content = readView('progresso.ejs');
    expect(content).toMatch(/id="roadmap-list"[^>]*role="list"[^>]*>\s*<\/div>\s*<div[^>]*id="roadmap-empty"/);
  });

  test('progresso.ejs: renderCards() não injeta role="status" dentro de #roadmap-list', () => {
    const content = readView('progresso.ejs');
    const fnMatch = content.match(/function renderCards\([\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    const listInnerHtmlAssign = fnBody.match(/\blist\.innerHTML\s*=\s*`([\s\S]*?)`/);
    if (listInnerHtmlAssign) {
      expect(listInnerHtmlAssign[1]).not.toMatch(/role="status"/);
    }
  });

  // Página refeita: as listas são #destaque-list e #vagas-list; cada estado vazio é um <p role="status">
  // IRMÃO da lista (nunca um <li role="status"> dentro do <ul>).
  test.each([['destaque-list', 'destaque-vazio'], ['vagas-list', 'vagas-vazio']])(
    'empresa-matchs.ejs: #%s tem o estado vazio #%s como elemento irmão',
    (lista, vazio) => {
      const content = readView('empresa-matchs.ejs');
      expect(content).toMatch(new RegExp(`<ul[^>]*id="${lista}"[^>]*>\\s*</ul>\\s*<p[^>]*id="${vazio}"[^>]*role="status"`));
    }
  );

  test('empresa-matchs.ejs: nada injeta <li role="status"> dentro das listas', () => {
    const content = readView('empresa-matchs.ejs');
    expect(content).not.toMatch(/<li[^>]*role="status"/);
  });

  // Página refeita sem <div>: a lista agora é nativa (<ul> > <li> > <article>), sem role nenhum
  // — o <li> já é o item de lista, e o <article> fica dentro dele com o papel padrão.
  test('vagas.ejs: card de vaga é <article> dentro de <li> de um <ul> nativo, sem role="listitem"', () => {
    const content = readView('vagas.ejs');
    expect(content).not.toMatch(/role="list(item)?"/);
    const vaga = {
      id: 1, titulo: 'Vaga', resumo: 'Resumo', empresa: { nome: 'Empresa', logo: null, iniciais: 'E' },
      cidade: null, modalidade: null, tag: null, skills: [], nivel: 'junior', area: null, publicada: 0, busca: 'vaga',
    };
    const html = require('ejs').render(content, { vagas: [vaga], viewer: 'visitante', currentPage: 'vagas' },
      { filename: path.join(VIEWS_DIR, 'vagas.ejs'), views: [VIEWS_DIR] });
    expect(html).toMatch(/<ul class="vagas-grade" id="vagas-grade">\s*<li class="vagas-grade__item"[^>]*>\s*<article class="vagas-card"/);
  });

  test('vagas.ejs: o estado "nenhuma vaga encontrada" é irmão da lista, não filho dela', () => {
    const content = readView('vagas.ejs');
    expect(content).toMatch(/<\/ul>\s*<p[^>]*id="vagas-vazio"[^>]*role="status"/);
  });
});
