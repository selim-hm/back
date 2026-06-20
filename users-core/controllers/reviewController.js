const updateProductRating = require("../../middlewares/updateProductRating");
const prisma = require("../../config/prisma");

exports.addComment = async (req, res) => {
  try {
    const { productId, comment, rating } = req.body;
    const userId = req.user.id || req.user._id;

    // productId represents targetId here for both Users and Products, logic implies product since we call updateProductRating
    const existingReview = await prisma.review.findFirst({
      where: {
        userId: userId,
        targetId: productId,
        targetType: "product",
      },
    });

    if (existingReview) {
      return res
        .status(400)
        .json({ message: "You already sent a review for this product" });
    }

    const newReview = await prisma.review.create({
      data: {
        userId: userId,
        targetId: productId,
        targetType: "product", // Extrapolated from the requirement
        rating: Number(rating),
        comment: comment,
      },
    });

    await updateProductRating(productId);

    res.status(200).json({ message: "Comment added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateComment = async (req, res) => {
  try {
    const { comment } = req.body;
    const userId = req.user.id || req.user._id;
    const reviewId = req.params.id;

    const existingReview = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!existingReview || existingReview.userId !== userId) {
      return res
        .status(404)
        .json({ message: "Review not found or unauthorized" });
    }

    const review = await prisma.review.update({
      where: { id: reviewId },
      data: { comment },
    });

    await updateProductRating(review.targetId);

    res.status(200).json({ message: "Comment updated", review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user.id || req.user._id;

    const existingReview = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!existingReview || existingReview.userId !== userId) {
      return res.status(404).json({ message: "Review not found" });
    }

    const review = await prisma.review.delete({
      where: { id: reviewId },
    });

    await updateProductRating(review.targetId);

    res.status(200).json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDoctorReviews = async (req, res) => {
  try {
    const doctorId = req.user.id || req.user._id;

    // 1. Find all orders where this doctor is the provider
    const orders = await prisma.serviceOrder.findMany({
      where: { providerId: doctorId },
      select: { id: true },
    });

    const orderIds = orders.map((o) => o.id);

    // 2. Find all reviews for these orders
    // Note: reviewController mapped review.product basically to the Order ID for doctors previously!
    const reviews = await prisma.review.findMany({
      where: {
        targetId: { in: orderIds },
        targetType: "product", // Legacy Mongoose implied product field, which maps to targetId
      },
      include: {
        user: { select: { username: true, avatar: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Prisma won't natively populate exactly like Mongoose if it's dynamic reference (i.e. 'targetId' pointing to either product or order).
    // For Doctor Reviews where targetId is an Order, let's manually fetch the order data
    const enrichedReviews = await Promise.all(
      reviews.map(async (review) => {
        const orderData = await prisma.serviceOrder.findUnique({
          where: { id: review.targetId },
          select: {
            medicalServiceType: true,
            title: true,
            appointmentDate: true,
          },
        });
        return { ...review, product: orderData }; // Attached to product key for backward-compatibility
      }),
    );

    // 3. Calculate metrics
    const totalReviews = enrichedReviews.length;
    const averageRating =
      totalReviews > 0
        ? (
            enrichedReviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews
          ).toFixed(1)
        : 0;

    res.status(200).json({
      success: true,
      reviews: enrichedReviews,
      stats: {
        totalReviews,
        averageRating: Number(averageRating),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
