const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    Number.isInteger(err.statusCode) &&
    err.statusCode >= 400 &&
    err.statusCode <= 599
      ? err.statusCode
      : Number.isInteger(err.status) &&
          err.status >= 400 &&
          err.status <= 599
        ? err.status
        : 500;

  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error(
      {
        requestId: req.id,
        method: req.method,
        url: req.path,
        err
      },
      'Server error'
    );
  } else {
    logger.warn(
      {
        requestId: req.id,
        method: req.method,
        url: req.path,
        statusCode,
        message: err.message
      },
      'Request error'
    );
  }

  const message = isServerError
    ? 'An unexpected error occurred. Please try again later.'
    : err.message || 'Request failed';

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    requestId: req.id,
    ...(Array.isArray(err.errors) && err.errors.length > 0
      ? { errors: err.errors }
      : {})
  });
};

module.exports = errorHandler;