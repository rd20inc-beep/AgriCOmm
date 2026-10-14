const rateLimit = require('express-rate-limit');

// All limiters key on req.ip (the express-rate-limit default). req.ip honours the
// app's `trust proxy` setting (config.trustProxy), so it is the address of the
// first untrusted hop — never a client-supplied header such as cf-connecting-ip or
// X-Real-IP, which a caller could set to pick (or rotate) its own bucket.

// General API limiter: 200 requests per minute per client IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

// Login: per-IP ceiling on FAILED sign-ins (successful ones don't count, so a busy
// office sharing one address is not throttled by its own normal logins). The
// per-account lockout lives in the auth service.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'too_many_attempts',
    message: 'Too many sign-in attempts from this network. Please try again in 15 minutes.',
  },
});

// Forgot / reset password: each call may send an email, so keep it tight.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password-reset requests. Please try again later.',
  },
});

// Employee-portal login (P1-07): per-IP ceiling on FAILED sign-ins, successful
// ones not counted. A whole mill can sit behind one address, so this is a brake on
// top of the per-worker lockout, not the lockout itself.
const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.',
  },
});

module.exports = { apiLimiter, loginLimiter, passwordResetLimiter, portalLoginLimiter };
