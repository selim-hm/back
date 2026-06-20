var express = require("express");
var router = express.Router();
const { verifyToken } = require("../../middlewares/verifytoken");
const { gcsWebhookAuth } = require("../../middlewares/gcsWebhookAuth");
const {
  addAcademicDegree,
  getAcademicDegrees,
  updateAcademicDegree,
  deleteAcademicDegree,
  handleCertificateImageWebhook,
} = require("../controllers/academicDegreeController");

/**
 * GET /api/user/academic-degrees - Get all academic degrees for authenticated user
 */
router.get("/", verifyToken, getAcademicDegrees);

/**
 * POST /api/user/academic-degrees - Add a new academic degree
 * Body: { degree: "bachelor"|"master"|"phd"|"diploma"|"associate"|"other", field: string, institution: string, graduationYear?: number }
 */
router.post("/", verifyToken, addAcademicDegree);

/**
 * PUT /api/user/academic-degrees/:degreeId - Update an academic degree by its ID
 * Body: { degree?: string, field?: string, institution?: string, graduationYear?: number }
 */
router.put("/:degreeId", verifyToken, updateAcademicDegree);

/**
 * DELETE /api/user/academic-degrees/:degreeId - Delete an academic degree by its ID
 */
router.delete("/:degreeId", verifyToken, deleteAcademicDegree);

/**
 * POST /api/user/academic-degrees/webhook/image - GCS webhook for certificate image uploads
 * Public endpoint but protected with GCS signature verification
 * Only image files (image/*) are accepted - no videos
 */
router.post("/webhook/image", gcsWebhookAuth, handleCertificateImageWebhook);

module.exports = router;
