const express = require("express");
const router = express.Router();
const {
  searchKnowledge,
  addKnowledgeArticle,
  getDrugSuggestions,
  getDrugDetails,
} = require("../controllers/knowledgeController");
const { verifyTokenAndAdmin } = require("../../middlewares/verifytoken");

router.get("/search", searchKnowledge);
router.get("/drugs/suggestions", getDrugSuggestions);
router.get("/drugs/details", getDrugDetails);
router.post("/", verifyTokenAndAdmin, addKnowledgeArticle);

module.exports = router;
