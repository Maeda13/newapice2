const express             = require("express");
const router              = express.Router();
const roadmapController   = require("../controllers/roadmapController");
const { isAuth }          = require("../middlewares/auth");

router.get("/jobs",                           roadmapController.listJobs);
router.get("/jobs/detalhes",                  roadmapController.listJobsWithDetails);
router.get("/vagas/:id",                      roadmapController.getPublicJob);
router.get("/roadmap/:jobId",          isAuth, roadmapController.getRoadmap);
router.patch("/roadmap/:jobId/skill/:skillId", isAuth, roadmapController.updateSkillStatus);
router.get("/dashboard",               isAuth, roadmapController.getDashboard);

module.exports = router;
