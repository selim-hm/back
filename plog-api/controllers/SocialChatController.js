const asyncHandler = require("express-async-handler");
const prisma = require("../../config/prisma");
const xss = require("xss");

/**
 * Utility: Find or Create a Private ChatRoom between two users
 */
async function getOrCreatePrivateRoom(userA, userB) {
  // Try to find a room where BOTH users are participants
  const sharedRooms = await prisma.chatRoom.findMany({
    where: {
      type: "private",
      participants: {
        every: {
          userId: { in: [userA, userB] },
        },
      },
    },
    include: { participants: true },
  });

  // Filter exact match of just these two users
  let room = sharedRooms.find((r) => r.participants.length === 2);

  if (!room) {
    // Create new room
    room = await prisma.chatRoom.create({
      data: {
        type: "private",
        participants: {
          create: [{ userId: userA }, { userId: userB }],
        },
      },
    });
  }

  return room.id;
}

/**
 * @desc    Send Message to Friend
 * @route   POST /api/social/chat/send
 * @access  Private
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { to, message, messageType } = req.body;
  const from = req.user.id || req.user._id;

  // Verify they are friends
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: from, addresseeId: to },
        { requesterId: to, addresseeId: from },
      ],
    },
  });

  if (!friendship) {
    return res
      .status(403)
      .json({ message: "You can only message your friends" });
  }

  const roomId = await getOrCreatePrivateRoom(from, to);

  const newMessage = await prisma.message.create({
    data: {
      roomId: roomId,
      senderId: from,
      receiverId: to,
      content: xss(message),
      messageType: messageType || "text",
    },
  });

  // Mongoose Adapter for frontend state
  const adaptedMessage = {
    ...newMessage,
    _id: newMessage.id,
    from: newMessage.senderId,
    to: newMessage.receiverId,
    message: newMessage.content,
  };

  // Get User details for the emission
  const fromUser = await prisma.user.findUnique({
    where: { id: from },
    select: { id: true, username: true, avatar: true },
  });

  // Socket.io Real-time emission
  const io = req.app.get("io");
  if (io) {
    io.to(to.toString()).emit("newSocialMessage", {
      ...adaptedMessage,
      from: { ...fromUser, _id: fromUser.id }, // Frontend expects object for from in emission
    });
  }

  res.status(201).json({ data: adaptedMessage });
});

/**
 * @desc    Get Messages with a Friend
 * @route   GET /api/social/chat/:friendId
 * @access  Private
 */
exports.getMessages = asyncHandler(async (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.id || req.user._id;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: userId, receiverId: friendId },
        { senderId: friendId, receiverId: userId },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  // Mark outgoing messages from friend as read
  await prisma.message.updateMany({
    where: {
      senderId: friendId,
      receiverId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  // Map to legacy Mongoose format for frontend
  const adaptedMessages = messages.map((m) => ({
    ...m,
    _id: m.id,
    from: m.senderId,
    to: m.receiverId,
    message: m.content,
  }));

  res.status(200).json({ data: adaptedMessages });
});

/**
 * @desc    Get Unread Messages Count
 * @route   GET /api/social/chat/unread/count
 * @access  Private
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const count = await prisma.message.count({
    where: {
      receiverId: userId,
      isRead: false,
    },
  });

  res.status(200).json({ count });
});
