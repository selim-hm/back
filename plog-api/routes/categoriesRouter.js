var express = require("express");
var router = express.Router();
const category = require("../controllers/categoryController");

const {
  verifyToken,
  verifyTokenAndAdmin,
} = require("../../middlewares/verifytoken");

// Public/Logged-in user routes
router.get("/all", verifyToken, category.getCategories);

// Admin only routes
router.post("/", verifyTokenAndAdmin, category.createCategory);
router.put("/:id", verifyTokenAndAdmin, category.updateCategory);
router.delete("/:id", verifyTokenAndAdmin, category.deleteCategory);

module.exports = router;
