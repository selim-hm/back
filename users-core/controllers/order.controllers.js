const prisma = require("../../config/prisma");
const asyncHandler = require("express-async-handler");
const xss = require("xss");
const {
  validateOrderDataController,
  validateOrderDatasController,
} = require("../validators/OrderValidator");
const { getIo } = require("../../socket");
const NotificationService = require("../../Notification/notificationService");
const NotificationHelper = require("../util/notificationHelper");
const {
  calculateCommission,
  addCommissionDebt,
  calculateCancellationFee,
  shouldApplyCancellationFee,
  handleCancellationPenalty,
} = require("../util/paymentUtils");
const { withdrawConflicts } = require("../util/tripUtils");

// Helper for distance calculation (Haversine formula)
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

  return R * c; // in metres
}

/**
 * @desc    إنشاء طلب خدمة طبية جديد (مفتوح لمقدمين)
 * @route   POST /api/orders
 * @access  Private (patient)
 */
exports.createOrder = asyncHandler(async (req, res) => {
  try {
    const serviceType = xss(req.body.serviceType);
    const medicalServiceType = xss(req.body.medicalServiceType);
    const urgencyLevel = xss(req.body.urgencyLevel) || "normal";
    const patientId = req.user.id || req.user._id;

    const lat = req.body.meetingPoint?.lat;
    const lng = req.body.meetingPoint?.lng;

    const data = {
      serviceType: serviceType,
      medicalServiceType: medicalServiceType,
      patientId: patientId,
      title: xss(req.body.title),
      description: xss(req.body.description),
      appointmentDate: new Date(req.body.appointmentDate),
      duration: parseInt(req.body.duration),
      urgencyLevel: urgencyLevel,
      meetingLat: lat,
      meetingLng: lng,
      status: serviceType === "self_service" ? "confirmed" : "open",
      price: parseFloat(req.body.price),
    };

    const commission =
      serviceType === "with_provider" ? calculateCommission(data.price) : 0;

    const order = await prisma.serviceOrder.create({
      data: {
        ...data,
        commission,
        paymentStatus: "pending",
        paymentMethod: "cash",
        payoutStatus: "pending",
      },
    });

    if (commission > 0) {
      await addCommissionDebt(patientId, commission);
    }

    console.info("Medical order created successfully", order.id);

    // Notify patient
    await NotificationHelper.createNotification(
      patientId,
      "تم إنشاء طلبك بنجاح",
      `طلب خدمة "${data.title}" تم إنشاؤه بنجاح بانتظار مقدم الخدمة`,
      "order",
      `/patient/orders/${order.id}`
    );

    // Notify nearby providers (doctors/nurses)
    try {
      const providerRole = medicalServiceType === "nursing" ? "nursing" : "doctor";
      await NotificationHelper.createRoleNotification(
        providerRole,
        "طلب خدمة جديد بالقرب منك",
        `يوجد طلب خدمة "${data.title}" بالقرب منك`,
        "order",
        `/doctor/orders`
      );
    } catch (notifErr) {
      console.error("Provider notification failed:", notifErr.message);
    }

    res.status(201).json({
      message: "Medical service request created successfully",
      orderId: order.id,
      _id: order.id,
      commission: commission,
    });
  } catch (err) {
    console.error("Error creating order:", err);
    res
      .status(500)
      .json({ error: "An error occurred while creating the service request" });
  }
});

/**
 * @desc    إظهار مقدمي الخدمة الطبية القريبين
 * @route   GET /api/orders/nearby-providers
 * @access  Private (patient)
 */
exports.getNearbyProviders = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const userLat = req.user.latitude;
    const userLng = req.user.longitude;
    const { medicalServiceType } = req.query;

    if (userLat === undefined || userLng === undefined) {
      return res
        .status(400)
        .json({ error: "User location is missing or invalid" });
    }

    const rolesFilter = medicalServiceType
      ? [medicalServiceType]
      : ["doctor", "nursing"];

    // Fetch potential providers
    const allProviders = await prisma.user.findMany({
      where: {
        role: { in: rolesFilter },
        id: { not: me },
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        description: true,
        role: true,
        latitude: true,
        longitude: true,
        academicDegrees: {
          select: { degree: true, field: true, institution: true },
        },
      },
    });

    // Calculate distance and filter in memory (or use Raw SQL if needed)
    let distanceLimit = 50000; // 50km
    let providersInRange = [];
    const MAX_DISTANCE = 150000; // 150km

    while (distanceLimit <= MAX_DISTANCE && providersInRange.length === 0) {
      providersInRange = allProviders
        .map((p) => ({
          ...p,
          _id: p.id,
          distance: getDistance(userLat, userLng, p.latitude, p.longitude),
        }))
        .filter((p) => p.distance <= distanceLimit)
        .sort((a, b) => a.distance - b.distance);

      if (providersInRange.length === 0) distanceLimit *= 2;
    }

    if (providersInRange.length === 0) {
      return res
        .status(404)
        .json({ message: "No nearby medical providers found", providers: [] });
    }

    // Shuffle for randomness within the range
    providersInRange.sort(() => Math.random() - 0.5);

    res.status(200).json({
      message: `Found ${providersInRange.length} providers within ${(distanceLimit / 1000).toFixed(1)} km`,
      providers: providersInRange,
    });
  } catch (err) {
    console.error("Error fetching nearby providers:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    إنشاء طلب مع تحديد مقدم خدمة معين
 * @route   POST /api/orders/with-provider
 * @access  Private (patient)
 */
exports.createOrderWithProvider = asyncHandler(async (req, res) => {
  try {
    const patientId = req.user.id || req.user._id;
    const {
      serviceType,
      medicalServiceType,
      providerId,
      title,
      description,
      appointmentDate,
      duration,
      urgencyLevel,
      meetingPoint,
      price,
    } = req.body;

    if (!providerId || !meetingPoint) {
      return res
        .status(400)
        .json({ error: "Missing required fields: providerId or meetingPoint" });
    }

    const providerUser = await prisma.user.findUnique({
      where: { id: providerId },
      select: { id: true, role: true, fcmTokens: true },
    });

    if (
      !providerUser ||
      !["doctor", "nursing", "pharmacy", "hospital"].includes(providerUser.role)
    ) {
      return res
        .status(400)
        .json({ error: "Invalid provider: must be a medical professional" });
    }

    const commission = calculateCommission(parseFloat(price));

    const order = await prisma.serviceOrder.create({
      data: {
        serviceType: xss(serviceType) || "with_provider",
        medicalServiceType: xss(medicalServiceType),
        patientId: patientId,
        providerId: providerId,
        title: xss(title),
        description: xss(description),
        appointmentDate: new Date(appointmentDate),
        duration: parseInt(duration),
        urgencyLevel: xss(urgencyLevel) || "normal",
        meetingLat: meetingPoint.lat,
        meetingLng: meetingPoint.lng,
        status: "awaiting_provider_confirmation",
        price: parseFloat(price),
        commission,
        paymentStatus: "pending",
        paymentMethod: "cash",
        payoutStatus: "pending",
      },
    });

    if (commission > 0) {
      await addCommissionDebt(patientId, commission);
    }

    // Notifications
    try {
      if (providerUser.fcmTokens?.length > 0) {
        await NotificationService.sendToMultipleDevices(
          providerUser.fcmTokens,
          "New Medical Service Request!",
          `You have a new ${medicalServiceType} request: ${title}`,
          {
            orderId: order.id,
            type: "new_order",
            medicalServiceType,
          },
        );
      }
    } catch (err) {
      console.error("Notification failed:", err);
    }

    res.status(201).json({
      message: "Service request created successfully",
      orderId: order.id,
      _id: order.id,
    });
  } catch (err) {
    console.error("Error creating order with provider:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    جلب طلبات المريض
 * @route   GET /api/orders
 * @access  Private (patient)
 */
exports.getOrders = asyncHandler(async (req, res) => {
  try {
    const patientId = req.user.id || req.user._id;
    const { status, page = 1, limit = 10, id } = req.query;
    const skip = (page - 1) * limit;

    const where = { patientId };
    if (status) where.status = status;
    if (id) where.id = id;

    const orders = await prisma.serviceOrder.findMany({
      where,
      include: {
        interested: {
          select: { id: true, username: true, avatar: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: Number(limit),
    });

    const total = await prisma.serviceOrder.count({ where });

    const adapterOrders = orders.map((o) => ({
      ...o,
      _id: o.id,
      Interested: o.interested.map((p) => ({ ...p, _id: p.id })),
      meetingPoint: { lat: o.meetingLat, lng: o.meetingLng },
    }));

    res.status(200).json({
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      data: adapterOrders,
    });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    إنشاء طلب سريع لحالات الطوارئ (اختيار تلقائي لمقدم الخدمة القريب)
 * @route   POST /api/orders/quick
 * @access  Private (patient)
 */
exports.createQuickOrder = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const {
      medicalServiceType,
      title,
      description,
      appointmentDate,
      duration,
      location,
      price,
    } = req.body;

    const providersEnRange = await prisma.user.findMany({
      where: {
        role: medicalServiceType,
        id: { not: me },
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        fcmTokens: true,
        username: true,
        latitude: true,
        longitude: true,
      },
    });

    const nearbyProviders = providersEnRange.filter(
      (p) =>
        getDistance(location.lat, location.lng, p.latitude, p.longitude) <=
        50000,
    );

    if (nearbyProviders.length === 0) {
      return res
        .status(404)
        .json({
          error: `No ${medicalServiceType}s found near this location for this emergency`,
        });
    }

    const selectedProvider =
      nearbyProviders[Math.floor(Math.random() * nearbyProviders.length)];

    const order = await prisma.serviceOrder.create({
      data: {
        serviceType: "with_provider",
        medicalServiceType,
        patientId: me,
        providerId: selectedProvider.id,
        title: xss(title),
        description: xss(description),
        appointmentDate: new Date(appointmentDate),
        duration: parseInt(duration),
        urgencyLevel: "emergency",
        meetingLat: location.lat,
        meetingLng: location.lng,
        price: parseFloat(price),
        status: "awaiting_provider_confirmation",
        commission: calculateCommission(parseFloat(price)),
      },
    });

    if (order.commission > 0) {
      await addCommissionDebt(me, order.commission);
    }

    // Socket.io & Notifications
    const io = getIo();
    if (io) {
      io.to(selectedProvider.id).emit("new_quick_order", {
        orderId: order.id,
        title: order.title,
        patientName: req.user.username,
      });
    }

    try {
      if (selectedProvider.fcmTokens?.length) {
        await NotificationService.sendToMultipleDevices(
          selectedProvider.fcmTokens,
          "EMERGENCY: New Quick Request!",
          `You have an emergency ${medicalServiceType} request: ${title}`,
          { orderId: order.id, type: "new_quick_order" },
        );
      }
    } catch (err) {
      console.error(err);
    }

    res
      .status(201)
      .json({
        message: "Emergency quick order created",
        orderId: order.id,
        providerId: selectedProvider.id,
      });
  } catch (err) {
    console.error("Quick order failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    مراجعه المتقدمين
 * @route   get /api/orders/order/:id/review
 * @access  Private (patient)
 */
exports.reviewApplicants = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const { sortBy } = req.query;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: {
        interested: {
          select: {
            id: true,
            username: true,
            avatar: true,
            description: true,
            role: true,
            academicDegrees: true,
            latitude: true,
            longitude: true,
          },
        },
        offers: {
          include: {
            provider: {
              select: {
                id: true,
                username: true,
                avatar: true,
                description: true,
                role: true,
                academicDegrees: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!order)
      return res.status(404).json({ error: "Service request not found" });
    if (order.status !== "open")
      return res
        .status(400)
        .json({ error: "This request is not open for review" });
    if (order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const applicants = [];

    // Combine Interested and Offers
    for (const provider of order.interested) {
      const experience = await prisma.serviceOrder.count({
        where: { providerId: provider.id, status: "completed" },
      });
      applicants.push({
        ...provider,
        _id: provider.id,
        applicantType: "immediate",
        proposedPrice: order.price,
        experience,
        isOffer: false,
      });
    }

    for (const offer of order.offers) {
      if (offer.status !== "pending") continue;
      const experience = await prisma.serviceOrder.count({
        where: { providerId: offer.providerId, status: "completed" },
      });
      applicants.push({
        ...offer.provider,
        _id: offer.provider.id,
        applicantType: "custom_offer",
        proposedPrice: offer.proposedPrice,
        description: offer.description,
        experience,
        isOffer: true,
      });
    }

    // Sort
    if (sortBy === "lowest_price")
      applicants.sort((a, b) => a.proposedPrice - b.proposedPrice);
    else if (sortBy === "most_experienced")
      applicants.sort((a, b) => b.experience - a.experience);
    else applicants.sort(() => Math.random() - 0.5);

    res
      .status(200)
      .json({ message: `Found ${applicants.length} applicants`, applicants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    اختيار مقدم خدمة للطلب
 * @route   POST /api/orders/:id/select-provider
 * @access  Private (patient)
 */
exports.selectProvider = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const { providerId } = req.body;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: {
        interested: { select: { id: true, fcmTokens: true, username: true } },
      },
    });

    if (!order)
      return res.status(404).json({ error: "Service request not found" });
    if (order.status !== "open")
      return res.status(400).json({ error: "Request not open for selection" });
    if (order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const isInterested = order.interested.some((p) => p.id === providerId);
    if (!isInterested)
      return res
        .status(400)
        .json({ error: "This provider has not accepted your request" });

    await prisma.serviceOrder.update({
      where: { id },
      data: { providerId, status: "confirmed" },
    });

    await withdrawConflicts(providerId, order);

    const provider = order.interested.find((p) => p.id === providerId);
    if (provider?.fcmTokens?.length) {
      await NotificationService.sendToMultipleDevices(
        provider.fcmTokens,
        "Selected!",
        `You were selected for: ${order.title}`,
        { orderId: order.id, type: "provider_accepted" },
      );
    }

    res
      .status(200)
      .json({ message: "Provider selected successfully", orderId: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    اختيار عرض من العروض المقدمة
 * @route   POST /api/orders/:id/select-offer
 * @access  Private (patient)
 */
exports.selectOffer = asyncHandler(async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const { id } = req.params;
    const { offerId } = req.body;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: {
        offers: { include: { provider: { select: { fcmTokens: true } } } },
      },
    });

    if (!order)
      return res.status(404).json({ error: "Service request not found" });
    if (order.status !== "open")
      return res.status(400).json({ error: "Request not open for selection" });
    if (order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const offer = order.offers.find((o) => o.id === offerId);
    if (!offer) return res.status(404).json({ error: "Offer not found" });

    await prisma.$transaction([
      prisma.serviceOrder.update({
        where: { id },
        data: {
          providerId: offer.providerId,
          price: offer.proposedPrice,
          status: "confirmed",
          commission: calculateCommission(offer.proposedPrice),
        },
      }),
      prisma.orderOffer.update({
        where: { id: offerId },
        data: { status: "accepted" },
      }),
      prisma.orderOffer.updateMany({
        where: { orderId: id, id: { not: offerId } },
        data: { status: "rejected" },
      }),
    ]);

    await withdrawConflicts(offer.providerId, {
      ...order,
      status: "confirmed",
    });

    if (offer.provider.fcmTokens?.length) {
      await NotificationService.sendToMultipleDevices(
        offer.provider.fcmTokens,
        "Offer Accepted!",
        `Your offer for "${order.title}" was accepted.`,
        { orderId: order.id, type: "offer_accepted" },
      );
    }

    res.status(200).json({ message: "Offer selected successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    تأكيد إتمام الخدمة الطبية من طرف المريض
 * @route   POST /api/orders/:id/confirm-completion
 * @access  Private (patient)
 */
exports.confirmCompletion = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body;
    const me = req.user.id || req.user._id;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.status !== "in_progress")
      return res.status(400).json({ error: "Invalid status" });
    if (order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const completion = order.completion || {};
    completion.patientConfirmed = true;
    completion.patientConfirmedAt = new Date();
    completion.patientFeedback = feedback ? xss(feedback) : "Good service";

    let finalStatus = order.status;
    if (completion.providerConfirmed) {
      finalStatus = "completed";
      completion.completedAt = new Date();
      const commission = calculateCommission(order.price);
      await addCommissionDebt(order.providerId, commission);
      completion.commissionPaid = true;
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        completion,
        status: finalStatus,
        commission: completion.commissionPaid
          ? calculateCommission(order.price)
          : order.commission,
      },
    });

    const io = getIo();
    if (io && order.providerId)
      io.to(order.providerId).emit("patient_confirmed_completion", {
        orderId: order.id,
      });

    res
      .status(200)
      .json({
        message:
          finalStatus === "completed"
            ? "Service completed"
            : "Confirmation sent",
        order: { ...updated, _id: updated.id },
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    تسجيل وصول المريض (إذا كان اللقاء في عيادة/مكان محدد)
 * @route   PATCH /api/orders/:id/mark-arrival
 * @access  Private (patient)
 */
exports.markArrival = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const me = req.user.id || req.user._id;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (!order || order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const completion = order.completion || {};
    completion.patientArrivedAt = new Date();

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { completion },
    });

    const io = getIo();
    if (io && order.providerId)
      io.to(order.providerId).emit("patient_arrived", { orderId: order.id });

    res
      .status(200)
      .json({
        message: "Arrival recorded",
        order: { ...updated, _id: updated.id },
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @desc    إلغاء طلب الخدمة الطبية من طرف المريض
 * @route   PATCH /api/orders/:id/cancel
 * @access  Private (patient)
 */
exports.cancelOrder = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const reason = req.body.reason
      ? xss(req.body.reason)
      : "Patient initiated cancellation";
    const me = req.user.id || req.user._id;

    const order = await prisma.serviceOrder.findUnique({ where: { id } });
    if (
      !order ||
      ["completed", "cancelled", "rejected_by_provider"].includes(order.status)
    )
      return res.status(400).json({ error: "Cannot cancel now" });
    if (order.patientId !== me)
      return res.status(403).json({ error: "Unauthorized" });

    const isLate = shouldApplyCancellationFee(order.appointmentDate);
    const hasProviderArrived = !!order.completion?.providerArrivedAt;

    if (order.providerId && (isLate || hasProviderArrived)) {
      const fee = calculateCancellationFee(order.price);
      await handleCancellationPenalty(me, fee, order.providerId);
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        status: "cancelled",
        cancellation: {
          cancelledBy: "patient",
          cancelledAt: new Date(),
          reason,
        },
      },
    });

    res
      .status(200)
      .json({
        message: "Cancelled successfully",
        order: { ...updated, _id: updated.id },
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
