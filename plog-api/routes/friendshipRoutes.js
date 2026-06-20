const express = require("express");
const router = express.Router();
const friendshipController = require("../controllers/friendshipController");
const { verifyToken } = require("../../middlewares/verifytoken");

// Send a friend request
router.post("/request", verifyToken, friendshipController.sendFriendRequest);

// Accept or Reject a friend request
router.put("/respond", verifyToken, friendshipController.respondToRequest);

// Get all accepted friends
router.get("/", verifyToken, friendshipController.getFriends);

// Get pending friend requests for the current user
router.get("/pending", verifyToken, friendshipController.getPendingRequests);

// Search for users to add as friends
router.get("/search", verifyToken, friendshipController.searchUsers);

module.exports = router;
