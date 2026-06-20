require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

// Use a global variable to prevent exhausting database connections during dev hot-reloads
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

module.exports = prisma;
