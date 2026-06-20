const express = require("express");
const router = express.Router();
const { verifyToken } = require("../../middlewares/verifytoken");
const {
  getProviderProfile,
  updateProviderProfile,
  getProviderSchedule,
  updateProviderSchedule,
  getProviderAppointments,
  getProviderPatients,
  getProviderDashboard,
  getProviderReviews,
  getProviderChatMessages,
  sendProviderChatMessage,
  getProviderChatContacts,
  getProviderChatContactsCount,
  searchProviderChatContacts,
} = require("../controllers/providerController");

// All provider routes require authentication
router.use(verifyToken);

// Profile
router.get("/profile", getProviderProfile);
router.put("/profile", updateProviderProfile);

// Schedule
router.get("/schedule", getProviderSchedule);
router.put("/schedule", updateProviderSchedule);

// Appointments
router.get("/appointments", getProviderAppointments);

// Patients
router.get("/patients", getProviderPatients);

// Dashboard
router.get("/dashboard", getProviderDashboard);

// Reviews
router.get("/reviews", getProviderReviews);

// Chat
router.get("/chat/messages", getProviderChatMessages);
router.get("/chat/messages/:orderId", getProviderChatMessages);
router.post("/chat/messages", sendProviderChatMessage);
router.get("/chat/contacts", getProviderChatContacts);
router.get("/chat/contacts/count", getProviderChatContactsCount);
router.get("/chat/contacts/search", searchProviderChatContacts);

module.exports = router;
