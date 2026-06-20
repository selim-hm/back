const prisma = require("../../config/prisma");

/**
 * Checks if two time ranges overlap.
 * @param {Date} start1
 * @param {number} duration1 (in hours)
 * @param {Date} start2
 * @param {number} duration2 (in hours)
 * @returns {boolean}
 */
function areTripsConflicting(start1, duration1, start2, duration2) {
  const s1 = new Date(start1).getTime();
  const e1 = s1 + duration1 * 60 * 60 * 1000;

  const s2 = new Date(start2).getTime();
  const e2 = s2 + duration2 * 60 * 60 * 1000;

  return s1 < e2 && s2 < e1;
}

/**
 * Automatically withdraws a provider from conflicting orders when they are confirmed for an order.
 * @param {string} providerId
 * @param {Object} confirmedOrder - The order the provider just got confirmed for
 */
async function withdrawConflicts(providerId, confirmedOrder) {
  // Find all other orders where this provider is involved
  const otherOrders = await prisma.serviceOrder.findMany({
    where: {
      id: { not: confirmedOrder.id },
      status: { in: ["open", "bidding"] },
      OR: [
        { interested: { some: { id: providerId } } },
        { offers: { some: { providerId: providerId, status: "pending" } } },
      ],
    },
    include: {
      interested: { select: { id: true } },
      offers: { where: { providerId: providerId, status: "pending" } },
    },
  });

  for (const order of otherOrders) {
    if (
      areTripsConflicting(
        confirmedOrder.appointmentDate,
        confirmedOrder.duration,
        order.appointmentDate,
        order.duration,
      )
    ) {
      const updateData = {
        withdrawnInterestedIds: { push: [] },
      };

      const isInterested = order.interested.some((p) => p.id === providerId);
      if (isInterested) {
        // Prisma doesn't have direct 'pull' for many-to-many, so we use disconnect
        // and manually manage the withdrawnInterestedIds array
        await prisma.serviceOrder.update({
          where: { id: order.id },
          data: {
            interested: { disconnect: { id: providerId } },
            withdrawnInterestedIds: { push: providerId },
          },
        });
      }

      // Update pending offer status
      if (order.offers.length > 0) {
        await prisma.orderOffer.updateMany({
          where: {
            orderId: order.id,
            providerId: providerId,
            status: "pending",
          },
          data: { status: "withdrawn_conflict" },
        });
      }
    }
  }
}

/**
 * Restores a provider's interest/offers if they are no longer confirmed for a conflicting order.
 * @param {string} providerId
 */
async function restoreConflicts(providerId) {
  // 1. Get all currently confirmed orders for this provider
  const confirmedOrders = await prisma.serviceOrder.findMany({
    where: {
      providerId: providerId,
      status: "confirmed",
    },
  });

  // 2. Find all orders where the provider was withdrawn due to conflict
  const withdrawnOrders = await prisma.serviceOrder.findMany({
    where: {
      status: { in: ["open", "bidding"] },
      OR: [
        { withdrawnInterestedIds: { has: providerId } },
        {
          offers: {
            some: { providerId: providerId, status: "withdrawn_conflict" },
          },
        },
      ],
    },
    include: {
      offers: {
        where: { providerId: providerId, status: "withdrawn_conflict" },
      },
    },
  });

  for (const order of withdrawnOrders) {
    // Check if this order still conflicts with ANY of the remaining confirmed orders
    const stillConflicts = confirmedOrders.some((confirmed) =>
      areTripsConflicting(
        confirmed.appointmentDate,
        confirmed.duration,
        order.appointmentDate,
        order.duration,
      ),
    );

    if (!stillConflicts) {
      // Restore to Interested
      if (order.withdrawnInterestedIds.includes(providerId)) {
        const newWithdrawnIds = order.withdrawnInterestedIds.filter(
          (id) => id !== providerId,
        );
        await prisma.serviceOrder.update({
          where: { id: order.id },
          data: {
            interested: { connect: { id: providerId } },
            withdrawnInterestedIds: { set: newWithdrawnIds },
          },
        });
      }

      // Restore offer status
      if (order.offers.length > 0) {
        await prisma.orderOffer.updateMany({
          where: {
            orderId: order.id,
            providerId: providerId,
            status: "withdrawn_conflict",
          },
          data: { status: "pending" },
        });
      }
    }
  }
}

module.exports = {
  areTripsConflicting,
  withdrawConflicts,
  restoreConflicts,
};
