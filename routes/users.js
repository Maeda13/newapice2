const express          = require("express");
const router           = express.Router();
const usersController  = require("../controllers/usersController");
const { validateRegister, validateLogin } = require("../validators/auth.validator");

router.post("/register", validateRegister, usersController.register);
router.post("/login",    validateLogin,    usersController.login);

module.exports = router;
