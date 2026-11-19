// GET /api/fotos/:id — foto de perfil de um usuário (dev ou empresa), guardada
// em user_photos (services/fotoPerfil.js). Sem login: a foto aparece também
// em páginas públicas, como a vitrine de vagas.
const express = require("express");
const db = require("../database/db");
const { TIPOS_FOTO } = require("../services/fotoPerfil");

const router = express.Router();

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.sendStatus(404);
  try {
    const [rows] = await db.query("SELECT mime, data FROM user_photos WHERE user_id = ?", [id]);
    const foto = rows[0];
    if (!foto || !TIPOS_FOTO.includes(foto.mime)) return res.sendStatus(404);
    res.set({
      "Content-Type": foto.mime,
      // com ?v= o endereço muda a cada envio; sem ele, guarda só por pouco tempo
      "Cache-Control": req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300",
    });
    res.send(foto.data);
  } catch (err) {
    console.error("[GET /api/fotos/:id]", err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
