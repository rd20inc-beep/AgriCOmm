const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const auditService = require('../services/auditService');

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

module.exports = router;
