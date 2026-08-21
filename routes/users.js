const express          = require("express");
const router           = express.Router();
const usersController  = require("../controllers/usersController");
const {
  validateRegister, validateLogin,
  validateForgotPassword, validateResetPassword,
} = require("../validators/auth.validator");

router.post("/register",        validateRegister,        usersController.register);
router.post("/login",           validateLogin,            usersController.login);
router.post("/forgot-password", validateForgotPassword,   usersController.forgotPassword);
router.post("/reset-password",  validateResetPassword,    usersController.resetPassword);

module.exports = router;
