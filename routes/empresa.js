const express            = require("express");
const router             = express.Router();
const empresaController  = require("../controllers/empresaController");
const { isEmpresa }      = require("../middlewares/auth");

router.get("/dashboard",          isEmpresa, empresaController.getDashboard);
router.get("/skills",             isEmpresa, empresaController.getSkills);
router.post("/jobs",              isEmpresa, empresaController.createJob);
router.patch("/jobs/:id",         isEmpresa, empresaController.updateJob);
router.delete("/jobs/:id",        isEmpresa, empresaController.deleteJob);
router.get("/jobs/:id/skills",    isEmpresa, empresaController.getJobSkills);
router.put("/jobs/:id/skills",    isEmpresa, empresaController.updateJobSkills);
router.get("/profile",            isEmpresa, empresaController.getProfile);
router.patch("/profile",          isEmpresa, empresaController.updateProfile);

module.exports = router;
