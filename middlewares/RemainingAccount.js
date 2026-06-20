const prisma = require("../config/prisma");

const RemainingAccount = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;

    let userWallet = await prisma.userWallet.findUnique({
      where: { userId: userId },
    });

    if (!userWallet) {
      // Create wallet on the fly if missing (e.g. legacy users during migration)
      try {
        userWallet = await prisma.userWallet.create({
          data: { userId: userId },
        });
      } catch (e) {
        console.error(`Failed to create wallet for user ${userId}`, e);
        return res.status(500).json({
          message: "Account configuration error",
          code: "WALLET_NOT_FOUND",
        });
      }
    }

    // 1. Commission Debt Check ($10 threshold)
    if (userWallet.commissionDebt && userWallet.commissionDebt >= 10) {
      console.warn(
        `Commission debt limit reached for user ${userId}: $${userWallet.commissionDebt}`,
      );
      return res.status(403).json({
        message:
          "You must settle your pending commission fees before booking your next service",
        code: "COMMISSION_DEBT_REQUIRED",
        amount: userWallet.commissionDebt,
      });
    }

    // 2. Commission Operation Count Check (10 operations limit)
    if (
      userWallet.commissionOperationCount &&
      userWallet.commissionOperationCount >= 10
    ) {
      console.warn(
        `Commission operation count limit reached for user ${userId}`,
      );
      return res.status(403).json({
        message:
          "You have reached the commission operation limit. Please settle your dues.",
        code: "COMMISSION_LIMIT_REACHED",
      });
    }

    // 3. Legacy targetAccount Debt Check ($50 threshold)
    if (userWallet.targetAccount && userWallet.targetAccount >= 50) {
      console.warn(
        `Account debt limit exceeded for user ${userId}: $${userWallet.targetAccount}`,
      );
      return res.status(403).json({
        message: "Unfortunately, you owe more money than the permitted limit",
        code: "ACCOUNT_DEBT_EXCEEDED",
        amount: userWallet.targetAccount,
      });
    }

    next();
  } catch (error) {
    console.error("RemainingAccount middleware error", error);
    return res.status(500).json({
      message: "Authorization check failed",
      error: error.message || "Internal server error",
    });
  }
};

module.exports = {
  RemainingAccount,
};
