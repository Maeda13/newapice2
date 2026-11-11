// ============================================
// services/areaDaVaga.js
// jobs/job_skills não têm uma coluna de área — a área é inferida comparando
// as habilidades da vaga com as listas de data/habilidades-referencia.json.
// Escolhe a área com mais habilidades em comum; empate entre áreas, ou
// nenhuma habilidade em comum, cai em "full-stack". Heurística de leitura:
// não altera nenhum schema.
// ============================================
const fs   = require("fs");
const path = require("path");

const HABILIDADES_REFERENCIA_PATH = path.join(__dirname, "..", "data", "habilidades-referencia.json");

function inferirAreaPorHabilidades(habilidades) {
  const daVaga = new Set(habilidades);
  if (daVaga.size === 0) return "full-stack";

  const referencia = JSON.parse(fs.readFileSync(HABILIDADES_REFERENCIA_PATH, "utf8"));

  let melhorArea     = "full-stack";
  let melhorContagem = 0;
  let empatada       = false;

  for (const [area, lista] of Object.entries(referencia)) {
    if (!Array.isArray(lista)) continue; // ignora chaves de metadado, ex. "_comentario"
    const contagem = lista.reduce((acc, item) => acc + (daVaga.has(item.habilidade) ? 1 : 0), 0);
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhorArea     = area;
      empatada       = false;
    } else if (contagem === melhorContagem && contagem > 0) {
      empatada = true;
    }
  }

  if (melhorContagem === 0 || empatada) return "full-stack";
  return melhorArea;
}

module.exports = { inferirAreaPorHabilidades };
