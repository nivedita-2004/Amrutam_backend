const express = require('express');
const router = express.Router();
const paymentController = require('../controller/payment.controller');
const authenticate = require('../middleware/auth.middleware');

router.post('/', authenticate, paymentController.recordPayment);
router.get('/consultation/:consultationId', authenticate, paymentController.getPaymentByConsultation);

module.exports = router;
