const asyncHandler = require("express-async-handler");
const prisma = require("../../config/prisma");
const NotificationService = require("../../Notification/notificationService");

/**
 * @desc    Get user notifications (with pagination & filtering)
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const { page = 1, limit = 20, isRead, type } = req.query;

  const where = { userId };
  if (isRead !== undefined) where.isRead = isRead === "true";
  if (type) where.type = type;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.notification.count({ where }),
  ]);

  const unreadCount = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  res.status(200).json({
    notifications,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
    unreadCount,
  });
});

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });
  res.status(200).json({ unreadCount: count });
});

/**
 * @desc    Create a notification (internal use / admin)
 * @route   POST /api/notifications
 * @access  Private
 */
exports.createNotification = asyncHandler(async (req, res) => {
  const { userId, title, message, type = "info", link } = req.body;

  if (!userId || !title || !message) {
    return res.status(400).json({ error: "userId, title, and message are required" });
  }

  const notification = await prisma.notification.create({
    data: { userId, title, message, type, link: link || null },
  });

  // Send FCM push notification if user has tokens
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });
    if (user?.fcmTokens?.length > 0) {
      await NotificationService.sendToMultipleDevices(
        user.fcmTokens,
        title,
        message,
        { type, link: link || "", notificationId: notification.id }
      );
    }
  } catch (fcmErr) {
    console.error("FCM push failed:", fcmErr.message);
  }

  res.status(201).json(notification);
});

/**
 * @desc    Mark notification as read
 * @route   PATCH /api/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id || req.user._id;

  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== userId) {
    return res.status(404).json({ error: "Notification not found" });
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });

  res.status(200).json(updated);
});

/**
 * @desc    Mark all notifications as read
 * @route   PATCH /api/notifications/mark-all-read
 * @access  Private
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  res.status(200).json({ message: "All notifications marked as read" });
});

/**
 * @desc    Delete a single notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id || req.user._id;

  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== userId) {
    return res.status(404).json({ error: "Notification not found" });
  }

  await prisma.notification.delete({ where: { id } });
  res.status(200).json({ message: "Notification deleted" });
});

/**
 * @desc    Delete all notifications for user
 * @route   DELETE /api/notifications
 * @access  Private
 */
exports.deleteAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  await prisma.notification.deleteMany({ where: { userId } });
  res.status(200).json({ message: "All notifications deleted" });
});
