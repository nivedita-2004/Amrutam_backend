const express = require('express');
const router = express.Router();
const prescriptionController = require('../controller/prescription.controller');
const validate = require('../middleware/validate.middleware');
const authenticate = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');
const { createPrescriptionSchema } = require('../validators/prescription.validator');

router.post('/', authenticate, authorizeRoles('doctor'), validate({ body: createPrescriptionSchema }), prescriptionController.createPrescription);
router.get('/my', authenticate, prescriptionController.listMyPrescriptions);
router.get('/:id', authenticate, prescriptionController.getPrescriptionById);

module.exports = router;
