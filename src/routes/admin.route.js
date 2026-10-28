const express = require('express');
const router = express.Router();
const adminController = require('../controller/admin.controller');
const authenticate = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

router.get('/metrics', authenticate, authorizeRoles('admin'), adminController.getMetrics);
router.get('/doctors/pending', authenticate, authorizeRoles('admin'), adminController.listPendingDoctors);
router.patch('/doctors/:id/verify', authenticate, authorizeRoles('admin'), adminController.verifyDoctor);

module.exports = router;
