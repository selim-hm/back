const prisma = require("../../config/prisma");

const COMMISSION_RATE = 0.08;
const COMMISSION_DEBT_THRESHOLD = 10;
const COMMISSION_OPERATION_THRESHOLD = 10;
const CANCELLATION_FEE_PERCENTAGE = 0.1;
const CANCELLATION_TIME_WINDOW_MINUTES = 30;
const PREMIUM_SAFETY_FEE = 1;

/**
 * Calculate 5% commission on order price
 * @param {number} orderPrice - Order price in currency
 * @returns {number} - Commission amount (5% of price)
 */
function calculateCommission(orderPrice) {
  return parseFloat((orderPrice * COMMISSION_RATE).toFixed(2));
}

/**
 * Calculate cancellation fee (10% of order price)
 * @param {number} orderPrice - Order price in currency
 * @returns {number} - Cancellation fee (10% of price)
 */
function calculateCancellationFee(orderPrice) {
  return parseFloat((orderPrice * CANCELLATION_FEE_PERCENTAGE).toFixed(2));
}

/**
 * Check if cancellation fee should be applied based on trip time
 * @param {Date} tripDate - Scheduled trip date/time
 * @param {Date} cancelDate - Cancel request date/time (default: now)
 * @returns {boolean} - true if fee should apply
 */
function shouldApplyCancellationFee(tripDate, cancelDate = new Date()) {
  if (!tripDate) return false;
  const timeUntilTrip = new Date(tripDate).getTime() - cancelDate.getTime();
  const minutesUntilTrip = timeUntilTrip / (1000 * 60);
  return minutesUntilTrip <= CANCELLATION_TIME_WINDOW_MINUTES;
}

/**
 * Add commission to user's debt and track operation count
 * @param {string} userId - User ID
 * @param {number} commission - Commission amount
 */
async function addCommissionDebt(userId, commission) {
  try {
    // Upsert ensures wallet creation if missing
    const updatedWallet = await prisma.userWallet.upsert({
      where: { userId: userId },
      update: {
        commissionDebt: { increment: commission },
        commissionOperationCount: { increment: 1 },
      },
      create: {
        userId: userId,
        commissionDebt: commission,
        commissionOperationCount: 1,
      },
    });

    if (
      updatedWallet.commissionDebt >= COMMISSION_DEBT_THRESHOLD ||
      updatedWallet.commissionOperationCount >= COMMISSION_OPERATION_THRESHOLD
    ) {
      console.warn(`Commission threshold reached for user ${userId}`, {
        debt: updatedWallet.commissionDebt,
        operationCount: updatedWallet.commissionOperationCount,
      });
    }
    return updatedWallet;
  } catch (err) {
    console.error("Failed to add commission debt", err);
    throw err;
  }
}

/**
 * Apply cancellation penalty to the canceller and compensate the damaged party
 * @param {string} cancellerId - User ID who cancelled
 * @param {number} fee - Penalty fee amount
 * @param {string} damagedId - User ID who gets compensated
 */
async function handleCancellationPenalty(cancellerId, fee, damagedId) {
  try {
    await prisma.$transaction([
      // Penalize canceller (increase their debt)
      prisma.userWallet.upsert({
        where: { userId: cancellerId },
        update: { commissionDebt: { increment: fee } },
        create: { userId: cancellerId, commissionDebt: fee },
      }),
      // Compensate damaged party (increase their balance - using 'balance' field)
      prisma.userWallet.upsert({
        where: { userId: damagedId },
        update: { balance: { increment: fee } },
        create: { userId: damagedId, balance: fee },
      }),
    ]);

    console.info("Cancellation penalty/compensation applied", {
      canceller: cancellerId,
      damaged: damagedId,
      fee: fee,
    });
  } catch (err) {
    console.error("Failed to apply cancellation penalty", err);
    throw err;
  }
}

/**
 * Clear commission debt after payment
 * @param {string} userId - User ID
 */
async function clearCommissionDebt(userId) {
  try {
    await prisma.userWallet.update({
      where: { userId: userId },
      data: {
        commissionDebt: 0,
        commissionOperationCount: 0,
        lastCommissionPaymentDate: new Date(),
      },
    });
    console.info(`Commission debt cleared for user ${userId}`);
  } catch (err) {
    console.error("Failed to clear commission debt", err);
    throw err;
  }
}

/**
 * Deduct credits from user's wallet
 * @param {string} userId - User ID
 * @param {number} amount - Number of credits to deduct
 */
async function deductCredits(userId, amount) {
  try {
    // Current Prisma doesn't have a direct 'increment if >= amount' in one go easily without raw SQL or a check
    // But we can use atomic update with where check
    const wallet = await prisma.userWallet.findUnique({ where: { userId } });
    if (!wallet || wallet.credits < amount) {
      throw new Error("Insufficient credits or wallet not found");
    }

    const updated = await prisma.userWallet.update({
      where: { userId },
      data: { credits: { decrement: amount } },
    });

    console.info(`Deducted ${amount} credits from user ${userId}`);
    return updated;
  } catch (err) {
    console.error("Failed to deduct credits", err);
    throw err;
  }
}

/**
 * Check if user can book next trip (no outstanding debt and sufficient credits)
 * @param {Object} wallet - UserWallet document
 * @param {number} requiredCredits - Credits needed for requested safety plan
 * @returns {Object} - { canBook: boolean, reason?: string, amount?: number }
 */
function canUserBookTrip(wallet, requiredCredits = 0) {
  if (!wallet) return { canBook: requiredCredits <= 0 };

  if (
    requiredCredits > 0 &&
    (!wallet.credits || wallet.credits < requiredCredits)
  ) {
    return {
      canBook: false,
      reason: "INSUFFICIENT_CREDITS",
      amount: requiredCredits,
    };
  }

  if (
    wallet.commissionDebt &&
    wallet.commissionDebt >= COMMISSION_DEBT_THRESHOLD
  ) {
    return {
      canBook: false,
      reason: "COMMISSION_DEBT_THRESHOLD",
      amount: wallet.commissionDebt,
    };
  }

  if (
    wallet.commissionOperationCount &&
    wallet.commissionOperationCount >= COMMISSION_OPERATION_THRESHOLD
  ) {
    return {
      canBook: false,
      reason: "COMMISSION_OPERATIONS_THRESHOLD",
      count: wallet.commissionOperationCount,
      amount: wallet.commissionDebt,
    };
  }

  if (wallet.targetAccount && wallet.targetAccount >= 10) {
    return {
      canBook: false,
      reason: "LEGACY_DEBT_LIMIT",
      amount: wallet.targetAccount,
    };
  }

  return { canBook: true };
}

module.exports = {
  COMMISSION_RATE,
  COMMISSION_DEBT_THRESHOLD,
  COMMISSION_OPERATION_THRESHOLD,
  CANCELLATION_FEE_PERCENTAGE,
  CANCELLATION_TIME_WINDOW_MINUTES,
  PREMIUM_SAFETY_FEE,
  calculateCommission,
  calculateCancellationFee,
  shouldApplyCancellationFee,
  handleCancellationPenalty,
  clearCommissionDebt,
  deductCredits,
  canUserBookTrip,
};
