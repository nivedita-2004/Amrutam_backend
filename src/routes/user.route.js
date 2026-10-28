const express = require('express');
const router = express.Router();
const userController = require('../controller/user.controller');
const validate = require('../middleware/validate.middleware');
const authenticate = require('../middleware/auth.middleware');
const { updateProfileSchema } = require('../validators/user.validator');

router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, validate({ body: updateProfileSchema }), userController.updateProfile);

module.exports = router;
