const { Server } = require("socket.io");

let io;
const adminSockets = new Set();

const setupSocket = (server) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  console.log("Socket allowed origins:", allowedOrigins);

  io = new Server(server, {
    path: "/socket.io/",
    allowEIO3: true,
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["polling", "websocket"],
    perMessageDeflate: false,
  });

  io.on("connection", (socket) => {
    console.log(`New socket connection: ${socket.id}`);

    // Allow user to join a private room with their User ID
    socket.on("join_room", (userId) => {
      if (userId) {
        socket.join(userId.toString());
        console.log(`User ${userId} joined their private room`);
      }
    });

    socket.on("register_admin", () => {
      adminSockets.add(socket.id);
      console.log(`Admin registered: ${socket.id}`);
    });

    // Real-time typing status
    socket.on("typing", (data) => {
      // data: { to, from, isTyping }
      if (data.to) {
        io.to(data.to.toString()).emit("user_typing", data);
      }
    });

    socket.on("disconnect", (reason) => {
      adminSockets.delete(socket.id);
      console.log(`Socket disconnected: ${socket.id} (Reason: ${reason})`);
    });
  });
};

const getIo = () => {
  if (!io) {
    throw new Error(
      "Socket.io has not been initialized. Call setupSocket() first.",
    );
  }
  return io;
};

module.exports = {
  setupSocket,
  getIo,
  adminSockets,
};
