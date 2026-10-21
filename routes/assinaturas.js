const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/assinaturasController");
const { isAuth } = require("../middlewares/auth");

// Todas autenticadas e sempre sobre a assinatura do próprio usuário da sessão.
router.post("/",         isAuth, controller.create);
router.get("/minha",     isAuth, controller.getMine);
router.put("/cancelar",  isAuth, controller.cancel);
router.put("/cartao",    isAuth, controller.updateCard);
router.put("/plano",     isAuth, controller.changePlan);

module.exports = router;
