const express = require("express");
const router = express.Router();
const socialChatController = require("../controllers/SocialChatController");
const { verifyToken } = require("../../middlewares/verifytoken");

const { upload } = require("../../middlewares/upload");

// Send a message to a friend
router.post("/send", verifyToken, socialChatController.sendMessage);

// Upload attachment
router.post("/upload", verifyToken, upload.array("media", 1), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }
  res.status(200).json({ url: req.files[0].path });
});

// Get conversation with a friend
router.get("/:friendId", verifyToken, socialChatController.getMessages);

// Get unread messages count
router.get("/unread/count", verifyToken, socialChatController.getUnreadCount);

module.exports = router;
