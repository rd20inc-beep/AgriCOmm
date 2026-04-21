const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const authenticate = require('../../middleware/auth');
const { apiLimiter } = require('../../middleware/rateLimiter');
const { requireCaptchaIfFlagged } = require('../../middleware/captchaGuard');

// Login: captcha guards after 3 failed attempts per real client IP
router.post('/login', requireCaptchaIfFlagged, authController.login);
router.post('/register', apiLimiter, authenticate, authController.register);
router.get('/me', authenticate, authController.me);
router.post('/refresh-token', authController.refreshToken);
router.post('/change-password', authenticate, authController.changePassword);
router.post('/forgot-password', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);
router.put('/profile', authenticate, authController.updateProfile);

module.exports = router;
