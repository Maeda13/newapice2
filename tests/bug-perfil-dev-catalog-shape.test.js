// Bug reportado pelo usuário: "não é possível acessar a página de perfil,
// após clicar em 'Meu perfil'". GET /api/user/skills/catalog (getSkillsCatalog
// em controllers/profileController.js) retorna um envelope paginado
// `{ data: skills, total, page, pageSize, pages }`, mas o script inline de
// perfil-dev.ejs (loadProfile()) trata o JSON bruto da resposta como se já
// fosse o array e repassa direto para fillCatalog(catalog, ...), que faz
// `catalog.forEach(...)`. Como `catalog` é um objeto, não um array, isso
// lança TypeError — capturado pelo try/catch de loadProfile(), que esconde
// o skeleton de loading mas nunca revela #state-content (permanece `hidden`
// desde o HTML inicial). Resultado: página em branco sob o header, só com
// um toast de erro que some em poucos segundos.
const fs = require('fs');
const path = require('path');

const controllerContent = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'profileController.js'),
  'utf8'
);
const viewContent = fs.readFileSync(
  path.join(__dirname, '..', 'views', 'perfil-dev.ejs'),
  'utf8'
);

describe('Bug — perfil-dev.ejs trava com resposta paginada de /api/user/skills/catalog', () => {
  test('getSkillsCatalog continua retornando o envelope paginado { data, total, ... }', () => {
    expect(controllerContent).toMatch(/res\.json\(\{\s*data:\s*skills,\s*total,/);
  });

  test('loadProfile() desembrulha o campo "data" antes de tratar a resposta como array de skills', () => {
    const scriptMatch = viewContent.match(/async function loadProfile\(\)[\s\S]*?\n {4}\}/);
    expect(scriptMatch).not.toBeNull();
    const loadProfileBody = scriptMatch[0];

    // A variável passada para fillCatalog() precisa vir de `.data` do JSON
    // da resposta de /api/user/skills/catalog, não do objeto de resposta
    // inteiro (que tem forma { data, total, page, pageSize, pages }).
    expect(loadProfileBody).toMatch(/catalogRes\.json\(\)[\s\S]{0,80}\.data/);
  });
});
