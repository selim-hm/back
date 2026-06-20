const prisma = require("../config/prisma");
const { verifyAndDecryptToken } = require("./genarattokenandcookies");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required in environment variables");
}

const verifyTokenUpPhoto = async (req, res, next) => {
  const encryptedToken = req.headers["auth-token"];

  if (!encryptedToken) {
    return res.status(401).json({
      error: "Authentication required",
      code: "MISSING_TOKEN",
    });
  }

  try {
    const decoded = await verifyAndDecryptToken(encryptedToken);

    // 1. Fetch Core User with Wallet and KYC attached
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        wallet: true,
        kyc: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: "User not found or session expired",
        code: "USER_NOT_FOUND",
      });
    }

    // Auto-recover if wallet is missing for some reason
    if (!user.wallet) {
      user.wallet = await prisma.userWallet.create({
        data: { userId: user.id },
      });
    }

    // Adapter: Attach Wallet/KYC fields to user object for backward compatibility
    if (user.wallet) {
      user.balance = user.wallet.balance;
      user.RemainingAccount = user.wallet.remainingAccount;
      user.targetAccount = user.wallet.targetAccount;
      user.commissionDebt = user.wallet.commissionDebt;
      user.commissionOperationCount = user.wallet.commissionOperationCount;
    } else {
      user.balance = 0;
      user.RemainingAccount = 0;
      user.targetAccount = 0;
    }

    if (user.kyc) {
      user.documentation = user.kyc.documentation;
      user.identityNumber = user.kyc.identityNumber;
      user.identityType = user.kyc.identityType;
      user.documentPhoto = user.kyc.documentPhoto;
      user.medicalDocument = user.kyc.medicalDocument;
      user.riskScore = user.kyc.riskScore;
    } else {
      user.documentation = false;
    }

    user.okemail = user.emailVerified;
    const userEmail = user.email;

    // Consistency check to prevent token spoofing across roles
    if (user.role !== decoded.role || userEmail !== decoded.email) {
      return res.status(401).json({
        error: "Token data mismatch",
        code: "TOKEN_DATA_MISMATCH",
      });
    }

    req.user = user;
    // Map _id for legacy mongoose compatibility on req.user object temporarily during migration
    req.user._id = user.id;

    // Attach separated models
    req.userWallet = user.wallet;
    req.userKYC = user.kyc;

    next();
  } catch (error) {
    console.error("Token verification failed", {
      error: error && error.message,
    });

    if (error.message && error.message.includes("expired")) {
      return res
        .status(401)
        .json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }

    if (error.message && error.message.includes("Invalid")) {
      return res
        .status(401)
        .json({ error: "Invalid token", code: "INVALID_TOKEN" });
    }

    return res
      .status(401)
      .json({ error: "Authentication failed", code: "AUTHENTICATION_FAILED" });
  }
};

const verifyToken = (req, res, next) => {
  verifyTokenUpPhoto(req, res, () => {
    // Check using the mapped properties
    if (!req.user.documentation || !req.user.okemail) {
      return res.status(403).json({
        error: "Account verification required",
        code: "VERIFICATION_REQUIRED",
      });
    }
    next();
  });
};

const verifyTokenAndAuthorization = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.id === req.params.id || req.user._id === req.params.id) {
      next();
    } else {
      res.status(403).json({
        error: "Access denied",
        code: "UNAUTHORIZED_ACCESS",
      });
    }
  });
};

const verifyTokenAndPharmacy = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.role === "pharmacy") {
      next();
    } else {
      res.status(403).json({
        error: "Access denied. Only pharmacies can perform this action.",
        code: "PHARMACY_REQUIRED",
      });
    }
  });
};

function verifyTokenAndAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user.role === "admin") {
      next();
    } else {
      res.status(403).json({
        error: "Unauthorized access. Admin role required.",
        code: "ADMIN_REQUIRED",
      });
    }
  });
}

module.exports = {
  verifyToken,
  verifyTokenUpPhoto,
  verifyTokenAndAuthorization,
  verifyTokenAndAdmin,
  verifyTokenAndPharmacy,
};
