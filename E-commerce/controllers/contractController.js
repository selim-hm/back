const asyncHandler = require('express-async-handler');
const prisma = require('../../config/prisma');
const NotificationService = require('../../Notification/notificationService');

/**
 * @desc    Send a contract invitation
 * @route   POST /api/contracts/invite
 * @access  private (Pharmacy or Shipping Company)
 */
exports.sendInvitation = asyncHandler(async (req, res) => {
  const { targetUserId, message, businessDetails } = req.body;
  const senderId = req.user.id || req.user._id;

  if (!targetUserId) {
    return res.status(400).json({ message: 'Please provide targetUserId' });
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return res.status(404).json({ message: 'Target user not found' });
  }

  const isPharmacy = req.user.role === 'pharmacy';
  const isShipping = req.user.role === 'shipping_company';
  const targetIsPharmacy = targetUser.role === 'pharmacy';
  const targetIsShipping = targetUser.role === 'shipping_company';

  if (!((isPharmacy && targetIsShipping) || (isShipping && targetIsPharmacy))) {
    return res.status(400).json({ message: 'Invalid invitation direction.' });
  }

  const pharmacyId = isPharmacy ? senderId : targetUserId;
  const shippingCompanyId = isShipping ? senderId : targetUserId;

  const existing = await prisma.contract.findFirst({
    where: { pharmacyId, shippingCompanyId }
  });
  if (existing && ['pending', 'accepted'].includes(existing.status)) {
    return res.status(400).json({ message: 'A contract or pending invitation already exists between these parties.' });
  }

  const contract = await prisma.contract.create({
    data: {
      pharmacyId,
      shippingCompanyId,
      initiatedById: senderId,
      message,
      businessDetails,
      status: 'pending'
    }
  });

  try {
    if (targetUser.fcmTokens && targetUser.fcmTokens.length > 0) {
      await NotificationService.sendToMultipleDevices(
        targetUser.fcmTokens,
        'New Contract Invitation',
        `${req.user.username} has sent you a contract invitation.`,
        { contractId: contract.id, type: 'CONTRACT_INVITATION' }
      );
    }
  } catch (err) {
    console.error('Notification failed', err);
  }

  res.status(201).json({ message: 'Invitation sent successfully', contract: { ...contract, _id: contract.id } });
});

/**
 * @desc    Accept or Reject an invitation
 * @route   PUT /api/contracts/respond/:id
 * @access  private
 */
exports.respondToInvitation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const userId = req.user.id || req.user._id;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ message: "Invalid action. Use 'accept' or 'reject'." });
  }

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) return res.status(404).json({ message: 'Invitation not found' });

  if (contract.initiatedById === userId) {
    return res.status(403).json({ message: 'You cannot respond to your own invitation.' });
  }

  if (contract.pharmacyId !== userId && contract.shippingCompanyId !== userId) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  if (contract.status !== 'pending') {
    return res.status(400).json({ message: `Invitation is already ${contract.status}.` });
  }

  const updated = await prisma.contract.update({
    where: { id },
    data: { status: action === 'accept' ? 'accepted' : 'rejected' }
  });

  const initiator = await prisma.user.findUnique({ where: { id: contract.initiatedById } });
  try {
    if (initiator && initiator.fcmTokens && initiator.fcmTokens.length > 0) {
      await NotificationService.sendToMultipleDevices(
        initiator.fcmTokens,
        `Invitation ${action === 'accept' ? 'Accepted' : 'Rejected'}`,
        `${req.user.username} has ${action}ed your contract invitation.`,
        { contractId: contract.id, type: 'CONTRACT_RESPONSE', status: updated.status }
      );
    }
  } catch (err) {
    console.error('Notification failed', err);
  }

  res.status(200).json({ message: `Invitation ${action}ed successfully`, contract: { ...updated, _id: updated.id } });
});

/**
 * @desc    Get user's contracts
 * @route   GET /api/contracts/my-contracts
 * @access  private
 */
exports.getMyContracts = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;

  const contracts = await prisma.contract.findMany({
    where: {
      OR: [{ pharmacyId: userId }, { shippingCompanyId: userId }]
    },
    include: {
      pharmacy: { select: { id: true, username: true, email: true, phone: true, avatar: true } },
      shippingCompany: { select: { id: true, username: true, email: true, phone: true, avatar: true } }
    },
    orderBy: { updatedAt: 'desc' }
  });

  res.status(200).json(contracts.map(c => ({
    ...c,
    _id: c.id,
    pharmacy: { ...c.pharmacy, _id: c.pharmacy.id },
    shippingCompany: { ...c.shippingCompany, _id: c.shippingCompany.id }
  })));
});
