var express = require("express");
var router = express.Router();
const { verifyToken } = require("../../middlewares/verifytoken");
const {
  createOrder,
  createOrderWithProvider,
  getNearbyProviders,
  getOrders,
  reviewApplicants,
  selectProvider,
  selectOffer,
  confirmCompletion,
  markArrival: markArrivalByPatient,
  cancelOrder: cancelOrderByPatient,
} = require("../controllers/order.controllers");
const { RemainingAccount } = require("../../middlewares/RemainingAccount");
const {
  getOrdersForProvider,
  acceptOrder,
  confirmOrder,
  rejectOrder,
  startService,
  markArrival: markArrivalByProvider,
  completeOrder: completeOrderByProvider,
  cancelOrder: cancelOrderByProvider,
} = require("../controllers/order.provider.controllers");

// Patient Routes
router.post("/create", verifyToken, RemainingAccount, createOrder);
router.post(
  "/createWithProvider",
  verifyToken,
  RemainingAccount,
  createOrderWithProvider,
);
router.get(
  "/getNearbyProviders",
  verifyToken,
  RemainingAccount,
  getNearbyProviders,
);
router.get("/getOrders", verifyToken, RemainingAccount, getOrders);
router.post("/selectProvider", verifyToken, RemainingAccount, selectProvider);
router.post("/selectOffer/:id", verifyToken, RemainingAccount, selectOffer);
router.post(
  "/reviewApplicants",
  verifyToken,
  RemainingAccount,
  reviewApplicants,
);
router.post(
  "/confirmCompletion/:id",
  verifyToken,
  RemainingAccount,
  confirmCompletion,
);
router.patch(
  "/markArrival/:id",
  verifyToken,
  RemainingAccount,
  markArrivalByPatient,
);
router.post("/cancel/:id", verifyToken, RemainingAccount, cancelOrderByPatient);

// Provider Routes
router.get(
  "/getOrdersForProvider",
  verifyToken,
  RemainingAccount,
  getOrdersForProvider,
);
router.post("/acceptOrder/:id", verifyToken, RemainingAccount, acceptOrder);
router.post("/confirmOrder/:id", verifyToken, RemainingAccount, confirmOrder);
router.post("/rejectOrder/:id", verifyToken, RemainingAccount, rejectOrder);
router.post("/start/:id", verifyToken, RemainingAccount, startService);
router.patch(
  "/markArrivalByProvider/:id",
  verifyToken,
  RemainingAccount,
  markArrivalByProvider,
);
router.post(
  "/complete/:id",
  verifyToken,
  RemainingAccount,
  completeOrderByProvider,
);
router.post(
  "/cancelByProvider/:id",
  verifyToken,
  RemainingAccount,
  cancelOrderByProvider,
);

module.exports = router;
