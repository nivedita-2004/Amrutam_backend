const auditQuery = require('../query/audit.query');
const logger = require('../utils/logger');

const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }

  if (!allowedRoles.includes(req.user.role)) {
    auditQuery.recordAuditLog({
      actorUserId: req.user.id,
      action: 'AUTH_ACCESS_DENIED',
      entityType: 'endpoint',
      entityId: null,
      requestId: req.id,
      metadata: {
        requiredRoles: allowedRoles,
        userRole: req.user.role,
        url: req.path,
        method: req.method,
        ip: req.ip
      }
    }).catch((err) => {
      logger.error({ err, requestId: req.id }, 'Failed to record authorization denial');
    });

    return res.status(403).json({
      success: false,
      message: 'You do not have permission to access this resource.'
    });
  }

  next();
};

module.exports = authorizeRoles;