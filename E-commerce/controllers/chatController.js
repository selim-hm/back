const asyncHandler = require('express-async-handler');
const prisma = require('../../config/prisma');
const NotificationService = require('../../Notification/notificationService');

/**
 * @desc    Send a message (Pharmacy <-> Shipping)
 * @route   POST /api/ecommerce-chat/send
 * @access  private
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { recipientId, text } = req.body;
  const senderId = req.user.id || req.user._id;

  if (!recipientId || !text) {
    return res.status(400).json({ message: 'Recipient and text are required' });
  }

  const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
  if (!recipient) return res.status(404).json({ message: 'Recipient not found' });

  const isPharmacy = req.user.role === 'pharmacy';
  const isShipping = req.user.role === 'shipping_company';
  const recipientIsPharmacy = recipient.role === 'pharmacy';
  const recipientIsShipping = recipient.role === 'shipping_company';

  if (!((isPharmacy && recipientIsShipping) || (isShipping && recipientIsPharmacy))) {
    return res.status(400).json({ message: 'Chat is only allowed between pharmacies and shipping companies.' });
  }

  const pharmacyId = isPharmacy ? senderId : recipientId;
  const shippingId = isShipping ? senderId : recipientId;

  // Check for accepted contract
  const contract = await prisma.contract.findFirst({
    where: { pharmacyId, shippingCompanyId: shippingId, status: 'accepted' }
  });

  // Find or create conversation
  let conversation = await prisma.ecommerceConversation.findUnique({
    where: { pharmacyId_shippingCompanyId: { pharmacyId, shippingCompanyId: shippingId } }
  });

  if (!conversation) {
    conversation = await prisma.ecommerceConversation.create({
      data: { pharmacyId, shippingCompanyId: shippingId }
    });
  }

  // Enforce 2-message limit if no contract
  if (!contract && conversation.messageCount >= 2 && !conversation.isBlockedForNewMessages) {
    return res.status(403).json({
      message: 'Message limit reached. You can only send 2 messages until a contract is accepted.',
      requiresContract: true
    });
  }

  // Create message
  const message = await prisma.ecommerceMessage.create({
    data: { conversationId: conversation.id, senderId, text }
  });

  // Update conversation
  const newCount = conversation.messageCount + 1;
  await prisma.ecommerceConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageId: message.id,
      messageCount: newCount,
      isBlockedForNewMessages: !contract && newCount >= 2
    }
  });

  // Send Notification
  try {
    if (recipient.fcmTokens && recipient.fcmTokens.length > 0) {
      await NotificationService.sendToMultipleDevices(
        recipient.fcmTokens,
        `New Message from ${req.user.username}`,
        text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        { conversationId: conversation.id, type: 'NEW_CHAT_MESSAGE' }
      );
    }
  } catch (err) {
    console.error('Chat Notification Error:', err);
  }

  res.status(201).json({
    message: { ...message, _id: message.id },
    conversation: { ...conversation, _id: conversation.id }
  });
});

/**
 * @desc    Get messages for a conversation
 * @route   GET /api/ecommerce-chat/:conversationId
 * @access  private
 */
exports.getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const userId = req.user.id || req.user._id;

  const conversation = await prisma.ecommerceConversation.findUnique({
    where: { id: conversationId }
  });

  if (!conversation ||
    (conversation.pharmacyId !== userId && conversation.shippingCompanyId !== userId)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const messages = await prisma.ecommerceMessage.findMany({
    where: { conversationId },
    include: { sender: { select: { id: true, username: true, avatar: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (parseInt(page) - 1) * parseInt(limit),
    take: parseInt(limit)
  });

  res.status(200).json(messages.map(m => ({
    ...m, _id: m.id,
    sender: { ...m.sender, _id: m.sender.id }
  })));
});

/**
 * @desc    Get all my conversations
 * @route   GET /api/ecommerce-chat/conversations
 * @access  private
 */
exports.getMyConversations = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;

  const conversations = await prisma.ecommerceConversation.findMany({
    where: {
      OR: [{ pharmacyId: userId }, { shippingCompanyId: userId }]
    },
    include: {
      pharmacy: { select: { id: true, username: true, avatar: true, role: true, phone: true } },
      shippingCompany: { select: { id: true, username: true, avatar: true, role: true, phone: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 }
    },
    orderBy: { updatedAt: 'desc' }
  });

  res.status(200).json(conversations.map(c => ({
    ...c,
    _id: c.id,
    pharmacy: { ...c.pharmacy, _id: c.pharmacy.id },
    shippingCompany: { ...c.shippingCompany, _id: c.shippingCompany.id },
    lastMessage: c.messages[0] || null
  })));
});
