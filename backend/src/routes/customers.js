const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');

// GET /api/customers — list with search, country filter, pagination
router.get('/', authorize('export_orders', 'view'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search, country, active } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('customers').where('archived', false);

    if (active === 'true') query = query.where('is_active', true);
    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('email', `%${search}%`)
          .orWhereILike('contact_person', `%${search}%`);
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

// GET /api/customers/:id — single customer
router.get('/:id', authorize('export_orders', 'view'), async (req, res) => {
  try {
    const customer = await db('customers').where({ id: req.params.id }).first();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    // Fetch order history summary
    const orderSummary = await db('export_orders')
      .where({ customer_id: customer.id })
      .select(
        db.raw('COUNT(*) as total_orders'),
        db.raw('COALESCE(SUM(contract_value), 0) as total_value'),
        db.raw('COALESCE(SUM(advance_received + balance_received), 0) as total_received')
      )
      .first();

    return res.json({
      success: true,
      data: { customer, orderSummary },
    });
  } catch (err) {
    console.error('Get customer error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/customers — create
router.post(
  '/',
  authorize('export_orders', 'create'),
  auditAction('create', 'customer'),
  async (req, res) => {
    try {
      const { name, country, contact_person, email, phone, address, payment_terms, currency, credit_limit, bank_name, bank_account, bank_swift, bank_iban } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Customer name is required.' });
      }

      const [customer] = await db('customers')
        .insert({
          name: name.trim(),
          country: country || null,
          contact_person: contact_person || null,
          email: email || null,
          phone: phone || null,
          address: address || null,
          payment_terms: payment_terms || 'Advance',
          currency: currency || 'USD',
          credit_limit: credit_limit ? parseFloat(credit_limit) : 0,
          bank_name: bank_name || null,
          bank_account: bank_account || null,
          bank_swift: bank_swift || null,
          bank_iban: bank_iban || null,
          is_active: true,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { customer } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'A customer with this name already exists.' });
      }
      console.error('Create customer error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// PUT /api/customers/:id — update
router.put(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('update', 'customer', (req) => req.params.id),
  async (req, res) => {
    try {
      const updates = { ...req.body };
      delete updates.id;
      delete updates.created_at;
      updates.updated_at = db.fn.now();

      const [customer] = await db('customers')
        .where({ id: req.params.id })
        .update(updates)
        .returning('*');

      if (!customer) {
        return res.status(404).json({ success: false, message: 'Customer not found.' });
      }

      return res.json({ success: true, data: { customer } });
    } catch (err) {
      console.error('Update customer error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// DELETE /api/customers/:id — soft delete (archive)
router.delete(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('delete', 'customer', (req) => req.params.id),
  async (req, res) => {
    try {
      // Check for linked orders
      const linked = await db('export_orders').where({ customer_id: req.params.id }).count('id as count').first();
      if (parseInt(linked.count) > 0) {
        // Soft delete — archive instead of removing
        await db('customers').where({ id: req.params.id }).update({ archived: true, is_active: false, updated_at: db.fn.now() });
        return res.json({ success: true, message: 'Customer archived (has linked orders).' });
      }

      await db('customers').where({ id: req.params.id }).del();
      return res.json({ success: true, message: 'Customer deleted.' });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(409).json({ success: false, message: 'Cannot delete: customer has linked records.' });
      }
      console.error('Delete customer error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

module.exports = router;
