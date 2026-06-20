var express = require('express');
var router = express.Router();
const { verifyToken } = require('../../middlewares/verifytoken');
const { getAllProducts, getProductById,getReviews } = require("../controllers/productUser");


router.get('/', verifyToken, getAllProducts);
router.get('/:id', verifyToken, getProductById);
router.get('/:id/reviews', verifyToken, getReviews);

module.exports = router;
