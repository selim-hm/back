var express = require("express");
var router = express.Router();
const commentController = require("../controllers/commentController");
const {
  verifyToken,
  verifyTokenAndAuthorization,
  verifyTokenAndAdmin,
} = require("../../middlewares/verifytoken");

router.post("/:id", verifyToken, commentController.createComment);
router.get(
  "/:id/comments",
  verifyToken,
  commentController.getAllCommentsForPost,
);
router.delete(
  "/:id/comments",
  verifyTokenAndAuthorization,
  commentController.deleteComment,
);
router.put(
  "/comments/:id",
  verifyTokenAndAuthorization,
  commentController.updateComment,
);
router.put("/:id/like", verifyToken, commentController.likeComment);
router.put("/:id/unlike", verifyToken, commentController.unlikeComment);

module.exports = router;
