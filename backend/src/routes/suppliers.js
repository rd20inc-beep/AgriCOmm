const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/suppliers
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('suppliers');

    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

    const [suppliers, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return res.json({
      success: true,
      data: {
        suppliers,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    console.error('List suppliers error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/suppliers/:id
router.get('/:id', async (req, res) => {
  try {
    const supplier = await db('suppliers').where({ id: req.params.id }).first();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found.' });
    }
    return res.json({ success: true, data: { supplier } });
  } catch (err) {
    console.error('Get supplier error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
