const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const xss = require("xss");
const Joi = require("joi");
const {
  generateTokenAndSend,
  verifyAndDecryptToken,
} = require("../../middlewares/genarattokenandcookies");
const {
  validateRegister,
  validateLogin,
  formatValidationErrors: formatAuthValidationErrors,
} = require("../validators/AuthValidator");
const { validateLocationUpdate } = require("../validators/ProfileValidator");
const emailService = require("../util/sendGemail");
const prisma = require("../../config/prisma");
const {
  refreshAccessToken,
} = require("../../middlewares/genarattokenandcookies");

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */

exports.register = asyncHandler(async (req, res) => {
  const data = {
    role: xss(req.body.role),
    username: xss(req.body.username),
    email: xss(req.body.email),
    password: xss(req.body.password),
    phone: xss(req.body.phone),
    country: xss(req.body.country),
    Address: xss(req.body.Address),
    identityNumber: req.body.identityNumber
      ? xss(req.body.identityNumber)
      : null,
    IpPhone: req.body.IpPhone ? xss(req.body.IpPhone) : null,
    location: {
      type: "Point",
      coordinates: [
        parseFloat(xss(req.body.longitude)),
        parseFloat(xss(req.body.latitude)),
      ],
    },
    gender: xss(req.body.gender),
  };

  const { error } = validateRegister(data);
  if (error) {
    return res.status(400).json({ error: formatAuthValidationErrors(error) });
  }

  // Check email and phone address in Prisma
  const userExists = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, { phone: data.phone }] },
  });

  if (userExists)
    return res
      .status(401)
      .json({ error: "User with this email or phone already exists!" });

  // Check duplicate identity in KYC collection
  if (data.identityNumber) {
    const idExists = await prisma.userKYC.findUnique({
      where: { identityNumber: data.identityNumber },
    });
    if (idExists)
      return res
        .status(401)
        .json({ error: "Identity number already registered!" });
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(data.password, salt);

  const verificationCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString();

  try {
    // Create User, Wallet, and KYC simultaneously via nested writes
    const newUser = await prisma.user.create({
      data: {
        role: data.role,
        username: data.username,
        email: data.email,
        emailVerified: false,
        verificationCode: verificationCode,
        password: hashedPassword,
        phone: data.phone,
        latitude: data.location.coordinates[1],
        longitude: data.location.coordinates[0],
        country: data.country,
        address: data.Address,
        gender: data.gender,
        wallet: {
          create: {
            remainingAccount: 0,
          },
        },
        kyc: {
          create: {
            identityNumber: data.identityNumber,
            documentation: data.role === "patient", // Auto document if patient
          },
        },
      },
      include: {
        kyc: true,
      },
    });

    const result = await emailService.sendVerificationEmail({
      to: data.email,
      verificationCode,
      username: data.username || data.email,
    });

    if (!result || !result.success) {
      return res
        .status(500)
        .json({ error: "Failed to send verification email" });
    }

    generateTokenAndSend(newUser, res, {
      id: newUser.id,
      role: newUser.role,
      avatar: newUser.avatar,
      documentation: data.role === "patient",
      message: "Verification email sent successfully",
    });

    console.log(`register successfully ${data.username}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    Verify email address
 * @route   POST /api/auth/verifyEmail
 * @access  Public
 */
exports.verifyEmail = asyncHandler(async (req, res) => {
  try {
    const data = { code: xss(req.body.code) };
    const schema = Joi.object({ code: Joi.string().required() });
    const { error } = schema.validate(data);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findFirst({
      where: {
        id: req.user.id || req.user._id, // transition support
        verificationCode: data.code,
      },
      include: { kyc: true },
    });

    if (!user)
      return res.status(404).json({ error: "User not found or invalid code!" });

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationCode: null,
      },
      include: { kyc: true },
    });

    generateTokenAndSend(updatedUser, res, {
      id: updatedUser.id,
      role: updatedUser.role,
      avatar: updatedUser.avatar,
      documentation: updatedUser.kyc?.documentation || false,
      message: "Email verified successfully!",
    });

    console.log(`verifyEmail successfully ${updatedUser.username}`);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    User login
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = asyncHandler(async (req, res) => {
  try {
    const rawIdentifier = req.body.identifier || req.body.email || req.body.phone || req.body.username;

    const data = {
      identifier: rawIdentifier ? xss(rawIdentifier.trim()) : undefined,
      password: req.body.password ? xss(req.body.password) : undefined,
      fcmToken: req.body.fcmToken ? xss(req.body.fcmToken) : undefined,
    };

    const { error } = validateLogin(data);
    if (error)
      return res.status(400).json({ error: formatAuthValidationErrors(error) });

    const loginQuery = [];
    if (data.identifier) {
      loginQuery.push({ email: data.identifier });
      loginQuery.push({ phone: data.identifier });
      loginQuery.push({ username: data.identifier });
    }

    if (loginQuery.length === 0) {
      return res.status(400).json({ error: "Invalid credentials!" });
    }

    const user = await prisma.user.findFirst({
      where: { OR: loginQuery },
      include: { kyc: true },
    });

    if (!user)
      return res.status(400).json({ error: "Invalid login credentials!" });

    const validPassword = await bcrypt.compare(data.password, user.password);
    if (!validPassword)
      return res.status(400).json({ error: "Invalid login credentials!" });

    const isDocVerified = user.kyc ? user.kyc.documentation : false;
    user.documentation = isDocVerified;

    if (data.fcmToken && !user.fcmTokens.includes(data.fcmToken)) {
      const updatedTokens = [...user.fcmTokens, data.fcmToken].slice(-5);
      await prisma.user.update({
        where: { id: user.id },
        data: { fcmTokens: updatedTokens },
      });
    }

    generateTokenAndSend(user, res, {
      id: user.id,
      avatar: user.avatar,
      role: user.role,
      documentation: isDocVerified,
    });

    console.log(`login successfully ${user.username}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    Update user location
 * @route   PATCH /api/auth/updateLocation
 * @access  Public
 */
exports.updateLocation = asyncHandler(async (req, res) => {
  try {
    const data = {
      location: {
        type: "Point",
        coordinates: [
          parseFloat(xss(req.body.longitude)),
          parseFloat(xss(req.body.latitude)),
        ],
      },
    };
    const locationPayload = {
      userId: String(req.user.id || req.user._id),
      coordinates: data.location.coordinates,
    };
    const { error } = validateLocationUpdate(locationPayload);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.update({
      where: { id: locationPayload.userId },
      data: {
        longitude: data.location.coordinates[0],
        latitude: data.location.coordinates[1],
      },
      include: { kyc: true },
    });

    generateTokenAndSend(user, res, {
      id: user.id,
      role: user.role,
      avatar: user.avatar,
      documentation: user.kyc?.documentation || false,
      message: "Location updated successfully",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc    Verify user token and session
 * @route   POST /api/auth/validLogin
 * @access  Private
 */
exports.validLogin = asyncHandler(async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id || req.user._id;

    if (fcmToken) {
      const userDoc = await prisma.user.findUnique({ where: { id: userId } });
      if (userDoc && !userDoc.fcmTokens.includes(fcmToken)) {
        await prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: [...userDoc.fcmTokens, fcmToken].slice(-5) },
        });
      }
    }

    generateTokenAndSend(req.user, res, {
      id: req.user.id || req.user._id,
      role: req.user.role,
      avatar: req.user.avatar,
      documentation: req.user.documentation || false, // Should be populated by middleware normally
      message: `Welcome back ${req.user.username}`,
    });

    console.log(`validLogin successfully ${req.user.username}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    User logout
 * @route   POST /api/auth/logout
 * @access  Private
 */
exports.logout = asyncHandler(async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id || req.user._id;

    if (fcmToken) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        const filteredTokens = user.fcmTokens.filter(
          (token) => token !== fcmToken,
        );
        await prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: filteredTokens },
        });
      }
    }

    res.setHeader("x-auth-token", "");
    res.status(200).json({ message: "Logged out successfully" });

    console.log(`logout successfully ${req.user.username}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    Change user password
 * @route   POST /api/auth/changePassword
 * @access  Private
 */
exports.changePassword = asyncHandler(async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id || req.user._id;

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Both old and new passwords are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect old password" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    res.status(200).json({ message: "Password changed successfully" });
    console.log(`changePassword successfully for user ${user.id}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
});

/**
 * @desc    Refresh access token using refresh token
 * @route   POST /api/auth/refresh
 * @access  Public
 */

exports.Refresh = asyncHandler(async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: "refreshToken is required in request body",
      });
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiry,
    } = refreshAccessToken(refreshToken);

    // Send tokens via headers (primary for mobile)
    res.setHeader("auth-token", accessToken);
    res.setHeader("refresh-token", newRefreshToken);

    // Also send in response body (as backup)
    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiry,
      tokenType: "Bearer",
      message: "Token refreshed successfully - session extended indefinitely",
    });
  } catch (error) {
    console.error("[REFRESH] Error:", error);
    return res.status(401).json({
      error: "Failed to refresh token",
      message: error.message,
    });
  }
});
