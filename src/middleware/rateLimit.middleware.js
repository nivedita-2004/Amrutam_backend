const rateLimit = require('express-rate-limit');

const defaultWindowMs =
  Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) ||
  15 * 60 * 1000;

const createLimiter = (optionsOrLimit, customMessage) => {
  let opts = {};
  if (typeof optionsOrLimit === 'object' && optionsOrLimit !== null) {
    opts = optionsOrLimit;
  } else {
    opts = { limit: optionsOrLimit, message: customMessage };
  }

  const winMs = opts.windowMs || defaultWindowMs;
  const lim = opts.limit || (Number.parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) || 200);
  const msg = opts.message || 'Too many requests. Please try again later.';

  return rateLimit({
    windowMs: winMs,
    limit: lim,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      statusCode: 429,
      message: msg
    },
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        statusCode: 429,
        message: msg,
        requestId: req.id
      });
    }
  });
};

module.exports = {
  createLimiter,
  apiLimiter: createLimiter(
    Number.parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) || 200,
    'Too many requests to the API. Please try again later.'
  ),

  loginLimiter: createLimiter(
    Number.parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10) || 10,
    'Too many login attempts. Please try again later.'
  ),

  signupLimiter: createLimiter(
    Number.parseInt(process.env.RATE_LIMIT_SIGNUP_MAX, 10) || 10,
    'Too many account creation attempts. Please try again later.'
  ),

  refreshLimiter: createLimiter(
    Number.parseInt(process.env.RATE_LIMIT_REFRESH_MAX, 10) || 30,
    'Too many token refresh attempts. Please try again later.'
  ),

  passwordResetLimiter: createLimiter(
    Number.parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX, 10) || 5,
    'Too many password reset requests. Please try again later.'
  )
};