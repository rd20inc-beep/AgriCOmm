const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const auditService = require('../services/auditService');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role_id: user.role_id },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

async function fetchPermissions(roleId) {
  const perms = await db('role_permissions as rp')
    .join('permissions as p', 'rp.permission_id', 'p.id')
    .where('rp.role_id', roleId)
    .select('p.module', 'p.action');
  return perms.map((p) => `${p.module}.${p.action}`);
}

const authController = {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required.',
        });
      }

      const user = await db('users as u')
        .leftJoin('roles as r', 'u.role_id', 'r.id')
        .where({ 'u.email': email.toLowerCase() })
        .select('u.*', 'r.name as role_name')
        .first();

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
        });
      }

      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          message: 'Account is deactivated. Contact an administrator.',
        });
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
        });
      }

      // Update last login
      await db('users').where({ id: user.id }).update({ last_login: db.fn.now() });

      const token = generateToken(user);
      const permissions = await fetchPermissions(user.role_id);

      await auditService.log({
        userId: user.id,
        action: 'login',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email },
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role_name,
            role_id: user.role_id,
          },
          permissions,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async register(req, res) {
    try {
      // Only Super Admin can register new users
      const callerRole = await db('roles').where({ id: req.user.role_id }).select('name').first();
      if (!callerRole || callerRole.name !== 'Super Admin') {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can register new users.',
        });
      }

      const { email, password, full_name, role_id } = req.body;

      if (!email || !password || !full_name) {
        return res.status(400).json({
          success: false,
          message: 'Email, password, and full name are required.',
        });
      }

      const existing = await db('users').where({ email: email.toLowerCase() }).first();
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email already exists.',
        });
      }

      // Default to Read-Only Auditor role if no role_id specified
      let assignedRoleId = role_id;
      if (!assignedRoleId) {
        const defaultRole = await db('roles').where({ name: 'Read-Only Auditor' }).first();
        assignedRoleId = defaultRole ? defaultRole.id : null;
      }

      const salt = await bcrypt.genSalt(12);
      const password_hash = await bcrypt.hash(password, salt);

      const [user] = await db('users')
        .insert({
          email: email.toLowerCase(),
          password_hash,
          full_name,
          role_id: assignedRoleId,
          is_active: true,
        })
        .returning(['id', 'email', 'full_name', 'role_id']);

      const token = generateToken(user);

      // Fetch role name and permissions for response
      const role = await db('roles').where({ id: user.role_id }).first();
      const permissions = await fetchPermissions(user.role_id);

      return res.status(201).json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: role ? role.name : null,
            role_id: user.role_id,
          },
          permissions,
        },
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async refreshToken(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token is required.',
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, config.jwt.secret);
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token.',
        });
      }

      const user = await db('users as u')
        .leftJoin('roles as r', 'u.role_id', 'r.id')
        .where({ 'u.id': decoded.id, 'u.is_active': true })
        .select('u.*', 'r.name as role_name')
        .first();

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found or deactivated.',
        });
      }

      const newToken = generateToken(user);
      const permissions = await fetchPermissions(user.role_id);

      return res.json({
        success: true,
        data: {
          token: newToken,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role_name,
            role_id: user.role_id,
          },
          permissions,
        },
      });
    } catch (err) {
      console.error('Refresh token error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async me(req, res) {
    try {
      const user = await db('users as u')
        .leftJoin('roles as r', 'u.role_id', 'r.id')
        .where({ 'u.id': req.user.id })
        .select('u.id', 'u.email', 'u.full_name', 'u.role_id', 'r.name as role', 'u.is_active', 'u.last_login', 'u.created_at')
        .first();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      const permissions = await fetchPermissions(user.role_id);

      return res.json({
        success: true,
        data: {
          user,
          permissions,
        },
      });
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async changePassword(req, res) {
    try {
      const { old_password, new_password } = req.body;

      if (!old_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: 'Old password and new password are required.',
        });
      }

      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters.',
        });
      }

      const user = await db('users').where({ id: req.user.id }).first();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const validOld = await bcrypt.compare(old_password, user.password_hash);
      if (!validOld) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect.',
        });
      }

      const salt = await bcrypt.genSalt(12);
      const password_hash = await bcrypt.hash(new_password, salt);

      await db('users').where({ id: req.user.id }).update({
        password_hash,
        updated_at: db.fn.now(),
      });

      await auditService.log({
        userId: req.user.id,
        action: 'change_password',
        entityType: 'user',
        entityId: req.user.id,
        details: { note: 'Password changed by user' },
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        message: 'Password changed successfully.',
      });
    } catch (err) {
      console.error('Change password error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async requestPasswordReset(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required.',
        });
      }

      const user = await db('users').where({ email: email.toLowerCase() }).first();

      // Always return success to prevent email enumeration
      if (!user) {
        return res.json({
          success: true,
          message: 'If an account with that email exists, a reset token has been generated.',
        });
      }

      // Generate a secure random token
      const token = crypto.randomBytes(32).toString('hex');

      // Expires in 1 hour
      const expires_at = new Date(Date.now() + 60 * 60 * 1000);

      await db('password_reset_tokens').insert({
        user_id: user.id,
        token,
        expires_at,
      });

      await auditService.log({
        userId: user.id,
        action: 'request_password_reset',
        entityType: 'user',
        entityId: user.id,
        details: { email: user.email },
        ipAddress: req.ip,
      });

      // TODO: Send token via email in production (e.g. nodemailer / SES)
      // Token is never exposed in the API response for security.
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    } catch (err) {
      console.error('Request password reset error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async resetPassword(req, res) {
    try {
      const { token, new_password } = req.body;

      if (!token || !new_password) {
        return res.status(400).json({
          success: false,
          message: 'Token and new password are required.',
        });
      }

      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters.',
        });
      }

      const resetToken = await db('password_reset_tokens')
        .where({ token, used: false })
        .where('expires_at', '>', new Date())
        .first();

      if (!resetToken) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token.',
        });
      }

      const salt = await bcrypt.genSalt(12);
      const password_hash = await bcrypt.hash(new_password, salt);

      await db.transaction(async (trx) => {
        await trx('users').where({ id: resetToken.user_id }).update({
          password_hash,
          updated_at: trx.fn.now(),
        });

        await trx('password_reset_tokens').where({ id: resetToken.id }).update({ used: true });
      });

      await auditService.log({
        userId: resetToken.user_id,
        action: 'reset_password',
        entityType: 'user',
        entityId: resetToken.user_id,
        details: { note: 'Password reset via token' },
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        message: 'Password has been reset successfully.',
      });
    } catch (err) {
      console.error('Reset password error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateProfile(req, res) {
    try {
      const { full_name } = req.body;

      if (!full_name) {
        return res.status(400).json({
          success: false,
          message: 'Full name is required.',
        });
      }

      const [user] = await db('users')
        .where({ id: req.user.id })
        .update({ full_name, updated_at: db.fn.now() })
        .returning(['id', 'email', 'full_name', 'role_id']);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      await auditService.log({
        userId: req.user.id,
        action: 'update_profile',
        entityType: 'user',
        entityId: req.user.id,
        details: { full_name },
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        data: { user },
      });
    } catch (err) {
      console.error('Update profile error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = authController;
