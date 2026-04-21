const rateLimit = require('express-rate-limit');

function getRealIP(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.ip
    || 'unknown';
}

// General API limiter: 200 requests per minute per real client IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRealIP,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

module.exports = { apiLimiter };
