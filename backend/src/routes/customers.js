const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, country } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('customers');

    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`).orWhereILike('email', `%${search}%`);
      });
    }
    if (country) {
      query = query.where('country', country);
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

    const [customers, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return res.json({
      success: true,
      data: {
        customers,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    console.error('List customers error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const customer = await db('customers').where({ id: req.params.id }).first();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    return res.json({ success: true, data: { customer } });
  } catch (err) {
    console.error('Get customer error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
