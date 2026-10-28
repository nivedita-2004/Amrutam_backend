const crypto = require('crypto');

const requestIdMiddleware = (req, res, next) => {
  const incomingId = req.get('X-Request-Id');

  const isValidId =
    typeof incomingId === 'string' &&
    incomingId.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(incomingId);

  req.id = isValidId ? incomingId : crypto.randomUUID();

  res.setHeader('X-Request-Id', req.id);

  next();
};

module.exports = requestIdMiddleware;