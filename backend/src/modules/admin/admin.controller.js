const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');

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
        const [row] = await db.transaction(async (trx) => {
          const body = { ...req.body };
          // Suppliers get a stable privacy code (SUP-001…) used on export orders.
          if (tableName === 'suppliers' && !body.supplier_code) {
            body.supplier_code = await nextDocNo(trx, { table: 'suppliers', column: 'supplier_code', prefix: 'SUP-', pad: 3 });
          }
          return trx(tableName).insert(body).returning('*');
        });
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
const documentTemplatesCrud = createCrud('document_templates', 'document_template');
const productCategoriesCrud = createCrud('product_categories', 'product_category');

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

  // Document Templates
  listDocumentTemplates: documentTemplatesCrud.list,
  getDocumentTemplate: documentTemplatesCrud.getById,
  createDocumentTemplate: documentTemplatesCrud.create,
  updateDocumentTemplate: documentTemplatesCrud.update,
  deleteDocumentTemplate: documentTemplatesCrud.delete,

  // Product Categories (with parent for subcategories)
  async listProductCategories(req, res) {
    try {
      const rows = await db('product_categories as pc')
        .leftJoin('product_categories as parent', 'pc.parent_id', 'parent.id')
        .select(
          'pc.*',
          'parent.name as parent_name',
          'parent.group_key as parent_group_key',
        )
        .orderByRaw("COALESCE(pc.parent_id, pc.id), pc.id");
      return res.json({ success: true, data: { product_categories: rows } });
    } catch (err) {
      console.error('List product categories error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
  getProductCategory: productCategoriesCrud.getById,
  createProductCategory: productCategoriesCrud.create,
  updateProductCategory: productCategoriesCrud.update,
  deleteProductCategory: productCategoriesCrud.delete,

  // ─── Roles & Permissions ──────────────────────────────────────────────
  // The Permissions tab on the Admin page reads listPermissions (every
  // permission row in the system) + listRolesWithPermissions (each role
  // along with the permission_ids it's currently granted), and writes
  // through updateRolePermissions (replace a role's permission set with
  // the array sent in the body).
  async listPermissions(req, res) {
    try {
      const rows = await db('permissions').orderBy('module', 'asc').orderBy('action', 'asc');
      return res.json({ success: true, data: { permissions: rows } });
    } catch (err) {
      console.error('List permissions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async listRolesWithPermissions(req, res) {
    try {
      const roles = await db('roles').orderBy('id', 'asc');
      const rolePerms = await db('role_permissions').select('role_id', 'permission_id');
      const byRole = new Map(roles.map(r => [r.id, []]));
      for (const rp of rolePerms) {
        if (byRole.has(rp.role_id)) byRole.get(rp.role_id).push(rp.permission_id);
      }
      const userCounts = await db('users')
        .select('role_id')
        .count('id as user_count')
        .groupBy('role_id');
      const userCountByRole = Object.fromEntries(userCounts.map(r => [r.role_id, parseInt(r.user_count, 10)]));

      const parseNav = (v) => {
        if (!v) return null;
        try { return Array.isArray(v) ? v : JSON.parse(v); } catch { return null; }
      };
      const data = roles.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permission_ids: byRole.get(r.id) || [],
        mobile_nav: parseNav(r.mobile_nav),
        user_count: userCountByRole[r.id] || 0,
      }));
      return res.json({ success: true, data: { roles: data } });
    } catch (err) {
      console.error('List roles+permissions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateRolePermissions(req, res) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const { permission_ids } = req.body;
      if (!Array.isArray(permission_ids)) {
        return res.status(400).json({ success: false, message: 'permission_ids array is required.' });
      }
      const role = await db('roles').where({ id: roleId }).first();
      if (!role) return res.status(404).json({ success: false, message: 'Role not found.' });

      // Super Admin's permission set is intentionally immutable — without
      // an irreducible all-access role, an admin could lock themselves
      // out by clearing every permission on the role they're using.
      if (role.name === 'Super Admin') {
        return res.status(400).json({
          success: false,
          message: 'Super Admin permissions cannot be edited (it is the irreducible all-access role).',
        });
      }

      // Validate every permission_id actually exists, then replace.
      const requested = [...new Set(permission_ids.map(n => parseInt(n, 10)).filter(Boolean))];
      if (requested.length > 0) {
        const valid = await db('permissions').whereIn('id', requested).select('id');
        const validSet = new Set(valid.map(r => r.id));
        const unknown = requested.filter(id => !validSet.has(id));
        if (unknown.length > 0) {
          return res.status(400).json({ success: false, message: `Unknown permission ids: ${unknown.join(', ')}` });
        }
      }

      await db.transaction(async (trx) => {
        await trx('role_permissions').where({ role_id: roleId }).del();
        if (requested.length > 0) {
          await trx('role_permissions').insert(requested.map(pid => ({ role_id: roleId, permission_id: pid })));
        }
      });

      return res.json({ success: true, data: { role_id: roleId, permission_count: requested.length } });
    } catch (err) {
      console.error('Update role permissions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Set the phone bottom-nav shortcuts for a role (ordered array of item keys).
  // An empty array / null resets the role to the app's default set. The frontend
  // registry validates the keys; here we just store the ordered list (capped).
  async updateRoleMobileNav(req, res) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const { items } = req.body;
      if (items != null && !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'items must be an array (or null to reset).' });
      }
      const role = await db('roles').where({ id: roleId }).first();
      if (!role) return res.status(404).json({ success: false, message: 'Role not found.' });

      // Store up to 4 shortcut keys (the bar shows those + a fixed "Menu"). null = default.
      const clean = Array.isArray(items)
        ? [...new Set(items.filter(k => typeof k === 'string' && k))].slice(0, 4)
        : null;
      const value = clean && clean.length ? JSON.stringify(clean) : null;

      await db('roles').where({ id: roleId }).update({ mobile_nav: value });
      return res.json({ success: true, data: { role_id: roleId, mobile_nav: clean && clean.length ? clean : null } });
    } catch (err) {
      console.error('Update role mobile nav error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

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
