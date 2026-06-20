const router = require("express").Router();
const { advancedSearch } = require("../controllers/searchController");
const { verifyToken } = require("../../middlewares/verifytoken");

router.get("/advanced", verifyToken, advancedSearch);

module.exports = router;
