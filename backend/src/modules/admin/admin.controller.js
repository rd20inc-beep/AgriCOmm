const db = require('../../config/database');

// Generic CRUD factory
function createCrud(tableName, entityName) {
  return {
    async list(req, res) {
      try {
        const { page = 1, limit = 50, search } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        let query = db(tableName);

        if (search) {
          query = query.where(function () {
            this.whereILike('name', `%${search}%`);
          });
        }

        const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

        const [rows, countResult] = await Promise.all([
          query.orderBy('created_at', 'desc').limit(parseInt(limit)).offset(offset),
          countQuery,
        ]);

        const total = parseInt(countResult.total);

        return res.json({
          success: true,
          data: {
            [tableName]: rows,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              totalPages: Math.ceil(total / parseInt(limit)),
            },
          },
        });
      } catch (err) {
        console.error(`List ${entityName} error:`, err);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },

    async getById(req, res) {
      try {
        const row = await db(tableName).where({ id: req.params.id }).first();
        if (!row) {
          return res.status(404).json({ success: false, message: `${entityName} not found.` });
        }
        return res.json({ success: true, data: { [entityName]: row } });
      } catch (err) {
        console.error(`Get ${entityName} error:`, err);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },

    async create(req, res) {
      try {
        const [row] = await db(tableName).insert(req.body).returning('*');
        return res.status(201).json({ success: true, data: { [entityName]: row } });
      } catch (err) {
        console.error(`Create ${entityName} error:`, err);
        if (err.code === '23505') {
          return res.status(409).json({ success: false, message: `${entityName} already exists.` });
        }
        return res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },

    async update(req, res) {
      try {
        const updates = { ...req.body };
        delete updates.id;
        delete updates.created_at;
        updates.updated_at = db.fn.now();

        const [row] = await db(tableName)
          .where({ id: req.params.id })
          .update(updates)
          .returning('*');

        if (!row) {
          return res.status(404).json({ success: false, message: `${entityName} not found.` });
        }
        return res.json({ success: true, data: { [entityName]: row } });
      } catch (err) {
        console.error(`Update ${entityName} error:`, err);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },

    async delete(req, res) {
      try {
        const deleted = await db(tableName).where({ id: req.params.id }).del();
        if (!deleted) {
          return res.status(404).json({ success: false, message: `${entityName} not found.` });
        }
        return res.json({ success: true, message: `${entityName} deleted successfully.` });
      } catch (err) {
        console.error(`Delete ${entityName} error:`, err);
        if (err.code === '23503') {
          return res.status(409).json({
            success: false,
            message: `Cannot delete ${entityName}: it is referenced by other records.`,
          });
        }
        return res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  };
}

// Create CRUD handlers for each entity
const customersCrud = createCrud('customers', 'customer');
const suppliersCrud = createCrud('suppliers', 'supplier');
const productsCrud = createCrud('products', 'product');
const bagTypesCrud = createCrud('bag_types', 'bag_type');
const warehousesCrud = createCrud('warehouses', 'warehouse');
const bankAccountsCrud = createCrud('bank_accounts', 'bank_account');

const adminController = {
  // Customers
  listCustomers: customersCrud.list,
  getCustomer: customersCrud.getById,
  createCustomer: customersCrud.create,
  updateCustomer: customersCrud.update,
  deleteCustomer: customersCrud.delete,

  // Suppliers
  listSuppliers: suppliersCrud.list,
  getSupplier: suppliersCrud.getById,
  createSupplier: suppliersCrud.create,
  updateSupplier: suppliersCrud.update,
  deleteSupplier: suppliersCrud.delete,

  // Products
  listProducts: productsCrud.list,
  getProduct: productsCrud.getById,
  createProduct: productsCrud.create,
  updateProduct: productsCrud.update,
  deleteProduct: productsCrud.delete,

  // Bag Types
  listBagTypes: bagTypesCrud.list,
  getBagType: bagTypesCrud.getById,
  createBagType: bagTypesCrud.create,
  updateBagType: bagTypesCrud.update,
  deleteBagType: bagTypesCrud.delete,

  // Warehouses
  listWarehouses: warehousesCrud.list,
  getWarehouse: warehousesCrud.getById,
  createWarehouse: warehousesCrud.create,
  updateWarehouse: warehousesCrud.update,
  deleteWarehouse: warehousesCrud.delete,

  // Bank Accounts
  listBankAccounts: bankAccountsCrud.list,
  getBankAccount: bankAccountsCrud.getById,
  createBankAccount: bankAccountsCrud.create,
  updateBankAccount: bankAccountsCrud.update,
  deleteBankAccount: bankAccountsCrud.delete,

  // Settings
  async getSettings(req, res) {
    try {
      const settings = await db('system_settings').select('key', 'value', 'updated_at');

      const settingsObj = {};
      for (const row of settings) {
        try {
          settingsObj[row.key] = JSON.parse(row.value);
        } catch {
          settingsObj[row.key] = row.value;
        }
      }

      return res.json({
        success: true,
        data: { settings: settingsObj },
      });
    } catch (err) {
      console.error('Get settings error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateSettings(req, res) {
    try {
      const updates = req.body;

      await db.transaction(async (trx) => {
        for (const [key, value] of Object.entries(updates)) {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);

          const existing = await trx('system_settings').where({ key }).first();
          if (existing) {
            await trx('system_settings').where({ key }).update({
              value: serialized,
              updated_at: trx.fn.now(),
            });
          } else {
            await trx('system_settings').insert({
              key,
              value: serialized,
            });
          }
        }
      });

      // Fetch updated settings
      const settings = await db('system_settings').select('key', 'value');
      const settingsObj = {};
      for (const row of settings) {
        try {
          settingsObj[row.key] = JSON.parse(row.value);
        } catch {
          settingsObj[row.key] = row.value;
        }
      }

      return res.json({
        success: true,
        data: { settings: settingsObj },
      });
    } catch (err) {
      console.error('Update settings error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Audit Logs
  async getAuditLogs(req, res) {
    try {
      const { page = 1, limit = 50, entity_type, user_id, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('audit_logs as al')
        .leftJoin('users as u', 'al.user_id', 'u.id')
        .select('al.*', 'u.full_name as user_name');

      if (entity_type) {
        query = query.where('al.entity_type', entity_type);
      }
      if (user_id) {
        query = query.where('al.user_id', user_id);
      }
      if (from_date) {
        query = query.where('al.created_at', '>=', from_date);
      }
      if (to_date) {
        query = query.where('al.created_at', '<=', to_date);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('al.id as total').first();

      const [logs, countResult] = await Promise.all([
        query.orderBy('al.created_at', 'desc').limit(parseInt(limit)).offset(offset),
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
      console.error('Get audit logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = adminController;
