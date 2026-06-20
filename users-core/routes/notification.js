const router = require("express").Router();
const {
  getNotifications,
  getUnreadCount,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
} = require("../controllers/notificationController");
const { verifyToken } = require("../../middlewares/verifytoken");

// Get notifications (with pagination & filtering)
router.get("/", verifyToken, getNotifications);

// Get unread count (for badge)
router.get("/unread-count", verifyToken, getUnreadCount);

// Create a notification
router.post("/", verifyToken, createNotification);

// Mark single notification as read
router.patch("/:id/read", verifyToken, markAsRead);

// Mark all as read
router.patch("/mark-all-read", verifyToken, markAllAsRead);

// Delete single notification
router.delete("/:id", verifyToken, deleteNotification);

// Delete all notifications
router.delete("/", verifyToken, deleteAllNotifications);

module.exports = router;
