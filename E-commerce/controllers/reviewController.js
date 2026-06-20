const asyncHandler = require('express-async-handler');
const prisma = require('../../config/prisma');

// Helper: recalculate product rating
async function updateProductRating(productId) {
  const reviews = await prisma.review.findMany({
    where: { targetId: productId, targetType: 'product' }
  });
  const total = reviews.reduce((acc, r) => acc + r.rating, 0);
  const avg = reviews.length > 0 ? total / reviews.length : 0;

  await prisma.product.update({
    where: { id: productId },
    data: { avgRating: avg, totalRatings: reviews.length }
  });
}

exports.addComment = asyncHandler(async (req, res) => {
  try {
    const { productId, comment, rating } = req.body;
    const userId = req.user.id || req.user._id;

    const existingReview = await prisma.review.findFirst({
      where: { userId, targetId: productId, targetType: 'product' }
    });
    if (existingReview) {
      return res.status(400).json({ message: 'You already sent a review for this product' });
    }

    const newReview = await prisma.review.create({
      data: { userId, targetId: productId, targetType: 'product', rating, comment }
    });

    await updateProductRating(productId);

    res.status(200).json({ message: 'Comment added', review: { ...newReview, _id: newReview.id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

exports.updateComment = asyncHandler(async (req, res) => {
  try {
    const { comment } = req.body;
    const userId = req.user.id || req.user._id;
    const reviewId = req.params.id;

    const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
    if (!review) {
      return res.status(404).json({ message: 'Review not found or unauthorized' });
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: { comment }
    });

    await updateProductRating(review.targetId);

    res.status(200).json({ message: 'Comment updated', review: { ...updated, _id: updated.id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

exports.deleteComment = asyncHandler(async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user.id || req.user._id;

    const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
    if (!review) return res.status(404).json({ message: 'Review not found' });

    await prisma.review.delete({ where: { id: reviewId } });
    await updateProductRating(review.targetId);

    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
