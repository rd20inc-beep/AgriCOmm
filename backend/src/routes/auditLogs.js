const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authorize = require('../middleware/rbac');

// GET /api/audit-logs — list recent audit logs (admin only) with filters
router.get('/', authorize('admin', 'view'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      user_id,
      entity_type,
      action,
      date_from,
      date_to,
    } = req.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .select(
        'a.id',
        'a.user_id',
        'u.full_name as user_name',
        'u.email as user_email',
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.details',
        'a.ip_address',
        'a.created_at'
      );

    if (user_id) {
      query = query.where('a.user_id', user_id);
    }

    if (entity_type) {
      query = query.where('a.entity_type', entity_type);
    }

    if (action) {
      query = query.where('a.action', action);
    }

    if (date_from) {
      query = query.where('a.created_at', '>=', new Date(date_from));
    }

    if (date_to) {
      query = query.where('a.created_at', '<=', new Date(date_to));
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('a.id as total').first();

    const [logs, countResult] = await Promise.all([
      query.orderBy('a.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    console.error('List audit logs error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/audit-logs/entity/:type/:id — audit log for specific entity
router.get('/entity/:type/:id', authorize('admin', 'view'), async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const logs = await db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where({ 'a.entity_type': req.params.type, 'a.entity_id': String(req.params.id) })
      .select(
        'a.id',
        'a.user_id',
        'u.full_name as user_name',
        'u.email as user_email',
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.details',
        'a.ip_address',
        'a.created_at'
      )
      .orderBy('a.created_at', 'desc')
      .limit(parseInt(limit));

    return res.json({
      success: true,
      data: { logs },
    });
  } catch (err) {
    console.error('Get entity audit logs error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
