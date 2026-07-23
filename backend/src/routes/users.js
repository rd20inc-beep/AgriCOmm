const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/database');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const auditService = require('../services/auditService');

// GET /api/users/owners — active Owner users, for the approval owner-picker.
// Open to any authenticated user (just id + name) so a non-owner approver can
// name which owner authorized the action. Declared BEFORE '/:id' so it isn't
// swallowed by the id route.
router.get('/owners', async (req, res) => {
  try {
    const owners = await db('users as u')
      .join('roles as r', 'r.id', 'u.role_id')
      .where('r.name', 'Owner')
      .where('u.is_active', true)
      .select('u.id', 'u.full_name')
      .orderBy('u.full_name');
    return res.json({ success: true, data: { owners } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/users — list users with role names, pagination
router.get('/', authorize('admin', 'view'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role_id, is_active } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('users as u')
      .leftJoin('roles as r', 'u.role_id', 'r.id')
      .select(
        'u.id',
        'u.email',
        'u.full_name',
        'u.role_id',
        'r.name as role_name',
        'u.is_active',
        'u.status',
        'u.force_password_change',
        'u.locked_at',
        'u.last_login',
        'u.created_at'
      );

    if (search) {
      query = query.where(function () {
        this.whereILike('u.full_name', `%${search}%`).orWhereILike('u.email', `%${search}%`);
      });
    }

    if (role_id) {
      query = query.where('u.role_id', role_id);
    }

    if (is_active !== undefined) {
      query = query.where('u.is_active', is_active === 'true');
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('u.id as total').first();

    const [users, countResult] = await Promise.all([
      query.orderBy('u.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/users/:id — user detail with permissions list
router.get('/:id', authorize('admin', 'view'), async (req, res) => {
  try {
    const user = await db('users as u')
      .leftJoin('roles as r', 'u.role_id', 'r.id')
      .where('u.id', req.params.id)
      .select(
        'u.id',
        'u.email',
        'u.full_name',
        'u.role_id',
        'r.name as role_name',
        'u.is_active',
        'u.last_login',
        'u.created_at',
        'u.updated_at'
      )
      .first();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Fetch permissions for this user's role
    const permissions = await db('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .where('rp.role_id', user.role_id)
      .select('p.module', 'p.action', 'p.description');

    return res.json({
      success: true,
      data: {
        user,
        permissions: permissions.map((p) => ({
          key: `${p.module}.${p.action}`,
          module: p.module,
          action: p.action,
          description: p.description,
        })),
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/users — create/invite user (admin only)
router.post(
  '/',
  authorize('admin', 'manage_users'),
  auditAction('create_user', 'user', (req, data) => data.data && data.data.user ? data.data.user.id : null),
  async (req, res) => {
    try {
      const { email, password, full_name, role_id } = req.body;

      if (!email || !password || !full_name || !role_id) {
        return res.status(400).json({
          success: false,
          message: 'Email, password, full name, and role_id are required.',
        });
      }

      const existing = await db('users').where({ email: email.toLowerCase() }).first();
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email already exists.',
        });
      }

      // Verify role exists
      const role = await db('roles').where({ id: role_id }).first();
      if (!role) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role_id.',
        });
      }

      const salt = await bcrypt.genSalt(12);
      const password_hash = await bcrypt.hash(password, salt);

      const [user] = await db('users')
        .insert({
          email: email.toLowerCase(),
          password_hash,
          full_name,
          role_id,
          is_active: true,
          status: 'active',
          // #9 New accounts must set their own password on first sign-in.
          force_password_change: req.body.force_password_change !== false,
          password_changed_at: db.fn.now(),
        })
        .returning(['id', 'email', 'full_name', 'role_id', 'is_active', 'created_at']);

      return res.status(201).json({
        success: true,
        data: { user: { ...user, role_name: role.name } },
      });
    } catch (err) {
      console.error('Create user error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// PUT /api/users/:id — update user (admin only)
router.put(
  '/:id',
  authorize('admin', 'manage_users'),
  auditAction('update_user', 'user', (req) => req.params.id),
  async (req, res) => {
    try {
      const updates = {};
      const allowedFields = ['email', 'full_name', 'role_id', 'is_active'];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (updates.email) {
        updates.email = updates.email.toLowerCase();
      }

      updates.updated_at = db.fn.now();

      const [user] = await db('users')
        .where({ id: req.params.id })
        .update(updates)
        .returning(['id', 'email', 'full_name', 'role_id', 'is_active']);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const role = await db('roles').where({ id: user.role_id }).first();

      return res.json({
        success: true,
        data: { user: { ...user, role_name: role ? role.name : null } },
      });
    } catch (err) {
      console.error('Update user error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// PUT /api/users/:id/role — change user role (admin only)
router.put('/:id/role', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const { role_id } = req.body;

    if (!role_id) {
      return res.status(400).json({ success: false, message: 'role_id is required.' });
    }

    const role = await db('roles').where({ id: role_id }).first();
    if (!role) {
      return res.status(400).json({ success: false, message: 'Invalid role_id.' });
    }

    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const oldRoleId = user.role_id;

    await db('users').where({ id: req.params.id }).update({
      role_id,
      updated_at: db.fn.now(),
    });

    await auditService.log({
      userId: req.user.id,
      action: 'change_role',
      entityType: 'user',
      entityId: req.params.id,
      details: { old_role_id: oldRoleId, new_role_id: role_id, new_role_name: role.name },
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role_id,
          role_name: role.name,
        },
      },
    });
  } catch (err) {
    console.error('Change role error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/users/:id/deactivate — deactivate user (admin only)
router.put('/:id/deactivate', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Prevent deactivating yourself
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    await db('users').where({ id: req.params.id }).update({
      is_active: false,
      status: 'deactivated', // #9 lifecycle
      updated_at: db.fn.now(),
    });

    await auditService.log({
      userId: req.user.id,
      action: 'deactivate_user',
      entityType: 'user',
      entityId: req.params.id,
      details: { email: user.email, full_name: user.full_name },
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `User ${user.full_name} has been deactivated.`,
    });
  } catch (err) {
    console.error('Deactivate user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/users/:id/activate — activate user (admin only)
router.put('/:id/activate', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await db('users').where({ id: req.params.id }).update({
      is_active: true,
      status: 'active', // #9 reactivate clears any suspended/locked/deactivated state
      locked_at: null,
      failed_login_count: 0,
      updated_at: db.fn.now(),
    });

    await auditService.log({
      userId: req.user.id,
      action: 'activate_user',
      entityType: 'user',
      entityId: req.params.id,
      details: { email: user.email, full_name: user.full_name },
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `User ${user.full_name} has been activated.`,
    });
  } catch (err) {
    console.error('Activate user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/users/:id/password — admin sets/resets a user's password
router.put('/:id/password', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(String(password), salt);
    // #9 An admin-set password is TEMPORARY — force the user to choose their own
    // on next sign-in (unless the admin explicitly opts out).
    const force = req.body.force_password_change !== false;
    await db('users').where({ id: req.params.id }).update({
      password_hash, force_password_change: force, password_changed_at: db.fn.now(), updated_at: db.fn.now(),
    });

    await auditService.log({
      userId: req.user.id, action: 'reset_user_password', entityType: 'user',
      entityId: req.params.id, details: { email: user.email, force_password_change: force }, ipAddress: req.ip,
    });
    return res.json({ success: true, message: `Password updated for ${user.full_name}.${force ? ' The user must set a new password at next sign-in.' : ''}` });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE /api/users/:id — permanently remove a user (admin). Blocked for your own
// account, and for a user referenced by activity elsewhere (FK) — deactivate then.
router.delete('/:id', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    try {
      await db('users').where({ id: req.params.id }).del();
    } catch (e) {
      // Postgres FK violation — the user is referenced (created_by, approvals, …).
      if (e.code === '23503') {
        return res.status(409).json({
          success: false,
          message: 'This user has activity recorded in the system and cannot be permanently deleted. Deactivate the account instead.',
        });
      }
      throw e;
    }

    await auditService.log({
      userId: req.user.id, action: 'delete_user', entityType: 'user',
      entityId: req.params.id, details: { email: user.email, full_name: user.full_name }, ipAddress: req.ip,
    });
    return res.json({ success: true, message: `User ${user.full_name} has been deleted.` });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/users/:id/activity — get audit logs for this user
router.get('/:id/activity', authorize('admin', 'view'), async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logs = await auditService.getByUser(parseInt(req.params.id), parseInt(limit));

    return res.json({
      success: true,
      data: { logs },
    });
  } catch (err) {
    console.error('Get user activity error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ── #9 Account lifecycle + security actions ──────────────────────────────────
const LIFECYCLE_STATUSES = ['invited', 'active', 'suspended', 'locked', 'deactivated'];

// PUT /api/users/:id/status — move a user through the lifecycle (suspend / lock /
// unlock / reactivate / etc.). Keeps is_active in sync for legacy readers.
router.put('/:id/status', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!LIFECYCLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${LIFECYCLE_STATUSES.join(', ')}.` });
    }
    if (parseInt(req.params.id) === req.user.id && status !== 'active') {
      return res.status(400).json({ success: false, message: 'You cannot suspend, lock or deactivate your own account.' });
    }
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const patch = {
      status,
      is_active: (status === 'active' || status === 'invited'),
      locked_at: status === 'locked' ? db.fn.now() : null,
      updated_at: db.fn.now(),
    };
    if (status === 'active') patch.failed_login_count = 0; // reactivating clears the lockout counter
    await db('users').where({ id: req.params.id }).update(patch);

    await auditService.log({
      userId: req.user.id, action: 'set_user_status', entityType: 'user',
      entityId: req.params.id, details: { email: user.email, from: user.status, to: status }, ipAddress: req.ip,
    });
    return res.json({ success: true, message: `${user.full_name} is now ${status}.` });
  } catch (err) {
    console.error('Set user status error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/users/:id/force-password-change — require a password reset next sign-in.
router.put('/:id/force-password-change', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const force = req.body.force !== false;
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await db('users').where({ id: req.params.id }).update({ force_password_change: force, updated_at: db.fn.now() });
    await auditService.log({
      userId: req.user.id, action: 'force_password_change', entityType: 'user',
      entityId: req.params.id, details: { email: user.email, force }, ipAddress: req.ip,
    });
    return res.json({ success: true, message: force ? `${user.full_name} must set a new password at next sign-in.` : `Cleared the forced password change for ${user.full_name}.` });
  } catch (err) {
    console.error('Force password change error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/users/:id/reset-link — issue a password-reset token (admin never sees
// the password). Returns the link so the admin can share it; also reuses the
// existing password_reset_tokens table + /auth reset flow.
router.post('/:id/reset-link', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await db('password_reset_tokens').insert({ user_id: user.id, token, expires_at: expiresAt, used: false });
    await auditService.log({
      userId: req.user.id, action: 'issue_reset_link', entityType: 'user',
      entityId: req.params.id, details: { email: user.email }, ipAddress: req.ip,
    });
    const link = `/reset-password?token=${token}`;
    return res.json({ success: true, data: { token, link, expires_at: expiresAt }, message: `Reset link generated for ${user.full_name} (valid 24h).` });
  } catch (err) {
    console.error('Issue reset link error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/users/:id/revoke-sessions — invalidate all of a user's active logins
// by bumping token_version (every issued JWT carries the version; auth middleware
// rejects a stale one).
router.post('/:id/revoke-sessions', authorize('admin', 'manage_users'), async (req, res) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await db('users').where({ id: req.params.id }).update({ token_version: (parseInt(user.token_version, 10) || 0) + 1, updated_at: db.fn.now() });
    await auditService.log({
      userId: req.user.id, action: 'revoke_user_sessions', entityType: 'user',
      entityId: req.params.id, details: { email: user.email }, ipAddress: req.ip,
    });
    return res.json({ success: true, message: `All active sessions for ${user.full_name} have been signed out.` });
  } catch (err) {
    console.error('Revoke sessions error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
