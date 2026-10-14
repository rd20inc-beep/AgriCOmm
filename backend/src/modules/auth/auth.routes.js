const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const authenticate = require('../../middleware/auth');
const { apiLimiter, loginLimiter, passwordResetLimiter } = require('../../middleware/rateLimiter');

// Login — per-IP failed-attempt limiter here + per-account 15-minute lockout in
// the service (captcha guard removed: Cloudflare Turnstile was intermittent).
router.post('/login', loginLimiter, authController.login);
router.post('/register', apiLimiter, authenticate, authController.register);
router.get('/me', authenticate, authController.me);
router.post('/refresh-token', authController.refreshToken);
router.post('/change-password', authenticate, authController.changePassword);
router.post('/forgot-password', passwordResetLimiter, authController.requestPasswordReset);
router.post('/reset-password', passwordResetLimiter, authController.resetPassword);
router.post('/stream-ticket', authenticate, authController.streamTicket);
router.put('/profile', authenticate, authController.updateProfile);

module.exports = router;
