const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const db = require('../../config/database');
const repo = require('./auth.repository');
const auditService = require('../../services/auditService');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../shared/errors');

const MAX_FAILED_LOGINS = 5; // #9 auto-lock threshold

function generateToken(user) {
  return jwt.sign(
    // token_version lets an admin revoke all of a user's sessions by bumping it
    // (middleware/auth rejects tokens whose tv is stale). Defaults to 0.
    { id: user.id, email: user.email, role_id: user.role_id, tv: user.token_version || 0 },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

// #9 Human-readable block message for a non-loginable account status.
function statusBlockMessage(status) {
  switch (status) {
    case 'deactivated': return 'Account is deactivated. Contact an administrator.';
    case 'suspended': return 'Account is suspended. Contact an administrator.';
    case 'locked': return 'Account is locked after too many failed sign-ins. Contact an administrator.';
    case 'invited': return 'Account invitation is pending — set your password via the invite link.';
    default: return 'Account is not permitted to sign in. Contact an administrator.';
  }
}

const authService = {
  async login(email, password, ipAddress) {
    if (!email || !password) {
      throw new ValidationError('Email and password are required.');
    }

    const user = await repo.findUserByEmail(email);
    if (!user) {
      throw new NotFoundError('Invalid email or password.');
      // Use generic message to prevent enumeration
    }

    // #9 Status lifecycle gate — only 'active' may sign in (falls back to the
    // is_active boolean for any row that predates the status backfill).
    const status = user.status || (user.is_active ? 'active' : 'deactivated');
    if (status !== 'active') {
      throw new ForbiddenError(statusBlockMessage(status));
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      // #9 Track failed attempts and auto-lock after MAX_FAILED_LOGINS.
      const failed = (parseInt(user.failed_login_count, 10) || 0) + 1;
      const patch = { failed_login_count: failed, updated_at: db.fn.now() };
      if (failed >= MAX_FAILED_LOGINS) { patch.status = 'locked'; patch.is_active = false; patch.locked_at = db.fn.now(); }
      await db('users').where({ id: user.id }).update(patch);
      const err = new Error(failed >= MAX_FAILED_LOGINS
        ? 'Account locked after too many failed sign-ins. Contact an administrator.'
        : 'Invalid email or password.');
      err.statusCode = failed >= MAX_FAILED_LOGINS ? 403 : 401;
      throw err;
    }

    // Success → clear the failed-attempt counter + stamp last_login.
    await db('users').where({ id: user.id }).update({ failed_login_count: 0, last_login: db.fn.now() });

    const token = generateToken(user);
    const permissions = await repo.getPermissionsForRole(user.role_id);
    const mobileNav = await repo.getMobileNavForRole(user.role_id);

    await auditService.log({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role_name,
        role_id: user.role_id,
        mobileNav,
        // #9 FE redirects to the change-password page when this is set.
        force_password_change: !!user.force_password_change,
      },
      permissions,
    };
  },

  async register(callerRoleId, { email, password, full_name, role_id }) {
    // Only Super Admin can register
    const callerRole = await repo.getRoleName(callerRoleId);
    if (callerRole !== 'Super Admin') {
      throw new ForbiddenError('Only administrators can register new users.');
    }

    if (!email || !password || !full_name) {
      throw new ValidationError('Email, password, and full name are required.');
    }

    const existing = await repo.findUserByEmail(email);
    if (existing) {
      throw new ConflictError('A user with this email already exists.');
    }

    let assignedRoleId = role_id;
    if (!assignedRoleId) {
      const defaultRole = await repo.getRoleByName('Read-Only Auditor');
      assignedRoleId = defaultRole ? defaultRole.id : null;
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    const user = await repo.createUser(null, { email, password_hash, full_name, role_id: assignedRoleId });

    const token = generateToken(user);
    const roleName = await repo.getRoleName(user.role_id);
    const permissions = await repo.getPermissionsForRole(user.role_id);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: roleName,
        role_id: user.role_id,
      },
      permissions,
    };
  },

  async refreshToken(token) {
    if (!token) {
      throw new ValidationError('Token is required.');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      const error = new Error('Invalid or expired token.');
      error.statusCode = 401;
      throw error;
    }

    const user = await repo.findUserById(decoded.id);
    if (!user || !user.is_active) {
      const error = new Error('User not found or deactivated.');
      error.statusCode = 401;
      throw error;
    }

    const newToken = generateToken(user);
    const permissions = await repo.getPermissionsForRole(user.role_id);

    return {
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role_name,
        role_id: user.role_id,
      },
      permissions,
    };
  },

  async getMe(userId) {
    const user = await repo.getUserProfile(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const permissions = await repo.getPermissionsForRole(user.role_id);
    user.mobileNav = await repo.getMobileNavForRole(user.role_id);
    return { user, permissions };
  },

  async changePassword(userId, oldPassword, newPassword, ipAddress) {
    if (!oldPassword || !newPassword) {
      throw new ValidationError('Old password and new password are required.');
    }

    if (newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters.');
    }

    const user = await repo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const validOld = await bcrypt.compare(oldPassword, user.password_hash);
    if (!validOld) {
      throw new ValidationError('Current password is incorrect.');
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(newPassword, salt);

    await repo.updatePassword(userId, password_hash);
    // #9 Clear the forced-change flag once the user has set their own password.
    await db('users').where({ id: userId }).update({ force_password_change: false, password_changed_at: db.fn.now() });

    await auditService.log({
      userId,
      action: 'change_password',
      entityType: 'user',
      entityId: userId,
      details: { note: 'Password changed by user' },
      ipAddress,
    });
  },

  async requestPasswordReset(email, ipAddress) {
    if (!email) {
      throw new ValidationError('Email is required.');
    }

    const user = await repo.findUserByEmail(email);

    // Always return success to prevent enumeration
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await repo.createPasswordResetToken(user.id, token, expiresAt);

    await auditService.log({
      userId: user.id,
      action: 'request_password_reset',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress,
    });
  },

  async resetPassword(token, newPassword, ipAddress) {
    if (!token || !newPassword) {
      throw new ValidationError('Token and new password are required.');
    }

    if (newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters.');
    }

    const resetToken = await repo.findValidResetToken(token);
    if (!resetToken) {
      throw new ValidationError('Invalid or expired reset token.');
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(newPassword, salt);

    await repo.resetPasswordInTransaction(resetToken.user_id, password_hash, resetToken.id);

    await auditService.log({
      userId: resetToken.user_id,
      action: 'reset_password',
      entityType: 'user',
      entityId: resetToken.user_id,
      details: { note: 'Password reset via token' },
      ipAddress,
    });
  },

  async updateProfile(userId, { full_name }, ipAddress) {
    if (!full_name) {
      throw new ValidationError('Full name is required.');
    }

    const user = await repo.updateProfile(userId, { full_name });
    if (!user) {
      throw new NotFoundError('User not found.');
    }

    await auditService.log({
      userId,
      action: 'update_profile',
      entityType: 'user',
      entityId: userId,
      details: { full_name },
      ipAddress,
    });

    return { user };
  },
};

module.exports = authService;
