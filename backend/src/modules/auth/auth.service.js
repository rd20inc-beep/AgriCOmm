const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const repo = require('./auth.repository');
const auditService = require('../../services/auditService');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../shared/errors');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role_id: user.role_id },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
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

    if (!user.is_active) {
      throw new ForbiddenError('Account is deactivated. Contact an administrator.');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }

    await repo.updateLastLogin(user.id);

    const token = generateToken(user);
    const permissions = await repo.getPermissionsForRole(user.role_id);

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
