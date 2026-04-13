const authService = require('./auth.service');
const captchaGuard = require('../../middleware/captchaGuard');

const authController = {
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password, req.ip);
      captchaGuard.clearFailures(req.ip);
      return res.json({ success: true, data: result });
    } catch (err) {
      captchaGuard.recordFailure(req.ip);
      const willRequireCaptcha = captchaGuard.getFailureCount(req.ip) >= captchaGuard.FAIL_THRESHOLD;
      res.set('X-Captcha-Required', willRequireCaptcha ? '1' : '0');
      next(err);
    }
  },

  async register(req, res, next) {
    try {
      const result = await authService.register(req.user.role_id, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { token } = req.body;
      const result = await authService.refreshToken(token);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async me(req, res, next) {
    try {
      const result = await authService.getMe(req.user.id);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req, res, next) {
    try {
      const { old_password, new_password } = req.body;
      await authService.changePassword(req.user.id, old_password, new_password, req.ip);
      return res.json({ success: true, message: 'Password changed successfully.' });
    } catch (err) {
      next(err);
    }
  },

  async requestPasswordReset(req, res, next) {
    try {
      await authService.requestPasswordReset(req.body.email, req.ip);
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req, res, next) {
    try {
      const { token, new_password } = req.body;
      await authService.resetPassword(token, new_password, req.ip);
      return res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (err) {
      next(err);
    }
  },

  async updateProfile(req, res, next) {
    try {
      const result = await authService.updateProfile(req.user.id, req.body, req.ip);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = authController;
