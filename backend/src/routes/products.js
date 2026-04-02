const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authorize = require('../middleware/rbac');

// GET /api/products
router.get('/', authorize('inventory', 'view'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('products');

    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

    const [products, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return res.json({
      success: true,
      data: {
        products,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    console.error('List products error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/products/:id
router.get('/:id', authorize('inventory', 'view'), async (req, res) => {
  try {
    const product = await db('products').where({ id: req.params.id }).first();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    return res.json({ success: true, data: { product } });
  } catch (err) {
    console.error('Get product error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
