const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const db = require('../../config/database');
const repo = require('./auth.repository');
const auditService = require('../../services/auditService');
const throttle = require('./loginThrottle');
const { issueTicket } = require('../../middleware/authEventSource');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../shared/errors');

const MAX_FAILED_LOGINS = throttle.MAX_FAILURES; // #9 lockout threshold (5)
const LOCKOUT_MS = throttle.LOCKOUT_MS;           // P1-10 lockout length (15 min)
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// One message for unknown email AND wrong password (no account enumeration).
function invalidCredentials() {
  const err = new Error('Invalid email or password.');
  err.statusCode = 401;
  return err;
}
function tooManyAttempts() {
  const err = new Error('Too many failed sign-in attempts. Please wait 15 minutes, or reset your password.');
  err.statusCode = 429;
  return err;
}

// A bcrypt hash compared against when the email is unknown, so both paths cost
// the same time.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('not-a-real-password', 12);
  return dummyHashPromise;
}

// Status 'locked' set by the OLD rule (lock until an admin acts) carries the
// failure counter at the threshold; an admin's deliberate lock does not. Those
// legacy auto-locks now expire like the new time-based lockout.
function isLegacyAutoLock(user) {
  return user.status === 'locked'
    && (parseInt(user.failed_login_count, 10) || 0) >= MAX_FAILED_LOGINS
    && !!user.locked_at && (new Date(user.locked_at).getTime() + LOCKOUT_MS) <= Date.now();
}

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
    case 'locked': return 'Account is locked. Contact an administrator.';
    case 'invited': return 'Account invitation is pending — set your password via the invite link.';
    default: return 'Account is not permitted to sign in. Contact an administrator.';
  }
}

// The reset link goes to the configured app URL (never the request's Host) with
// the token in the #fragment, which browsers don't send to servers — so it
// never lands in an access log. The email body logged to email_logs is redacted.
function resetLink(token) {
  return `${config.appUrl}/reset-password#token=${token}`;
}

async function sendResetEmail(user, token) {
  if (!config.smtp.user) {
    console.warn('password reset requested but SMTP is not configured — no email sent');
    return;
  }
  // Lazy: keeps nodemailer out of the login path / unit tests.
  const emailService = require('../communications/email.service');
  const link = resetLink(token);
  const subject = 'Reset your AgriRice password';
  const html = (href) => `<p>Hello ${String(user.full_name || '').replace(/[<>&"]/g, '')},</p>`
    + '<p>We received a request to reset your password. This link works once and expires in 1 hour:</p>'
    + `<p><a href="${href}">${href}</a></p>`
    + '<p>If you did not ask for this, ignore this email — your password stays the same.</p>';
  let status = 'Sent';
  let errorMessage = null;
  try {
    await emailService.getTransporter().sendMail({
      from: `${config.smtp.senderName} <${config.smtp.senderEmail}>`,
      to: user.email,
      subject,
      html: html(link),
    });
  } catch (e) {
    status = 'Failed';
    errorMessage = e.message;
  }
  await db('email_logs').insert({
    from_email: config.smtp.senderEmail, to_email: user.email, subject,
    body: html('[reset link redacted]'), template_used: 'password_reset',
    linked_type: 'user', linked_id: user.id, status, error_message: errorMessage, sent_by: null,
  }).catch(() => {});
}

const authService = {
  async login(email, password, ipAddress) {
    if (!email || !password) {
      throw new ValidationError('Email and password are required.');
    }

    // Per-account throttle — applies identically to unknown emails.
    if (throttle.isLocked(email)) throw tooManyAttempts();

    const user = await repo.findUserByEmail(email);
    if (!user) {
      await bcrypt.compare(String(password), await dummyHash());
      throw throttle.recordFailure(email) ? tooManyAttempts() : invalidCredentials();
    }

    // P1-10 time-based lockout (users.locked_until) — refused even with the right
    // password until it expires.
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw tooManyAttempts();
    }

    const validPassword = await bcrypt.compare(String(password), user.password_hash);
    if (!validPassword) {
      // Track failed attempts; the 5th starts a 15-minute lockout and resets the
      // counter (the account itself stays 'active' — no admin needed).
      const failed = (parseInt(user.failed_login_count, 10) || 0) + 1;
      const patch = { failed_login_count: failed, updated_at: db.fn.now() };
      const locks = failed >= MAX_FAILED_LOGINS;
      if (locks) { patch.locked_until = new Date(Date.now() + LOCKOUT_MS); patch.failed_login_count = 0; }
      await db('users').where({ id: user.id }).update(patch);
      const memLocked = throttle.recordFailure(email);
      throw (locks || memLocked) ? tooManyAttempts() : invalidCredentials();
    }

    // #9 Status lifecycle gate — only 'active' may sign in (falls back to the
    // is_active boolean for any row that predates the status backfill). Checked
    // only AFTER the password matched, so it reveals nothing to a guesser.
    const legacyLockExpired = isLegacyAutoLock(user);
    const status = legacyLockExpired ? 'active'
      : (user.status || (user.is_active ? 'active' : 'deactivated'));
    if (status !== 'active') {
      throw new ForbiddenError(statusBlockMessage(status));
    }

    // Success → clear the failed-attempt counter + lockout, stamp last_login.
    const success = { failed_login_count: 0, locked_until: null, last_login: db.fn.now() };
    if (legacyLockExpired) Object.assign(success, { status: 'active', is_active: true, locked_at: null });
    await db('users').where({ id: user.id }).update(success);
    throttle.clear(email);

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

    // Same rules as every authenticated request: portal/ticket tokens are not
    // session tokens, and a suspended/locked/inactive user or a revoked session
    // (stale token_version) can't mint a fresh token.
    if (!decoded || decoded.portal || decoded.typ) {
      const error = new Error('Invalid or expired token.');
      error.statusCode = 401;
      throw error;
    }
    const user = await repo.findUserById(decoded.id);
    const status = user && (user.status || (user.is_active ? 'active' : 'deactivated'));
    if (!user || status !== 'active' || (decoded.tv || 0) !== (user.token_version || 0)) {
      const error = new Error('Session is no longer valid. Please sign in again.');
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

    // Ends every session (token_version bump), including this one — a fresh
    // token for the caller is returned below so they stay signed in here.
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

    const fresh = await repo.findUserById(userId);
    return { token: generateToken(fresh) };
  },

  async requestPasswordReset(email, ipAddress) {
    if (!email) {
      throw new ValidationError('Email is required.');
    }

    const user = await repo.findUserByEmail(String(email));

    // Always return success to prevent enumeration; suspended/deactivated
    // accounts get no link (an admin must reinstate them first).
    if (!user) return;
    const status = user.status || (user.is_active ? 'active' : 'deactivated');
    if (status === 'suspended' || status === 'deactivated') return;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await repo.createPasswordResetToken(user.id, token, expiresAt);

    // Fire-and-forget so the response time doesn't reveal whether the email
    // exists; a send failure is logged, never surfaced.
    sendResetEmail(user, token).catch((e) => console.error('password reset email failed:', e.message));

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

    const resetToken = await repo.findValidResetToken(String(token));
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
    const u = await repo.findUserById(resetToken.user_id);
    if (u) throttle.clear(u.email);
  },

  // P1-04: a short-lived single-purpose ticket for a stream / attachment URL.
  issueStreamTicket(user, purpose, resourceId) {
    return issueTicket(user, purpose, resourceId);
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
module.exports.resetLink = resetLink;
