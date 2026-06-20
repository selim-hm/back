const asyncHandler = require("express-async-handler");
const xss = require("xss");
const Joi = require("joi");
const prisma = require("../../config/prisma");

/**
 * @desc create new category
 * @route /api/categories
 * @method Post
 * @access public
 */
exports.createCategory = asyncHandler(async (req, res) => {
  try {
    const data = {
      text: xss(req.body.text),
      type: req.body.type || "blog",
      roles: Array.isArray(req.body.roles) ? req.body.roles : [],
    };
    const schema = Joi.object({
      text: Joi.string().min(1).required().trim().label("Category Name"),
      type: Joi.string().valid("blog", "ecommerce").default("blog"),
      roles: Joi.array().items(Joi.string()).default([]),
    });
    const { error } = schema.validate(data);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const newCategory = await prisma.category.create({
      data: {
        text: data.text,
        type: data.type,
        roles: data.roles,
        userId: req.user.id || req.user._id,
      },
    });

    res
      .status(201)
      .json({ message: "Category created successfully", data: newCategory });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @desc get all categories
 * @route /api/categories/all
 * @method get
 * @access public
 */
exports.getCategories = asyncHandler(async (req, res) => {
  try {
    const { type } = req.query;
    let filter = type ? { type: String(type) } : {};

    // Filter by user role if available
    if (req.user && req.user.role && req.user.role !== "admin") {
      filter = {
        ...filter,
        OR: [
          { roles: { has: req.user.role } },
          { roles: { isEmpty: true } }, // Show categories with no restrictions
        ],
      };
    }

    const categories = await prisma.category.findMany({
      where: filter,
    });

    res.status(200).json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @desc update category
 * @route /api/categories/:id
 * @method Put
 * @access admin
 */
exports.updateCategory = asyncHandler(async (req, res) => {
  try {
    const { text, type } = req.body;
    const validationData = { text: xss(text) };
    if (type) validationData.type = type;

    const schema = Joi.object({
      text: Joi.string().min(1).required().trim().label("Category Name"),
      type: Joi.string().valid("blog", "ecommerce").default("blog"),
    });
    const { error } = schema.validate(validationData);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const updateData = { text: xss(text) };
    if (type) updateData.type = type;
    if (req.body.roles)
      updateData.roles = Array.isArray(req.body.roles)
        ? req.body.roles
        : [req.body.roles];

    const updatedCategory = await prisma.category
      .update({
        where: { id: req.params.id },
        data: updateData,
      })
      .catch((err) => null);

    if (!updatedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }

    res
      .status(200)
      .json({
        message: "Category updated successfully",
        data: updatedCategory,
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @desc delete category
 * @route /api/categories/:id
 * @method Delete
 * @access admin
 */
exports.deleteCategory = asyncHandler(async (req, res) => {
  try {
    const deletedCategory = await prisma.category
      .delete({
        where: { id: req.params.id },
      })
      .catch((err) => null);

    if (!deletedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});
