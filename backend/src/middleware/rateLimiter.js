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

// Employee-portal login limiter (P1-07): 30 attempts per 15 minutes per client
// IP, successful logins not counted. A whole mill can sit behind one IP, so
// this is a brute-force brake on top of the per-worker lockout, not the lockout.
const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: getRealIP,
  message: {
    success: false,
    message: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.',
  },
});

module.exports.portalLoginLimiter = portalLoginLimiter;
