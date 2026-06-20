const Bull = require("bull");

const getRedisConfig = () => {
  const host =
    process.env.REDIS_HOST ||
    (process.env.RUNNING_IN_DOCKER === "1" ? "redis" : "127.0.0.1");
  const port = parseInt(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;

  return {
    host,
    port,
    password,
    db: parseInt(process.env.REDIS_QUEUE_DB) || 1, // Separate DB for queues (DB 1)
  };
};

const redisConfig = getRedisConfig();

const queues = {
  tripMonitoring: new Bull("trip-monitoring", { redis: redisConfig }),
  cleanup: new Bull("cleanup", { redis: redisConfig }),
  reassurance: new Bull("reassurance-checks", { redis: redisConfig }),
};

Object.entries(queues).forEach(([name, queue]) => {
  queue.on("error", (error) => {
    console.error(`[Bull Queue Error] ${name}:`, error.message);
  });

  queue.on("failed", (job, error) => {
    console.error(
      `[Bull Queue Failed] ${name} (Job ID: ${job.id}):`,
      error.message,
    );
  });

  queue.on("completed", (job) => {
    console.log(`[Bull Queue Completed] ${name} (Job ID: ${job.id})`);
  });

  queue.on("stalled", (job) => {
    console.warn(`[Bull Queue Stalled] ${name} (Job ID: ${job.id})`);
  });
});

// Graceful shutdown
const shutdown = async () => {
  console.log("🛑 Shutting down Bull queues...");

  await Promise.all(Object.values(queues).map((queue) => queue.close()));

  console.log("✅ All queues closed");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = queues;
