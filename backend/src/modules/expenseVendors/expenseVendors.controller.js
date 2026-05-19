const db = require('../../config/database');

const expenseVendorsController = {
  // Authenticated read — used by Add Expense drawer to populate the
  // Provider dropdown. Returns active vendors grouped by category by
  // default; pass ?include_inactive=1 to include retired entries
  // (Admin tab needs this to manage them).
  async list(req, res) {
    try {
      const { category, include_inactive } = req.query;
      let q = db('expense_vendors')
        .select('id', 'category', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at')
        .orderBy('category', 'asc')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc');
      if (category) q = q.where('category', category);
      if (include_inactive !== '1' && include_inactive !== 'true') {
        q = q.where('is_active', true);
      }
      const vendors = await q;

      // Group by category — handy for the FE since both consumers
      // (drawer + admin tab) want the category-keyed shape.
      const byCategory = vendors.reduce((acc, v) => {
        (acc[v.category] = acc[v.category] || []).push(v);
        return acc;
      }, {});

      return res.json({ success: true, data: { vendors, byCategory } });
    } catch (err) {
      console.error('expense vendors list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async create(req, res) {
    try {
      const { category, name, sort_order } = req.body;
      if (!category || !name) {
        return res.status(400).json({ success: false, message: 'category and name are required.' });
      }
      const [row] = await db('expense_vendors')
        .insert({
          category: String(category).trim().toLowerCase(),
          name: String(name).trim(),
          sort_order: parseInt(sort_order, 10) || 0,
          is_active: true,
        })
        .returning('*');
      return res.json({ success: true, data: { vendor: row } });
    } catch (err) {
      if (String(err.message).includes('unique')) {
        return res.status(409).json({ success: false, message: 'That provider already exists in this category.' });
      }
      console.error('expense vendor create error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      const { category, name, sort_order, is_active } = req.body;
      const patch = {};
      if (category !== undefined) patch.category = String(category).trim().toLowerCase();
      if (name !== undefined) patch.name = String(name).trim();
      if (sort_order !== undefined) patch.sort_order = parseInt(sort_order, 10) || 0;
      if (is_active !== undefined) patch.is_active = !!is_active;
      patch.updated_at = db.fn.now();
      const [row] = await db('expense_vendors').where({ id }).update(patch).returning('*');
      if (!row) return res.status(404).json({ success: false, message: 'Vendor not found.' });
      return res.json({ success: true, data: { vendor: row } });
    } catch (err) {
      if (String(err.message).includes('unique')) {
        return res.status(409).json({ success: false, message: 'Another provider in this category already has that name.' });
      }
      console.error('expense vendor update error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async remove(req, res) {
    try {
      const { id } = req.params;
      const n = await db('expense_vendors').where({ id }).del();
      if (!n) return res.status(404).json({ success: false, message: 'Vendor not found.' });
      return res.json({ success: true });
    } catch (err) {
      console.error('expense vendor delete error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = expenseVendorsController;
