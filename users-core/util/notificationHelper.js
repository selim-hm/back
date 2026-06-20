const NotificationService = require("../../Notification/notificationService");
const prisma = require("../../config/prisma");

/**
 * Create a notification in the database and optionally send FCM push
 * @param {string} userId - The user to notify
 * @param {string} title - Notification title
 * @param {string} message - Notification message body
 * @param {string} type - Notification type: 'order' | 'system' | 'chat' | 'success' | 'warning' | 'error' | 'info'
 * @param {string} [link] - Optional link to navigate to when clicked
 * @param {boolean} [sendPush=true] - Whether to send FCM push notification
 */
async function createNotification(userId, title, message, type = "info", link = null, sendPush = true) {
  try {
    const notification = await prisma.notification.create({
      data: { userId, title, message, type, link },
    });

    if (sendPush) {
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
    }

    return notification;
  } catch (err) {
    console.error("Failed to create notification:", err.message);
    return null;
  }
}

/**
 * Create notifications for multiple users (broadcast)
 * @param {string[]} userIds - Array of user IDs
 * @param {string} title
 * @param {string} message
 * @param {string} type
 * @param {string} [link]
 */
async function createBulkNotifications(userIds, title, message, type = "info", link = null) {
  const results = [];
  for (const userId of userIds) {
    const notif = await createNotification(userId, title, message, type, link, false);
    if (notif) results.push(notif);
  }
  return results;
}

/**
 * Create notification for a specific role (all users with that role)
 * @param {string} role - User role: 'doctor', 'nursing', 'patient', 'pharmacy', 'shipping_company', 'admin'
 * @param {string} title
 * @param {string} message
 * @param {string} type
 * @param {string} [link]
 */
async function createRoleNotification(role, title, message, type = "info", link = null) {
  try {
    const users = await prisma.user.findMany({
      where: { role },
      select: { id: true },
    });
    return createBulkNotifications(
      users.map((u) => u.id),
      title, message, type, link
    );
  } catch (err) {
    console.error("Failed to create role notification:", err.message);
    return [];
  }
}

module.exports = {
  createNotification,
  createBulkNotifications,
  createRoleNotification,
};
