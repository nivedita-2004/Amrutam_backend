const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.'
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return next(new Error('JWT_SECRET is not configured'));
  }

  try {
    const decoded = jwt.verify(token, secret);

    if (!decoded.id || !decoded.role) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.'
      });
    }

    // Reject refresh tokens used on access-token protected routes
    if (decoded.tokenType && decoded.tokenType !== 'access') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type. Access token required.'
      });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.'
      });
    }

    next(err);
  }
};

module.exports = authenticate;