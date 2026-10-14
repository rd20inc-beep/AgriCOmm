const authService = require('./auth.service');

// req.ip honours the app's trust-proxy setting; client-supplied headers such as
// cf-connecting-ip are never trusted (they could be forged into the audit log).
function clientIp(req) {
  return req.ip || 'unknown';
}

const authController = {
  async login(req, res, next) {
    try {
      const ip = clientIp(req);
      const { email, password } = req.body;
      const result = await authService.login(email, password, ip);
      return res.json({ success: true, data: result });
    } catch (err) {
      // Captcha guard removed — Cloudflare Turnstile was unreliable.
      // express-rate-limiter remains as the brute-force ceiling.
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
      // The web app sends camelCase (oldPassword/newPassword); accept both.
      const body = req.body || {};
      const oldPassword = body.old_password ?? body.oldPassword;
      const newPassword = body.new_password ?? body.newPassword;
      const result = await authService.changePassword(req.user.id, oldPassword, newPassword, req.ip);
      // Changing the password ends every session; `token` keeps this one going.
      return res.json({ success: true, message: 'Password changed successfully.', data: result });
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
      const body = req.body || {};
      await authService.resetPassword(body.token, body.new_password ?? body.newPassword, req.ip);
      return res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (err) {
      next(err);
    }
  },

  // P1-04: short-lived single-purpose ticket for a stream / attachment URL, so
  // the session token never goes into a query string.
  async streamTicket(req, res, next) {
    try {
      const body = req.body || {};
      const result = authService.issueStreamTicket(req.user, body.purpose, body.resource_id ?? body.resourceId);
      return res.json({ success: true, data: result });
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
