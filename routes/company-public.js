// Perfil resumido de empresa, acessível a qualquer usuário logado
// (não só à própria empresa) — usado no painel de mensagens do dev.
// Fica separado de routes/empresa.js porque aquele é todo protegido
// por isEmpresa (só a própria empresa acessa suas rotas).
const express           = require("express");
const router            = express.Router();
const empresaController = require("../controllers/empresaController");
const { isAuth }        = require("../middlewares/auth");

router.get("/:id", isAuth, empresaController.getPublicProfile);
// Endereço antigo do logo (sem login), ainda gravado em alguns logo_url — ver routes/fotos.js.
router.get("/:id/logo", require("./fotos").enviarFoto);

module.exports = router;
