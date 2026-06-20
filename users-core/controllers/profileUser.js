const asyncHandler = require("express-async-handler");
const xss = require("xss");
const {
  generateTokenAndSend,
} = require("../../middlewares/genarattokenandcookies");
const {
  validateProfileUpdate,
  formatValidationErrors: formatProfileValidationErrors,
} = require("../validators/AuthValidator");
const prisma = require("../../config/prisma");

if (!process.env.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is not defined. The server cannot start without it.",
  );
}

/**
 * @desc    Get user profile
 * @route   GET /api/user/profile/:id
 * @access  Private
 */
exports.getUserProfile = asyncHandler(async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        academicDegrees: true,
      },
    });

    if (!user) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    // Exclude password and sensitive info
    const {
      password,
      resetPasswordCode,
      verificationCode,
      fcmTokens,
      ...userProfile
    } = user;

    console.log("getUserProfile");

    res.status(200).json(userProfile);
  } catch (error) {
    console.log(error.message);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

/**
 * @desc    Get user orders (completed)
 * @route   GET /api/user/orders/completed
 * @access  Private
 */
exports.getUserOrders = asyncHandler(async (req, res) => {
  try {
    // Support both /profile/orders/:id (specific user) and /profile/orders (current user)
    const userId = req.params.id || req.user.id || req.user._id;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {
      OR: [{ patientId: userId }, { providerId: userId }],
    };
    if (status) filter.status = String(status);

    const [orders, totalOrders] = await Promise.all([
      prisma.serviceOrder.findMany({
        where: filter,
        include: {
          patient: { select: { id: true, username: true, avatar: true } },
          provider: { select: { id: true, username: true, avatar: true } },
        },
        skip: skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.serviceOrder.count({ where: filter }),
    ]);

    if (!orders || orders.length === 0) {
      console.log("No completed orders found");
      return res.status(200).json({
        total: 0,
        currentPage: Number(page),
        totalPages: 0,
        orders: [],
      });
      return res.status(200).json({
        total: 0,
        currentPage: Number(page),
        totalPages: 0,
        orders: [],
      });
    }

    console.log("Orders retrieved successfully");

    res.status(200).json({
      total: totalOrders,
      currentPage: Number(page),
      totalPages: Math.ceil(totalOrders / Number(limit)),
      orders: orders,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc get  post
 * @route /api/users/post/:id
 * @method GET
 * @access private
 */
exports.getPost = asyncHandler(async (req, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
    });

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.status(200).json(post);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server Error" });
  }
});

/**
 * @desc    Get user order by ID
 * @route   GET /api/user/orders/completed/:id
 * @access  Private
 */
exports.getUserOrderById = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const orderId = req.params.id;

    const order = await prisma.serviceOrder.findFirst({
      where: {
        id: orderId,
        OR: [{ patientId: userId }, { providerId: userId }],
      },
      include: {
        patient: {
          select: { id: true, username: true, avatar: true, phone: true },
        },
        provider: {
          select: { id: true, username: true, avatar: true, phone: true },
        },
      },
    });

    if (!order) {
      console.log("Order not found or not accessible");
      return res
        .status(404)
        .json({ message: "Order not found or not accessible" });
    }
    console.log("Order retrieved successfully");

    res.status(200).json(order);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc    Get user transportation info
 * @route   GET /api/user/transportation/:id
 * @access  Private
 */
exports.getTransportation = asyncHandler(async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { hasVehicle: true, vehicleType: true, vehicleDescription: true },
    });

    if (!user) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    console.log("User transportation info retrieved successfully");
    res.status(200).json({
      transportation: {
        hasVehicle: user.hasVehicle,
        vehicleType: user.vehicleType || "none",
        description: user.vehicleDescription || null,
      },
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({
      message: "Error fetching transportation info",
      error: error.message,
    });
  }
});

/**
 * @desc    Update user transportation info
 * @route   PUT /api/user/transportation/:id
 * @access  Private
 */
exports.updateTransportation = asyncHandler(async (req, res) => {
  try {
    const { hasVehicle, vehicleType, description } = req.body;
    const userId = req.params.id;

    // Validate user authorization
    const currentUserId = req.user.id || req.user._id;
    if (currentUserId !== userId) {
      console.log(
        "Unauthorized - can only update your own transportation info",
      );
      return res.status(403).json({
        message: "Unauthorized - can only update your own transportation info",
      });
    }

    // Validate input
    if (hasVehicle && vehicleType) {
      const validVehicleTypes = ["car", "bus", "none"];
      if (!validVehicleTypes.includes(vehicleType)) {
        console.log("Invalid vehicle type");
        return res.status(400).json({
          message: `Invalid vehicle type. Must be one of: ${validVehicleTypes.join(", ")}`,
        });
      }
    }

    // Validate description length if provided
    if (description && description.length > 500) {
      return res
        .status(400)
        .json({ message: "Description cannot exceed 500 characters" });
    }

    const userCount = await prisma.user.count({ where: { id: userId } });

    if (userCount === 0) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    // Update transportation
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        hasVehicle: hasVehicle || false,
        vehicleType: hasVehicle ? vehicleType || "none" : "none",
        vehicleDescription: description ? xss(description) : null,
      },
    });

    console.log("Transportation info updated successfully");
    res.status(200).json({
      message: "Transportation info updated successfully",
      transportation: {
        hasVehicle: updatedUser.hasVehicle,
        vehicleType: updatedUser.vehicleType,
        description: updatedUser.vehicleDescription,
      },
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({
      message: "Error updating transportation info",
      error: error.message,
    });
  }
});

/**
 * @desc    Update user profile
 * @route   PUT /api/user/profile/:id
 * @access  Private
 */
exports.updateUserProfile = asyncHandler(async (req, res) => {
  try {
    let data = {
      phone: xss(req.body.phone),
      description: xss(req.body.description),
      gender: xss(req.body.gender),
    };

    if (req.body.specialization !== undefined) {
      data.specialization = xss(req.body.specialization);
    }

    if (req.body.coverPhoto !== undefined) {
      data.coverPhoto = xss(req.body.coverPhoto);
    }

    const { error } = validateProfileUpdate(data);
    if (error) {
      console.log("Validation error");
      return res
        .status(400)
        .json({ error: formatProfileValidationErrors(error) });
    }

    const currentUserId = req.user.id || req.user._id;
    if (
      !(
        req.user &&
        (currentUserId === req.params.id || req.user.role === "admin")
      )
    ) {
      console.log("Unauthorized to update profile");
      return res
        .status(403)
        .json({ message: "Unauthorized to update profile" });
    }

    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: req.params.id },
        data: data,
        include: { kyc: true },
      });

      // Special handling for academicDegrees since it's a separate model
      if (req.body.academicDegrees && Array.isArray(req.body.academicDegrees)) {
        // Delete old degrees and insert new ones
        await prisma.academicDegree.deleteMany({
          where: { userId: req.params.id },
        });

        if (req.body.academicDegrees.length > 0) {
          await prisma.academicDegree.createMany({
            data: req.body.academicDegrees.map((degree) => ({
              userId: req.params.id,
              degree: degree.degree || degree.title,
              field: degree.field || "General",
              institution: degree.institution || "Unknown",
              graduationYear: degree.graduationYear,
              certificateImage: degree.certificateImage,
            })),
          });
        }
      }
    } catch (dbError) {
      if (dbError.code === "P2002") {
        const field = dbError.meta?.target?.[0] || "Field";
        return res.status(400).json({
          message: `${field === "phone" ? "Phone number" : "Field"} already exists.`,
          error: dbError.message,
        });
      }
      throw dbError; // rethrow to be caught by outer try-catch
    }

    if (!updatedUser) {
      console.log("User not found during update");
      return res.status(404).json({ message: "User not found" });
    }

    console.log("Profile updated successfully");

    // Adapt for Mongoose expectations
    updatedUser._id = updatedUser.id;
    updatedUser.documentation = updatedUser.kyc
      ? updatedUser.kyc.documentation
      : false;

    // Send token using exact middleware formatting
    generateTokenAndSend(updatedUser, res);
  } catch (error) {
    console.log(error.message);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});
