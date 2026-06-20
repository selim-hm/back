const prisma = require("../config/prisma");

const updateProductRating = async (productId) => {
  try {
    const stats = await prisma.review.aggregate({
      where: { targetId: productId, targetType: "product" },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const avgRating = stats._avg.rating
      ? Number(stats._avg.rating.toFixed(2))
      : 0;
    const totalRatings = stats._count.rating || 0;

    const product = await prisma.product.update({
      where: { id: productId },
      data: { avgRating, totalRatings },
    });

    return product;
  } catch (err) {
    console.error("Error updating product rating:", err.message);
    throw err;
  }
};

module.exports = updateProductRating;
