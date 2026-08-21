const express            = require("express");
const router             = express.Router();
const messagesController = require("../controllers/messagesController");
const { isAuth }         = require("../middlewares/auth");

router.use(isAuth);

router.get("/unread-count",                messagesController.getUnreadCount);
router.get("/conversations",               messagesController.listConversations);
router.post("/conversations",              messagesController.startConversation);
router.get("/conversations/:id",           messagesController.getMessages);
router.post("/conversations/:id/messages", messagesController.sendMessage);
router.patch("/conversations/:id/read",    messagesController.markRead);

module.exports = router;
