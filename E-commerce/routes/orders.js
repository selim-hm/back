var express = require('express');
var router = express.Router();
const {
    addToCart,
    getCartItems,
    removeFromCart,
    checkout,
    webhook,
    getAllOrders,
    cancelOrder,
    markOrderReady,
    markOrderPickedUp,
    markOrderDelivered,
    getPharmacyOrders,
    getShippedOrders,
    getCompletedDeliveries,
    trackOrder
} = require("../controllers/ordersControllers");
const { verifyToken } = require('../../middlewares/verifytoken');

// ─────────────── Cart ───────────────
router.post('/add-to-cart', verifyToken, addToCart);
router.delete('/remove-from-cart/:id', verifyToken, removeFromCart);
router.get('/cart-items', verifyToken, getCartItems);

// ─────────────── Checkout ───────────────
router.post('/checkout', verifyToken, checkout);
router.post('/webhook', webhook);  // Stripe webhook — no auth

// ─────────────── User Orders ───────────────
router.get('/all-orders', verifyToken, getAllOrders);
router.post('/cancel-order/:id', verifyToken, cancelOrder);
router.get('/track/:id', verifyToken, trackOrder);

// ─────────────── Pharmacy Routes ───────────────
router.get('/pharmacy-orders', verifyToken, getPharmacyOrders);
router.put('/mark-ready/:id', verifyToken, markOrderReady);

// ─────────────── Shipping Company Routes ───────────────
router.get('/shipped', verifyToken, getShippedOrders);
router.put('/mark-picked-up/:id', verifyToken, markOrderPickedUp);
router.put('/mark-delivered/:id', verifyToken, markOrderDelivered);
router.get('/completed-deliveries', verifyToken, getCompletedDeliveries);

module.exports = router;
