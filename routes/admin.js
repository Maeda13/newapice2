const express         = require("express");
const router          = express.Router();
const adminController = require("../controllers/adminController");
const { isAdmin }     = require("../middlewares/auth");

router.use(isAdmin);

router.get("/dashboard", adminController.getDashboard);

router.get("/users",             adminController.getUsers);
router.patch("/users/:id",       adminController.updateUserStatus);
router.patch("/users/:id/plan",  adminController.updateUserPlan);

router.get("/empresas",             adminController.getEmpresas);
router.patch("/empresas/:id",       adminController.updateEmpresaStatus);
router.patch("/empresas/:id/plan",  adminController.updateEmpresaPlan);

router.get("/jobs",            adminController.getJobs);
router.patch("/jobs/:id",      adminController.updateJobStatus);

router.get("/matches",         adminController.getMatches);
router.get("/reports",         adminController.getReports);

router.get("/skills",                       adminController.getSkills);
router.post("/skills",                      adminController.createSkill);
router.patch("/skills/:id",                 adminController.updateSkill);
router.delete("/skills/:id",                adminController.deleteSkill);
router.get("/skills/:id/resources",         adminController.getSkillResources);
router.post("/skills/:id/resources",        adminController.addSkillResource);
router.delete("/skills/:id/resources/:resourceId", adminController.deleteSkillResource);

module.exports = router;
