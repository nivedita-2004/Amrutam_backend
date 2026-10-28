const express = require('express');
const router = express.Router();
const authController = require('../controller/auth.controller');
const validate = require('../middleware/validate.middleware');
const authenticate = require('../middleware/auth.middleware');
const { signupSchema, loginSchema } = require('../validators/auth.validator');
const { loginLimiter, signupLimiter, refreshLimiter } = require('../middleware/rateLimit.middleware');

/**
 * Authentication Routes
 * Mounted at /api/auth in app.js
 */
router.post('/signup', signupLimiter, validate({ body: signupSchema }), authController.signup);
router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', refreshLimiter, authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);

module.exports = router;
