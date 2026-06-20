const express = require("express");
const router = express.Router();
const {
  addComment,
  updateComment,
  deleteComment,
  getDoctorReviews,
} = require("../controllers/reviewController");
const { verifyToken } = require("../../middlewares/verifytoken");

router.post("/add", verifyToken, addComment);
router.get("/doctor-reviews", verifyToken, getDoctorReviews);
router.put("/update/:id", verifyToken, updateComment);
router.delete("/delete/:id", verifyToken, deleteComment);

module.exports = router;
