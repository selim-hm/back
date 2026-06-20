const prisma = require("../../config/prisma");
const { getRtcConfig } = require("../../config/rtc");
const {
  validateSendMessage,
  formatValidationErrors,
} = require("../validators/ChatValidator");

async function getActiveOrder(userId1, userId2) {
  return await prisma.serviceOrder.findFirst({
    where: {
      OR: [
        { patientId: userId1, providerId: userId2 },
        { patientId: userId2, providerId: userId1 },
      ],
      status: { in: ["confirmed", "Gathering_time", "in_progress", "started"] },
    },
  });
}

/**
 * @desc    Send a chat message
 * @route   POST /api/chat/send
 * @access  Private
 */
exports.sendMessage = async (req, res) => {
  try {
    const from = req.user.id || req.user._id;
    const { error, value } = validateSendMessage(req.body);

    if (error) {
      return res.status(400).json({
        error: "Validation failed",
        details: formatValidationErrors(error),
        code: "VALIDATION_ERROR",
      });
    }

    const { to, message, orderId } = value;

    const order = await getActiveOrder(from, to);
    if (!order) {
      return res.status(403).json({
        error: "No active order between the two parties",
        code: "NO_ACTIVE_ORDER",
      });
    }

    if (order.id !== orderId) {
      return res.status(403).json({
        error: "Order ID does not match active order",
        code: "ORDER_MISMATCH",
      });
    }

    const chatMsg = await prisma.medicalMessage.create({
      data: {
        fromId: from,
        toId: to,
        message,
        orderId: order.id,
        messageType: "text",
        idempotencyKey: req.headers["x-idempotency-key"],
      },
      include: {
        from: { select: { username: true, avatar: true } },
      },
    });

    const io = req.app.get("io");
    if (io) {
      io.to(to.toString()).emit("newMessage", {
        _id: chatMsg.id,
        id: chatMsg.id,
        from: { ...chatMsg.from, _id: chatMsg.fromId },
        message: chatMsg.message,
        orderId: chatMsg.orderId,
        timestamp: chatMsg.createdAt,
        messageType: "text",
      });
    }

    res.json({
      success: true,
      message: { ...chatMsg, _id: chatMsg.id },
      timestamp: chatMsg.createdAt,
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    res.status(500).json({
      error: "Failed to send message",
      code: "SEND_MESSAGE_ERROR",
    });
  }
};

/**
 * @desc    Get messages between two users
 * @route   GET /api/chat/messages/:userId
 * @access  Private
 */
exports.getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const me = req.user.id || req.user._id;

    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        error: "Invalid pagination parameters",
        code: "INVALID_PAGINATION",
      });
    }

    const order = await getActiveOrder(me, userId);
    if (!order) {
      return res.status(403).json({
        error: "No active order between the two parties",
        code: "NO_ACTIVE_ORDER",
      });
    }

    const skip = (page - 1) * limit;

    const messages = await prisma.medicalMessage.findMany({
      where: {
        orderId: order.id,
        OR: [
          { fromId: me, toId: userId },
          { fromId: userId, toId: me },
        ],
      },
      include: {
        from: { select: { username: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });

    const total = await prisma.medicalMessage.count({
      where: {
        orderId: order.id,
        OR: [
          { fromId: me, toId: userId },
          { fromId: userId, toId: me },
        ],
      },
    });

    await prisma.medicalMessage.updateMany({
      where: {
        orderId: order.id,
        toId: me,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({
      success: true,
      messages: messages
        .map((m) => ({ ...m, _id: m.id, from: { ...m.from, _id: m.fromId } }))
        .reverse(),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve messages:", error);
    res.status(500).json({
      error: "Failed to retrieve messages",
      code: "GET_MESSAGES_ERROR",
    });
  }
};

/**
 * @desc    Get user conversations list
 * @route   GET /api/chat/conversations
 * @access  Private
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const messages = await prisma.medicalMessage.findMany({
      where: {
        OR: [{ fromId: userId }, { toId: userId }],
      },
      include: {
        from: {
          select: { id: true, username: true, avatar: true, role: true },
        },
        to: { select: { id: true, username: true, avatar: true, role: true } },
        order: { select: { id: true, medicalServiceType: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const conversationsMap = new Map();

    messages.forEach((msg) => {
      const isSender = msg.fromId === userId;
      const partner = isSender ? msg.to : msg.from;
      if (!partner) return;

      const partnerId = partner.id;

      if (!conversationsMap.has(partnerId)) {
        conversationsMap.set(partnerId, {
          partner: { ...partner, _id: partner.id },
          lastMessage: msg.message,
          lastMessageAt: msg.createdAt,
          unreadCount: !isSender && !msg.isRead ? 1 : 0,
          order: msg.order ? { ...msg.order, _id: msg.order.id } : null,
          lastChatId: msg.id,
        });
      } else {
        const existing = conversationsMap.get(partnerId);
        if (!isSender && !msg.isRead) {
          existing.unreadCount += 1;
        }
      }
    });

    res.json({
      success: true,
      conversations: Array.from(conversationsMap.values()),
    });
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    res.status(500).json({
      error: "Failed to fetch conversations",
      code: "GET_CONVERSATIONS_ERROR",
    });
  }
};

/**
 * @desc    Get RTC configuration
 * @route   GET /api/chat/rtc/config
 * @access  Private
 */
exports.getRTCConfig = async (req, res) => {
  try {
    const config = getRtcConfig();
    res.json({
      success: true,
      config,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get RTC configuration",
      code: "RTC_CONFIG_ERROR",
    });
  }
};

/**
 * @desc    Start a call
 * @route   POST /api/chat/call/start
 * @access  Private
 */
exports.startCall = async (req, res) => {
  try {
    const { to, peerId } = req.body;
    const from = req.user.id || req.user._id;

    if (!to) {
      return res.status(400).json({
        error: "Recipient ID is required",
        code: "MISSING_RECIPIENT",
      });
    }

    const order = await getActiveOrder(from, to);
    if (!order) {
      return res.status(403).json({
        error: "No active order between the two parties",
        code: "NO_ACTIVE_ORDER",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(to.toString()).emit("incomingCall", {
        from,
        fromName: req.user.username,
        orderId: order.id,
        peerId,
        rtcConfig: getRtcConfig(),
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Call request sent successfully",
      rtcConfig: getRtcConfig(),
      callId: order.id,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to start call",
      code: "START_CALL_ERROR",
    });
  }
};

/**
 * @desc    Accept a call
 * @route   POST /api/chat/call/accept
 * @access  Private
 */
exports.acceptCall = async (req, res) => {
  try {
    const { from, offer, peerId } = req.body;
    const to = req.user.id || req.user._id;

    if (!from || !offer) {
      return res.status(400).json({
        error: "Missing required fields (from, offer)",
        code: "MISSING_FIELDS",
      });
    }

    const order = await getActiveOrder(from, to);
    if (!order) {
      return res.status(403).json({
        error: "No active order between the two parties",
        code: "NO_ACTIVE_ORDER",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(from.toString()).emit("callAccepted", {
        to,
        toName: req.user.username,
        peerId,
        orderId: order.id,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Call accepted successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to accept call",
      code: "ACCEPT_CALL_ERROR",
    });
  }
};

/**
 * @desc    Reject a call
 * @route   POST /api/chat/call/reject
 * @access  Private
 */
exports.rejectCall = async (req, res) => {
  try {
    const { from, reason } = req.body;
    const to = req.user.id || req.user._id;

    if (!from) {
      return res.status(400).json({
        error: "Caller ID is required",
        code: "MISSING_CALLER",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(from.toString()).emit("callRejected", {
        to,
        reason: reason || "User rejected the call",
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Call rejected successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to reject call",
      code: "REJECT_CALL_ERROR",
    });
  }
};

/**
 * @desc    End a call
 * @route   POST /api/chat/call/end
 * @access  Private
 */
exports.endCall = async (req, res) => {
  try {
    const { to } = req.body;
    const from = req.user.id || req.user._id;

    if (!to) {
      return res.status(400).json({
        error: "Recipient ID is required",
        code: "MISSING_RECIPIENT",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(to.toString()).emit("callEnded", {
        from,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Call ended successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to end call",
      code: "END_CALL_ERROR",
    });
  }
};
