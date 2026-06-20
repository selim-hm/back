var express = require("express");
var router = express.Router();
const postsController = require("../controllers/postsController");
const commentController = require("../controllers/commentController");
const category = require("../controllers/categoryController");
const { verifyTokenAndAdmin } = require("../../middlewares/verifytoken");

router.get(
  "/posts/Admin",
  verifyTokenAndAdmin,
  postsController.getAllPostsAdmin,
);
router.get(
  "/Allcomments",
  verifyTokenAndAdmin,
  commentController.getAllComments,
);

router.post("/categoryadmin", verifyTokenAndAdmin, category.createCategory);

module.exports = router;
