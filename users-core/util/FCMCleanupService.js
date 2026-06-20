const admin = require("firebase-admin");
const prisma = require("../../config/prisma");
const queues = require("../config/bullQueue");

class FCMCleanupService {
  constructor() {
    this.batchSize = 100;
    this.setupQueueProcessor();
    this.scheduleJobs();
  }

  /**
   * Setup Bull Queue Processor
   * Handles the actual cleanup logic when a job is processed
   */
  setupQueueProcessor() {
    queues.cleanup.process(async (job) => {
      try {
        if (job.data.type === "single_user") {
          return await this.cleanInvalidTokens(job.data.userId);
        } else {
          return await this.cleanupAllUsers(job);
        }
      } catch (error) {
        console.error("FCM Cleanup Error:", error.message);
        throw error;
      }
    });
  }

  /**
   * Schedule recurring cleanup jobs
   */
  async scheduleJobs() {
    await queues.cleanup.add(
      { type: "all_users" },
      {
        repeat: { cron: "0 3 * * 1" },
        jobId: "weekly-fcm-cleanup",
        removeOnComplete: true,
      },
    );

    await queues.cleanup.add(
      { type: "daily_active_check" },
      {
        repeat: { cron: "0 4 * * *" },
        jobId: "daily-active-check",
        removeOnComplete: true,
      },
    );
  }

  /**
   * Clean invalid tokens for a specific user
   * @param {string} userId
   */
  async cleanInvalidTokens(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true },
      });

      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        return 0;
      }

      const originalCount = user.fcmTokens.length;
      const validTokens = [];

      for (const token of user.fcmTokens) {
        try {
          await admin.messaging().send(
            {
              token,
              data: {
                type: "validation_test",
                timestamp: Date.now().toString(),
              },
            },
            { dryRun: true },
          );
          validTokens.push(token);
        } catch (error) {
          // If token is invalid according to Firebase, it throws an error.
          // We don't push it to validTokens.
          console.warn(
            `Token validation failed for user ${userId}:`,
            error.message,
          );
        }
      }

      const removedCount = originalCount - validTokens.length;

      if (removedCount > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: validTokens },
        });
        console.log(
          `FCM Cleanup Success for user ${userId}: Removed ${removedCount} tokens`,
        );
      }

      return validTokens.length;
    } catch (error) {
      console.error("FCM Cleanup Error for user:", userId, error.message);
      return 0;
    }
  }

  /**
   * Cleanup all users (Distributed Job)
   * @param {Object} job - Bull job object for progress tracking
   */
  async cleanupAllUsers(job) {
    try {
      let processed = 0;
      let page = 0;
      const batchSize = this.batchSize;

      // Filter for users who have at least one token
      const totalUsers = await prisma.user.count({
        where: {
          NOT: { fcmTokens: { equals: [] } },
        },
      });

      do {
        const users = await prisma.user.findMany({
          where: {
            NOT: { fcmTokens: { equals: [] } },
          },
          select: { id: true },
          skip: page * batchSize,
          take: batchSize,
        });

        if (users.length === 0) break;

        for (const user of users) {
          await this.cleanInvalidTokens(user.id);
          processed++;
          if (job && totalUsers > 0) {
            job.progress(Math.round((processed / totalUsers) * 100));
          }
        }
        page++;

        // Rate limiting/throttling to prevent overloading Firebase Admin SDK or DB
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (true);

      return { processed };
    } catch (error) {
      console.error("FCM Cleanup Error (all users):", error.message);
      throw error;
    }
  }

  /**
   * Public API to trigger cleanup for a user
   * Adds a job to the queue instead of running immediately
   */
  async cleanupUserTokens(userId) {
    return await queues.cleanup.add({
      type: "single_user",
      userId,
    });
  }
}

const fcmCleanupService = new FCMCleanupService();

module.exports = fcmCleanupService;
