const express = require('express');
const router = express.Router();
const consultationController = require('../controller/consultation.controller');
const authenticate = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

// Consultation booking (patients only)
router.post('/', authenticate, authorizeRoles('patient'), consultationController.bookConsultation);
router.post('/book', authenticate, authorizeRoles('patient'), consultationController.bookConsultation);

// View user's consultations (patient or doctor)
router.get('/', authenticate, consultationController.listMyConsultations);
router.get('/my', authenticate, consultationController.listMyConsultations);

// Specific consultation details
router.get('/:id', authenticate, consultationController.getConsultationById);

// Cancellation (patient or assigned doctor)
router.patch('/:id/cancel', authenticate, consultationController.cancelConsultation);

// Update lifecycle (doctor or admin)
router.patch('/:id', authenticate, authorizeRoles('doctor', 'admin'), consultationController.updateConsultation);

module.exports = router;
