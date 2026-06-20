const prisma = require("../../config/prisma");
const asyncHandler = require("express-async-handler");

/**
 * Provider Profile Controller
 * Handles profile, schedule, appointments, patients, dashboard, and chat for providers (doctor, nursing)
 */

// ─── Provider Profile ────────────────────────────────────────────────

exports.getProviderProfile = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        academicDegrees: true,
        wallet: true,
        kyc: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Provider not found" });
    }

    const { password, resetPasswordCode, verificationCode, fcmTokens, ...profile } = user;

    // Adapt for frontend
    profile._id = profile.id;
    profile.documentation = user.kyc?.documentation || false;
    profile.balance = user.wallet?.balance || 0;
    profile.RemainingAccount = user.wallet?.remainingAccount || 0;
    profile.commissionDebt = user.wallet?.commissionDebt || 0;

    res.status(200).json({ doctor: profile });
  } catch (error) {
    console.error("getProviderProfile error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

exports.updateProviderProfile = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { phone, description, gender, specialization, coverPhoto, avatar } = req.body;

    const updateData = {};
    if (phone !== undefined) updateData.phone = phone;
    if (description !== undefined) updateData.description = description;
    if (gender !== undefined) updateData.gender = gender;
    if (coverPhoto !== undefined) updateData.coverPhoto = coverPhoto;
    if (avatar !== undefined) updateData.avatar = avatar;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { kyc: true, wallet: true, academicDegrees: true },
    });

    updatedUser._id = updatedUser.id;
    updatedUser.documentation = updatedUser.kyc?.documentation || false;

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("updateProviderProfile error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ message: "Phone number already exists" });
    }
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Schedule ───────────────────────────────────────────────

exports.getProviderSchedule = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // Get confirmed and in-progress orders as schedule items
    const orders = await prisma.serviceOrder.findMany({
      where: {
        providerId: userId,
        status: { in: ["confirmed", "in_progress", "awaiting_provider_confirmation"] },
      },
      include: {
        patient: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { appointmentDate: "asc" },
      take: 50,
    });

    const schedule = orders.map((o) => ({
      _id: o.id,
      orderId: o.id,
      title: o.title,
      patientName: o.patient?.username || "Unknown",
      patientAvatar: o.patient?.avatar,
      appointmentDate: o.appointmentDate,
      duration: o.duration,
      status: o.status,
      meetingPoint: { lat: o.meetingLat, lng: o.meetingLng },
    }));

    res.status(200).json(schedule);
  } catch (error) {
    console.error("getProviderSchedule error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

exports.updateProviderSchedule = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { orderId, appointmentDate, duration, status } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    // Verify the order belongs to this provider
    const order = await prisma.serviceOrder.findFirst({
      where: { id: orderId, providerId: userId },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found or not assigned to you" });
    }

    const updateData = {};
    if (appointmentDate) updateData.appointmentDate = new Date(appointmentDate);
    if (duration) updateData.duration = parseInt(duration);
    if (status) updateData.status = status;

    const updated = await prisma.serviceOrder.update({
      where: { id: orderId },
      data: updateData,
    });

    res.status(200).json({ message: "Schedule updated", order: { ...updated, _id: updated.id } });
  } catch (error) {
    console.error("updateProviderSchedule error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Appointments ───────────────────────────────────────────

exports.getProviderAppointments = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { providerId: userId };
    if (status) where.status = status;

    const [appointments, total] = await Promise.all([
      prisma.serviceOrder.findMany({
        where,
        include: {
          patient: { select: { id: true, username: true, avatar: true, phone: true } },
        },
        skip,
        take: Number(limit),
        orderBy: { appointmentDate: "desc" },
      }),
      prisma.serviceOrder.count({ where }),
    ]);

    const adapted = appointments.map((a) => ({
      ...a,
      _id: a.id,
      patient: { ...a.patient, _id: a.patient.id },
      meetingPoint: { lat: a.meetingLat, lng: a.meetingLng },
    }));

    res.status(200).json({
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      appointments: adapted,
    });
  } catch (error) {
    console.error("getProviderAppointments error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Patients ───────────────────────────────────────────────

exports.getProviderPatients = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Get unique patients from completed/in-progress orders
    const orders = await prisma.serviceOrder.findMany({
      where: {
        providerId: userId,
        status: { in: ["completed", "in_progress", "confirmed"] },
      },
      include: {
        patient: {
          select: { id: true, username: true, avatar: true, phone: true, email: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Deduplicate by patient ID
    const seen = new Set();
    const patients = [];
    for (const order of orders) {
      if (order.patient && !seen.has(order.patient.id)) {
        seen.add(order.patient.id);
        patients.push({
          ...order.patient,
          _id: order.patient.id,
          lastVisit: order.updatedAt,
          orderId: order.id,
        });
      }
    }

    const total = patients.length;
    const paginated = patients.slice(skip, skip + Number(limit));

    res.status(200).json({
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      patients: paginated,
    });
  } catch (error) {
    console.error("getProviderPatients error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Dashboard ──────────────────────────────────────────────

exports.getProviderDashboard = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const [
      totalOrders,
      completedOrders,
      inProgressOrders,
      confirmedOrders,
      totalEarnings,
      wallet,
      recentOrders,
      reviews,
    ] = await Promise.all([
      prisma.serviceOrder.count({ where: { providerId: userId } }),
      prisma.serviceOrder.count({ where: { providerId: userId, status: "completed" } }),
      prisma.serviceOrder.count({ where: { providerId: userId, status: "in_progress" } }),
      prisma.serviceOrder.count({ where: { providerId: userId, status: "confirmed" } }),
      prisma.serviceOrder.aggregate({
        where: { providerId: userId, status: "completed" },
        _sum: { price: true },
      }),
      prisma.userWallet.findUnique({ where: { userId } }),
      prisma.serviceOrder.findMany({
        where: { providerId: userId },
        include: {
          patient: { select: { id: true, username: true, avatar: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.review.findMany({
        where: { targetId: userId, targetType: "user" },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const adaptedRecentOrders = recentOrders.map((o) => ({
      ...o,
      _id: o.id,
      patient: o.patient ? { ...o.patient, _id: o.patient.id } : null,
    }));

    const adaptedReviews = reviews.map((r) => ({
      ...r,
      _id: r.id,
      reviewer: r.user ? { ...r.user, _id: r.user.id } : null,
    }));

    res.status(200).json({
      stats: {
        totalOrders,
        completedOrders,
        inProgressOrders,
        confirmedOrders,
        totalEarnings: totalEarnings._sum?.price || 0,
        balance: wallet?.remainingAccount || 0,
        commissionDebt: wallet?.commissionDebt || 0,
      },
      recentOrders: adaptedRecentOrders,
      recentReviews: adaptedReviews,
    });
  } catch (error) {
    console.error("getProviderDashboard error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Reviews ────────────────────────────────────────────────

exports.getProviderReviews = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Reviews where this provider is the target (targetType: "user")
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { targetId: userId, targetType: "user" },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.review.count({ where: { targetId: userId, targetType: "user" } }),
    ]);

    const adapted = reviews.map((r) => ({
      ...r,
      _id: r.id,
      reviewer: r.user ? { ...r.user, _id: r.user.id } : null,
    }));

    const avgResult = await prisma.review.aggregate({
      where: { targetId: userId, targetType: "user" },
      _avg: { rating: true },
    });

    res.status(200).json({
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      averageRating: avgResult._avg?.rating || 0,
      reviews: adapted,
    });
  } catch (error) {
    console.error("getProviderReviews error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Chat ───────────────────────────────────────────────────

exports.getProviderChatMessages = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { orderId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // If orderId provided, get messages for that order
    // Otherwise get all medical messages for this provider
    const where = orderId
      ? { orderId, OR: [{ senderId: userId }, { receiverId: userId }] }
      : { OR: [{ senderId: userId }, { receiverId: userId }] };

    const messages = await prisma.medicalMessage.findMany({
      where,
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        receiver: { select: { id: true, username: true, avatar: true } },
      },
      skip,
      take: Number(limit),
      orderBy: { createdAt: "asc" },
    });

    const adapted = messages.map((m) => ({
      ...m,
      _id: m.id,
      sender: m.sender ? { ...m.sender, _id: m.sender.id } : null,
      receiver: m.receiver ? { ...m.receiver, _id: m.receiver.id } : null,
    }));

    res.status(200).json(adapted);
  } catch (error) {
    console.error("getProviderChatMessages error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

exports.sendProviderChatMessage = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { receiverId, orderId, content, messageType = "text" } = req.body;

    if (!receiverId || !content) {
      return res.status(400).json({ message: "receiverId and content are required" });
    }

    const message = await prisma.medicalMessage.create({
      data: {
        senderId: userId,
        receiverId,
        orderId: orderId || null,
        content,
        messageType,
      },
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        receiver: { select: { id: true, username: true, avatar: true } },
      },
    });

    const adapted = {
      ...message,
      _id: message.id,
      sender: message.sender ? { ...message.sender, _id: message.sender.id } : null,
      receiver: message.receiver ? { ...message.receiver, _id: message.receiver.id } : null,
    };

    res.status(201).json(adapted);
  } catch (error) {
    console.error("sendProviderChatMessage error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// ─── Provider Chat Contacts ──────────────────────────────────────────

exports.getProviderChatContacts = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // Get unique users who have exchanged messages with this provider
    const sentMessages = await prisma.medicalMessage.findMany({
      where: { senderId: userId },
      select: { receiverId: true },
      distinct: ["receiverId"],
    });

    const receivedMessages = await prisma.medicalMessage.findMany({
      where: { receiverId: userId },
      select: { senderId: true },
      distinct: ["senderId"],
    });

    const contactIds = new Set();
    sentMessages.forEach((m) => contactIds.add(m.receiverId));
    receivedMessages.forEach((m) => contactIds.add(m.senderId));

    if (contactIds.size === 0) {
      return res.status(200).json([]);
    }

    const contacts = await prisma.user.findMany({
      where: { id: { in: Array.from(contactIds) } },
      select: { id: true, username: true, avatar: true, role: true },
    });

    // Get last message for each contact
    const contactsWithLastMessage = await Promise.all(
      contacts.map(async (contact) => {
        const lastMessage = await prisma.medicalMessage.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: contact.id },
              { senderId: contact.id, receiverId: userId },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        });

        return {
          ...contact,
          _id: contact.id,
          lastMessage: lastMessage?.content || "",
          lastMessageTime: lastMessage?.createdAt || null,
        };
      })
    );

    contactsWithLastMessage.sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    res.status(200).json(contactsWithLastMessage);
  } catch (error) {
    console.error("getProviderChatContacts error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

exports.getProviderChatContactsCount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const sentMessages = await prisma.medicalMessage.findMany({
      where: { senderId: userId },
      select: { receiverId: true },
      distinct: ["receiverId"],
    });

    const receivedMessages = await prisma.medicalMessage.findMany({
      where: { receiverId: userId },
      select: { senderId: true },
      distinct: ["senderId"],
    });

    const contactIds = new Set();
    sentMessages.forEach((m) => contactIds.add(m.receiverId));
    receivedMessages.forEach((m) => contactIds.add(m.senderId));

    res.status(200).json({ count: contactIds.size });
  } catch (error) {
    console.error("getProviderChatContactsCount error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

exports.searchProviderChatContacts = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const sentMessages = await prisma.medicalMessage.findMany({
      where: { senderId: userId },
      select: { receiverId: true },
      distinct: ["receiverId"],
    });

    const receivedMessages = await prisma.medicalMessage.findMany({
      where: { receiverId: userId },
      select: { senderId: true },
      distinct: ["senderId"],
    });

    const contactIds = new Set();
    sentMessages.forEach((m) => contactIds.add(m.receiverId));
    receivedMessages.forEach((m) => contactIds.add(m.senderId));

    if (contactIds.size === 0) {
      return res.status(200).json([]);
    }

    const contacts = await prisma.user.findMany({
      where: {
        id: { in: Array.from(contactIds) },
        username: { contains: query, mode: "insensitive" },
      },
      select: { id: true, username: true, avatar: true, role: true },
    });

    const adapted = contacts.map((c) => ({ ...c, _id: c.id }));
    res.status(200).json(adapted);
  } catch (error) {
    console.error("searchProviderChatContacts error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});
