const express = require('express');
const router = express.Router();
const doctorController = require('../controller/doctor.controller');
const validate = require('../middleware/validate.middleware');
const authenticate = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');
const optionalAuth = require('../middleware/optionalAuth.middleware');
const { doctorProfileSchema } = require('../validators/doctor.validator');

router.get('/', doctorController.listDoctors);
router.get('/profile', authenticate, authorizeRoles('doctor'), doctorController.getMyDoctorProfile);
router.put('/profile', authenticate, authorizeRoles('doctor'), validate({ body: doctorProfileSchema }), doctorController.updateDoctorProfile);
router.get('/:id', optionalAuth, doctorController.getDoctorById);

module.exports = router;
