const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const availabilityController = require('../controller/availability.controller');
const authenticate = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

const optionalAuth = (req, res, next) => {
  try {
    let token = null;
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id && decoded.role) {
        req.user = { id: decoded.id, role: decoded.role };
      }
    }
  } catch (err) {
    // Silently continue for public routes
  }
  next();
};

// Public / Patient / Doctor slot browsing
router.get('/', optionalAuth, availabilityController.listSlots);
router.get('/doctor/:doctorId', optionalAuth, (req, res, next) => {
  if (req.params?.doctorId !== undefined) {
    const queryObj = Object.assign({}, req.query, { doctor_id: req.params.doctorId });
    Object.defineProperty(req, 'query', {
      value: queryObj,
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
  return availabilityController.listSlots(req, res, next);
});
router.get('/:id', availabilityController.getSlotById);

// Doctor availability management
router.post('/', authenticate, authorizeRoles('doctor'), availabilityController.createSlot);
router.patch('/:id', authenticate, authorizeRoles('doctor'), availabilityController.updateSlot);
router.delete('/:id', authenticate, authorizeRoles('doctor'), availabilityController.deleteSlot);

module.exports = router;
