const jwt = require('jsonwebtoken');

const optionalAuth = (req, res, next) => {
  try {
    let token = null;
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
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

module.exports = optionalAuth;
