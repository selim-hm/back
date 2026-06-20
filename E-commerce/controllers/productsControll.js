const asyncHandler = require('express-async-handler');
const xss = require('xss');
const Joi = require('joi');
const cloudinary = require('../../config/cloudinary');
const prisma = require('../../config/prisma');

// Middleware to check pharmacy/merchant role
const merchant = (req, res, next) => {
  if (req.user.role !== 'pharmacy') {
    return res.status(403).json({ message: 'Access denied. Only pharmacies can add products.' });
  }
  next();
};

// Validation schemas
const addProductSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  price: Joi.number().required(),
  category: Joi.string().required(),
  stockQuantity: Joi.number().required(),
  Address: Joi.string().required(),
});

const updateProductSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  price: Joi.number().required(),
  category: Joi.string().required(),
  stockQuantity: Joi.number().required(),
});

// Add Product
exports.addProduct = [
  merchant,
  asyncHandler(async (req, res) => {
    // Sanitize and parse input
    const data = {
      name: xss(req.body.name),
      description: xss(req.body.description),
      Address: xss(req.body.Address),
      price: parseFloat(req.body.price),
      category: req.body.category,
      stockQuantity: parseInt(req.body.stockQuantity),
    };

    // Validate
    const { error } = addProductSchema.validate(data);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const category = await prisma.category.findUnique({ where: { id: data.category } });
    if (!category) {
      return res.status(400).json({ message: 'Category not found' });
    }

    // Check files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'يجب رفع ملف واحد على الأقل' });
    }

    const userId = req.user.id || req.user._id;

    // Upload to Cloudinary
    const cloudinaryFolder = `users/${userId}/products`;
    const uploadPromises = req.files.map(file =>
      new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: cloudinaryFolder, resource_type: 'auto' },
          (error, result) => {
            if (error) return reject(new Error(`فشل رفع الملف: ${file.originalname}`));
            resolve(result.secure_url);
          }
        ).end(file.buffer);
      })
    );

    const uploadedUrls = await Promise.all(uploadPromises);

    // Create
    const product = await prisma.product.create({
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        categoryId: data.category,
        stockQuantity: data.stockQuantity,
        imageUrl: uploadedUrls,
        merchantId: userId,
        Address: data.Address,
      }
    });

    res.status(201).json({ message: 'تم إضافة المنتج بنجاح', product: { ...product, _id: product.id } });
  }),
];

// Update Product
exports.updateProduct = [
  merchant,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Authorization
    if (product.merchantId !== userId) {
      return res.status(403).json({ message: 'You are not the author of this product' });
    }

    // Sanitize and parse
    const data = {
      name: xss(req.body.name),
      description: xss(req.body.description),
      price: parseFloat(req.body.price),
      category: req.body.category,
      stockQuantity: parseInt(req.body.stockQuantity, 10),
    };

    // Validate
    const { error } = updateProductSchema.validate(data);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    // Validate Category
    const category = await prisma.category.findUnique({ where: { id: data.category } });
    if (!category) {
      return res.status(400).json({ message: 'Category not found' });
    }

    // Update fields
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        categoryId: data.category,
        stockQuantity: data.stockQuantity,
      }
    });

    res.status(200).json({ message: 'Product updated successfully', product: { ...updatedProduct, _id: updatedProduct.id } });
  }),
];

// Delete Product
exports.deleteProduct = [
  merchant,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.merchantId !== userId) {
      return res.status(403).json({ message: 'You are not the author of this product' });
    }

    // Delete from Cloudinary
    const publicIds = product.imageUrl.map(url => {
        const parts = url.split('/');
        let filename = parts[parts.length - 1]; // "image.png"
        let folderParts = parts.slice(parts.indexOf('upload') + 2, parts.length - 1); // ["users", "userId", "products"]
        let folderPath = folderParts.join('/');
        let publicId = `${folderPath}/${filename.split('.')[0]}`;
        return publicId;
    });

    await Promise.all(
      publicIds.map(pid => new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(pid, (error, result) => {
          // Suppress cloudinary delete errors to avoid blocking DB delete if images were already scrubbed
          resolve(result);
        });
      }))
    );

    await prisma.product.delete({ where: { id } });

    res.status(200).json({ message: 'Product deleted successfully' });
  }),
];

// Get Merchant's Products
exports.getAllProductsMerchant = [
  merchant,
  asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;
    const products = await prisma.product.findMany({ where: { merchantId: userId } });

    const adaptedProducts = products.map(p => ({ ...p, _id: p.id }));
    res.status(200).json(adaptedProducts);
  }),
];
