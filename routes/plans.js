const express         = require("express");
const router          = express.Router();
const plansController = require("../controllers/plansController");
const { isAuth }      = require("../middlewares/auth");

router.get("/", isAuth, plansController.getPlans);

module.exports = router;
