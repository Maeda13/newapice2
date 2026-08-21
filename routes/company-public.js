// Perfil resumido de empresa, acessível a qualquer usuário logado
// (não só à própria empresa) — usado no painel de mensagens do dev.
// Fica separado de routes/empresa.js porque aquele é todo protegido
// por isEmpresa (só a própria empresa acessa suas rotas).
const express           = require("express");
const router            = express.Router();
const empresaController = require("../controllers/empresaController");
const { isAuth }        = require("../middlewares/auth");

router.get("/:id", isAuth, empresaController.getPublicProfile);

module.exports = router;
