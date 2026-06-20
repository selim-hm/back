const prisma = require("../../config/prisma");
const asyncHandler = require("express-async-handler");
const { getIo } = require("../../socket");
const NotificationService = require("../../Notification/notificationService");
const {
  calculateCommission,
  addCommissionDebt,
  calculateCancellationFee,
  shouldApplyCancellationFee,
  handleCancellationPenalty,
} = require("../util/paymentUtils");
const { areTripsConflicting, restoreConflicts } = require("../util/tripUtils");
const xss = require("xss");

// Helper for distance calculate
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * @desc    الحصول على الطلبات لمقدمي الخدمة (مرتبة حسب القرب)
 * @route   GET /api/orders/provider
 * @access  خاص (provider roles: doctor, nursing)
 */
exports.getOrdersForProvider = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { medicalServiceType } = req.query;
    const userLat = req.user.latitude;
    const userLng = req.user.longitude;

    if (userLat === undefined || userLng === undefined) {
      return res
        .status(400)
        .json({ message: "User location is not specified" });
    }

    // Get confirmed orders to avoid conflicts
    const confirmedOrders = await prisma.serviceOrder.findMany({
      where: { providerId: me, status: "confirmed" },
      select: { appointmentDate: true, duration: true },
    });

    const excludedDates = confirmedOrders.map(
      (o) => new Date(o.appointmentDate).toISOString().split("T")[0],
    );

    const potentialOrders = await prisma.serviceOrder.findMany({
      where: {
        serviceType: "with_provider",
        status: { in: ["open", "bidding"] },
        medicalServiceType: medicalServiceType || req.user.role,
        meetingLat: { not: null },
        meetingLng: { not: null },
      },
      include: {
        patient: { select: { id: true, username: true, avatar: true } },
      },
    });

    let distanceLimit = 50000;
    const MAX_DISTANCE = 2000000;
    let ordersInRange = [];

    while (distanceLimit <= MAX_DISTANCE && ordersInRange.length === 0) {
      ordersInRange = potentialOrders
        .map((o) => ({
          ...o,
          _id: o.id,
          patient: { ...o.patient, _id: o.patient.id },
          distance: getDistance(userLat, userLng, o.meetingLat, o.meetingLng),
        }))
        .filter((o) => o.distance <= distanceLimit)
        .filter(
          (o) =>
            !excludedDates.includes(
              new Date(o.appointmentDate).toISOString().split("T")[0],
            ),
        )
        .sort((a, b) => a.distance - b.distance);

      if (ordersInRange.length === 0) distanceLimit *= 2;
    }

    res.status(200).json({
      message: `Found ${ordersInRange.length} orders within the range ${distanceLimit / 1000} km`,
      orders: ordersInRange,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    التقديم علي الطلب
 * @route   PATCH /api/orders/:id/accept
 * @access  خاص (Medical Provider)
 */
exports.acceptOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const { proposedPrice, description } = req.body;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: {
        interested: { select: { id: true } },
        offers: { select: { providerId: true } },
      },
    });

    if (!order || !["open", "bidding"].includes(order.status))
      return res.status(404).json({ message: "Order not found" });
    if (!["doctor", "nursing", "pharmacy", "hospital"].includes(req.user.role))
      return res.status(403).json({ error: "Unauthorized" });

    // Conflict check
    const confirmedOrders = await prisma.serviceOrder.findMany({
      where: { providerId: me, status: "confirmed" },
    });
    const hasConflict = confirmedOrders.some((c) =>
      areTripsConflicting(
        c.appointmentDate,
        c.duration,
        order.appointmentDate,
        order.duration,
      ),
    );
    if (hasConflict)
      return res
        .status(400)
        .json({ error: "Conflicting confirmed appointment" });

    if (order.interested.length >= 25)
      return res
        .status(400)
        .json({ message: "Max interested providers reached" });

    const updateData = { interested: { connect: { id: me } } };

    if (proposedPrice) {
      if (order.offers.some((o) => o.providerId === me))
        return res.status(400).json({ message: "Offer already submitted" });
      updateData.offers = {
        create: {
          providerId: me,
          proposedPrice: parseFloat(proposedPrice),
          description,
        },
      };
    } else if (order.interested.some((p) => p.id === me)) {
      return res.status(400).json({ message: "Already expressed interest" });
    }

    await prisma.serviceOrder.update({ where: { id }, data: updateData });

    // Notifications
    const io = getIo();
    if (io)
      io.to(order.patientId).emit("new_interest", {
        orderId: order.id,
        providerName: req.user.username,
      });

    try {
      const patient = await prisma.user.findUnique({
        where: { id: order.patientId },
        select: { fcmTokens: true },
      });
      if (patient?.fcmTokens?.length) {
        await NotificationService.sendToMultipleDevices(
          patient.fcmTokens,
          "New Interest!",
          `${req.user.username} is interested in: ${order.title}`,
          { orderId: order.id, type: "provider_interested" },
        );
      }
    } catch (err) {
      console.error(err);
    }

    res.status(200).json({ message: "Interest submitted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    موافقة الطلب من قبل مقدم الخدمة (إذا تم تعيينه له)
 * @route   PATCH /api/orders/:id/confirm
 * @access  خاص (Medical Provider)
 */
exports.confirmOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.status !== "awaiting_provider_confirmation")
      return res.status(404).json({ message: "Invalid order status" });
    if (order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { status: "confirmed" },
    });

    const io = getIo();
    if (io)
      io.to(order.patientId).emit("order_confirmed", { orderId: order.id });

    try {
      const patient = await prisma.user.findUnique({
        where: { id: order.patientId },
        select: { fcmTokens: true, email: true, username: true },
      });
      if (patient?.fcmTokens?.length)
        await NotificationService.sendToMultipleDevices(
          patient.fcmTokens,
          "Request Confirmed!",
          `Your request "${order.title}" was confirmed.`,
          { orderId: order.id, type: "order_confirmed" },
        );
    } catch (err) {
      console.error(err);
    }

    res
      .status(200)
      .json({
        message: "Order confirmed successfully",
        order: { ...updated, _id: updated.id },
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    بدء تقديم الخدمة الطبية
 * @route   PATCH /api/orders/:id/start
 * @access  خاص (Medical Provider)
 */
exports.startService = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.status !== "confirmed")
      return res
        .status(404)
        .json({ message: "Order not found or not confirmed" });
    if (order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { status: "in_progress" },
    });

    const io = getIo();
    if (io)
      io.to(order.patientId).emit("service_started", { orderId: order.id });

    res
      .status(200)
      .json({
        message: "Service started",
        order: { ...updated, _id: updated.id },
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    تسجيل وصول مقدم الخدمة للمريض
 * @route   PATCH /api/orders/:id/mark-arrival
 * @access  Private (Medical Provider)
 */
exports.markArrival = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    const completion = order.completion || {};
    completion.providerArrivedAt = new Date();

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { completion },
    });

    const io = getIo();
    if (io)
      io.to(order.patientId).emit("provider_arrived", { orderId: order.id });

    res
      .status(200)
      .json({
        message: "Arrival recorded",
        order: { ...updated, _id: updated.id },
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    تأكيد إتمام الخدمة الطبية من طرف مقدم الخدمة
 * @route   POST /api/orders/:id/complete
 * @access  خاص (Medical Provider)
 */
exports.completeOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const { feedback } = req.body;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.status !== "in_progress")
      return res.status(400).json({ message: "Invalid status" });
    if (order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    const completion = order.completion || {};
    completion.providerConfirmed = true;
    completion.providerConfirmedAt = new Date();
    completion.providerFeedback = feedback
      ? xss(feedback)
      : "Service delivered";

    let finalStatus = "in_progress";
    if (completion.patientConfirmed) {
      finalStatus = "completed";
      completion.completedAt = new Date();
      await addCommissionDebt(me, calculateCommission(order.price));
      completion.commissionPaid = true;
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { status: finalStatus, completion },
    });

    const io = getIo();
    if (io)
      io.to(order.patientId).emit("provider_confirmed_completion", {
        orderId: order.id,
      });

    res
      .status(200)
      .json({
        message: finalStatus === "completed" ? "Completed" : "Sent",
        order: { ...updated, _id: updated.id },
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    إلغاء الطلب من قبل مقدم الخدمة مع تطبيق الغرامة إذا تأخر
 * @route   PATCH /api/orders/:id/cancel
 * @access  خاص (Medical Provider)
 */
exports.cancelOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const reason = req.body.reason
      ? xss(req.body.reason)
      : "Provider initiated cancellation";

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (
      !order ||
      ["completed", "cancelled", "rejected_by_provider"].includes(order.status)
    )
      return res.status(400).json({ message: "Cannot cancel" });
    if (order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    const isLate = shouldApplyCancellationFee(order.appointmentDate);
    const hasPatientArrived = !!order.completion?.patientArrivedAt;

    let feeApplied = false;
    let feeAmount = 0;
    if (order.status === "confirmed" && (isLate || hasPatientArrived)) {
      feeAmount = calculateCancellationFee(order.price);
      await handleCancellationPenalty(me, feeAmount, order.patientId);
      feeApplied = true;
    }

    await prisma.serviceOrder.update({
      where: { id },
      data: {
        status: "cancelled",
        cancellation: {
          cancelledBy: "provider",
          cancelledAt: new Date(),
          reason,
        },
      },
    });

    await restoreConflicts(me);

    res
      .status(200)
      .json({ message: "Cancelled successfully", feeApplied, feeAmount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * @desc    رفض الطلب من قبل مقدم الخدمة
 * @route   POST /api/orders/rejectOrder
 * @access  خاص (Medical Provider)
 */
exports.rejectOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const id = req.params.id || req.body.orderId || req.body.id;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.status !== "awaiting_provider_confirmation")
      return res.status(404).json({ message: "Invalid status" });
    if (order.providerId !== me)
      return res.status(403).json({ message: "Unauthorized" });

    await prisma.serviceOrder.update({
      where: { id },
      data: { status: "rejected_by_provider" },
    });

    res.status(200).json({ message: "Rejected successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
