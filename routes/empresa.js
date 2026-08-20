const express            = require("express");
const router             = express.Router();
const empresaController  = require("../controllers/empresaController");
const { isEmpresa }      = require("../middlewares/auth");
const { validateCreateJob, validateUpdateJob, jobIdParam } = require("../validators/job.validator");

router.get("/dashboard",          isEmpresa, empresaController.getDashboard);
router.get("/skills",             isEmpresa, empresaController.getSkills);
router.post("/jobs",              isEmpresa, validateCreateJob, empresaController.createJob);
router.patch("/jobs/:id",         isEmpresa, validateUpdateJob, empresaController.updateJob);
router.delete("/jobs/:id",        isEmpresa, jobIdParam, empresaController.deleteJob);
router.get("/jobs/:id/skills",    isEmpresa, jobIdParam, empresaController.getJobSkills);
router.put("/jobs/:id/skills",    isEmpresa, jobIdParam, empresaController.updateJobSkills);
router.get("/matchs",                          isEmpresa, empresaController.getMatchs);
router.patch("/matchs/:devGithubId/:jobId",    isEmpresa, empresaController.updateMatchAction);
router.get("/desenvolvedores",                 isEmpresa, empresaController.getDesenvolvedores);
router.get("/dev/:id",                         isEmpresa, empresaController.getDevProfile);
router.get("/profile",                         isEmpresa, empresaController.getProfile);
router.patch("/profile",                       isEmpresa, empresaController.updateProfile);
router.get("/jobs/:id/candidaturas",           isEmpresa, jobIdParam, empresaController.getJobApplications);
router.post("/candidaturas/:id/resumo-ia",     isEmpresa, empresaController.getApplicationSummary);

module.exports = router;
