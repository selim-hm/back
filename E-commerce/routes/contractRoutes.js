const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middlewares/verifytoken');
const { sendInvitation, respondToInvitation, getMyContracts } = require('../controllers/contractController');

router.post('/invite', verifyToken, sendInvitation);
router.put('/respond/:id', verifyToken, respondToInvitation);
router.get('/my-contracts', verifyToken, getMyContracts);

module.exports = router;
