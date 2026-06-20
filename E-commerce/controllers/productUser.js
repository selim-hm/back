const asyncHandler = require('express-async-handler');
const xss = require('xss');
const prisma = require('../../config/prisma');


/**
 * @desc   (search) get all products
 * @route   GET /api/products
 * @access  عام
 */
exports.getAllProducts = asyncHandler(async (req, res) => {
  const { search, price, category, lat, lng, page = 1, limit = 10 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const pageSize = parseInt(limit);

  // Prisma Where Clause builder
  const whereClause = {
    stockQuantity: { gt: 0 }
  };

  // Restrict to User's Country
  if (req.user && req.user.country) {
    whereClause.merchant = { country: req.user.country };
  }

  // Fuzzy Search (Regex based adaptation)
  if (search) {
    const safeSearch = xss(search);
    whereClause.OR = [
      { name: { contains: safeSearch, mode: 'insensitive' } },
      { description: { contains: safeSearch, mode: 'insensitive' } }
    ];
  }

  if (category) {
    whereClause.categoryId = String(category);
  }

  if (price) {
    const maxPrice = parseFloat(price);
    if (!isNaN(maxPrice)) {
      whereClause.price = { gte: 0, lte: maxPrice };
    }
  }

  // If distance calculation is needed, compute in JS since Prisma doesn't natively support Haversine formulas without painful raw SQL mapping logic.  
  let products = await prisma.product.findMany({
    where: whereClause,
    include: {
      merchant: { select: { id: true, country: true, latitude: true, longitude: true, username: true, avatar: true } },
      category: true
    },
    orderBy: { createdAt: 'desc' }
  });

  const totalRawCount = products.length;

  if (lat && lng) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // Haversine formula calculation in JS
    const degreesToRadians = deg => (deg * Math.PI) / 180.0;
    
    products = products.map(product => {
      let distance = 0;
      const mLat = product.merchant?.latitude;
      const mLng = product.merchant?.longitude;
      
      if (mLat != null && mLng != null) {
        const earthRadiusKm = 6371;
        const dLat = degreesToRadians(mLat - userLat);
        const dLon = degreesToRadians(mLng - userLng);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(degreesToRadians(userLat)) * Math.cos(degreesToRadians(mLat)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
                  
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distance = earthRadiusKm * c;
      } else {
        distance = 999999; // Deprioritize items with no location
      }

      return { ...product, distance };
    });

    products.sort((a, b) => a.distance - b.distance);
  }

  // Handle Pagination
  const paginatedProducts = products.slice(skip, skip + pageSize);

  // Format adapter for frontend
  const adaptedProducts = paginatedProducts.map(p => ({
    ...p,
    _id: p.id,
    authorDetails: p.merchant ? { ...p.merchant, _id: p.merchant.id } : null,
  }));

  res.status(200).json({
    products: adaptedProducts,
    pagination: {
      total: totalRawCount,
      page: parseInt(page),
      limit: pageSize,
      pages: Math.ceil(totalRawCount / pageSize)
    }
  });
});

/**
 * @desc    get one product by id
 * @route   GET /api/products/:id
 * @access  عام
 */
exports.getProductById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      merchant: { select: { id: true, username: true, avatar: true } },
      category: true
    }
  });
  
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  product._id = product.id;
  res.status(200).json(product);
});

/**
 * @desc   get all reviews for a product by id
 * @route   GET /api/products/:id/reviews
 * @access  عام
 */
exports.getReviews = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  
  const reviews = await prisma.review.findMany({
    where: { productId },
    include: { user: { select: { id: true, username: true, email: true, avatar: true, role: true } } }
  });

  if (!reviews.length) {
    return res.status(404).json({ message: 'No reviews found for this product' });
  }

  const adaptedReviews = reviews.map(r => ({
    ...r,
    _id: r.id,
    user: { ...r.user, _id: r.user.id }
  }));

  res.status(200).json(adaptedReviews);
});