const asyncHandler = require("express-async-handler");
const prisma = require("../../config/prisma");
const xss = require("xss");

/**
 * @desc    Send Friend Request
 * @route   POST /api/social/friends/request
 * @access  Private
 */
exports.sendFriendRequest = asyncHandler(async (req, res) => {
  const { recipientId } = req.body;
  const requesterId = req.user.id || req.user._id;

  if (requesterId === recipientId) {
    return res.status(400).json({ message: "You cannot add yourself" });
  }

  // Check if request already exists (either direction)
  const existingRequest = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: requesterId, addresseeId: recipientId },
        { requesterId: recipientId, addresseeId: requesterId },
      ],
    },
  });

  if (existingRequest) {
    return res
      .status(400)
      .json({
        message: "Friend request already exists or you are already friends",
      });
  }

  const newRequest = await prisma.friendship.create({
    data: {
      requesterId: requesterId,
      addresseeId: recipientId,
      status: "pending",
    },
  });

  res.status(201).json({ message: "Friend request sent", data: newRequest });
});

/**
 * @desc    Respond to Friend Request (Accept/Reject)
 * @route   PUT /api/social/friends/respond
 * @access  Private
 */
exports.respondToRequest = asyncHandler(async (req, res) => {
  const { requestId, status } = req.body; // status: 'accepted' or 'rejected'
  const recipientId = req.user.id || req.user._id;

  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const friendship = await prisma.friendship.findFirst({
    where: {
      id: requestId,
      addresseeId: recipientId,
      status: "pending",
    },
  });

  if (!friendship) {
    return res.status(404).json({ message: "Friend request not found" });
  }

  if (status === "rejected") {
    await prisma.friendship.delete({ where: { id: requestId } });
    return res.status(200).json({ message: "Friend request rejected" });
  }

  const updatedFriendship = await prisma.friendship.update({
    where: { id: requestId },
    data: { status: "accepted" },
  });

  res
    .status(200)
    .json({ message: "Friend request accepted", data: updatedFriendship });
});

/**
 * @desc    Get Friends List
 * @route   GET /api/social/friends
 * @access  Private
 */
exports.getFriends = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;

  const friends = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: {
        select: {
          id: true,
          username: true,
          avatar: true,
          phone: true,
          role: true,
        },
      },
      addressee: {
        select: {
          id: true,
          username: true,
          avatar: true,
          phone: true,
          role: true,
        },
      },
    },
  });

  // Extract friend Profiles
  const friendsProfiles = friends
    .map((f) => (f.requesterId === userId ? f.addressee : f.requester))
    .map((f) => ({ ...f, _id: f.id })); // Adapt for Mongoose expectations

  res.status(200).json({ data: friendsProfiles });
});

/**
 * @desc    Get Pending Requests
 * @route   GET /api/social/friends/pending
 * @access  Private
 */
exports.getPendingRequests = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;

  const requests = await prisma.friendship.findMany({
    where: {
      addresseeId: userId,
      status: "pending",
    },
    include: {
      requester: {
        select: { id: true, username: true, avatar: true, role: true },
      },
    },
  });

  // Align API response with expected Mongoose format
  const mappedRequests = requests.map((req) => ({
    ...req,
    _id: req.id,
    requester: { ...req.requester, _id: req.requester.id },
  }));

  res.status(200).json({ data: mappedRequests });
});

/**
 * @desc    Search for People
 * @route   GET /api/social/friends/search
 * @access  Private
 */
exports.searchUsers = asyncHandler(async (req, res) => {
  const query = req.query.q ? xss(req.query.q) : "";
  const currentUserId = req.user.id || req.user._id;

  if (!query || query.length < 2) {
    return res.status(200).json({ data: [] });
  }

  // Prisma does not magically search nested objects (email.address) in Mongoose JSON fields
  const users = await prisma.user.findMany({
    where: {
      id: { not: currentUserId },
      OR: [
        { username: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } }, // Email became a string in Prisma
      ],
    },
    select: {
      id: true,
      username: true,
      avatar: true,
      phone: true,
      role: true,
    },
    take: 10,
  });

  const adaptedUsers = users.map((u) => ({ ...u, _id: u.id }));

  res.status(200).json({ data: adaptedUsers });
});
