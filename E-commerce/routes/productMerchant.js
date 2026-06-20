var express = require('express');
var router = express.Router();
const { verifyToken } = require('../../middlewares/verifytoken');
const { addProduct, updateProduct, deleteProduct, getAllProductsMerchant } = require("../controllers/productsControll");
const { optimizeAndPrepare, upload } = require("../../middlewares/upload")



router.post("/add", verifyToken, upload.array("files"), optimizeAndPrepare, addProduct);
router.put("/update/:id", verifyToken, updateProduct);
router.delete("/delete/:id", verifyToken, deleteProduct);
router.get("/get/", verifyToken, getAllProductsMerchant);


module.exports = router;
