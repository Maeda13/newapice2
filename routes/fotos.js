// GET /api/fotos/:id — foto de perfil de um usuário (dev ou empresa), guardada
// em user_photos (services/fotoPerfil.js). Sem login: a foto aparece também
// em páginas públicas, como a vitrine de vagas.
//
// enviarFoto também atende o endereço antigo do logo da empresa
// (/api/empresas/:id/logo, routes/company-public.js): uma versão de
// desenvolvimento gravou logos em company_logos com esse endereço no logo_url.
const express = require("express");
const db = require("../database/db");
const { TIPOS_FOTO } = require("../services/fotoPerfil");

const router = express.Router();

async function lerFoto(id) {
  const [rows] = await db.query("SELECT mime, data FROM user_photos WHERE user_id = ?", [id]);
  if (rows[0]) return rows[0];
  try {
    const [antigas] = await db.query("SELECT mime, data FROM company_logos WHERE user_id = ?", [id]);
    return antigas[0] ?? null;
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return null; // a tabela antiga nunca existiu aqui
    throw err;
  }
}

async function enviarFoto(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.sendStatus(404);
  try {
    const foto = await lerFoto(id);
    if (!foto || !TIPOS_FOTO.includes(foto.mime)) return res.sendStatus(404);
    res.set({
      "Content-Type": foto.mime,
      // com ?v= o endereço muda a cada envio; sem ele, guarda só por pouco tempo
      "Cache-Control": req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300",
    });
    res.send(foto.data);
  } catch (err) {
    console.error("[GET foto de perfil]", err.message);
    res.sendStatus(500);
  }
}

router.get("/:id", enviarFoto);

module.exports = router;
module.exports.enviarFoto = enviarFoto;
