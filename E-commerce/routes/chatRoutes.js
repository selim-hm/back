const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middlewares/verifytoken');
const { sendMessage, getMessages, getMyConversations } = require('../controllers/chatController');

router.post('/send', verifyToken, sendMessage);
router.get('/my-conversations', verifyToken, getMyConversations);
router.get('/:conversationId', verifyToken, getMessages);

module.exports = router;
