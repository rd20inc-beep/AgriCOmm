const masterDataService = require('./masterData.service');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');
const { userHasPermission } = require('../../middleware/rbac');

// Which customer books the caller may read: export buyers with
// export_orders.view, local (mill) customers with mill_customers.view or
// local_sales.view (customers.customer_type is NOT NULL: 'local' | 'export').
async function readableTypes(req) {
  const types = [];
  if (await userHasPermission(req, 'export_orders', 'view')) types.push('export');
  if (await userHasPermission(req, 'mill_customers', 'view')
    || await userHasPermission(req, 'local_sales', 'view')) types.push('local');
  return types;
}

const forbidden = (res) => res.status(403).json({
  success: false,
  message: 'Forbidden. You do not have permission to perform this action.',
});

const customersController = {
  async list(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { search, country, active } = req.query;
      const allowed = await readableTypes(req);
      let { type } = req.query;
      if (type === 'local' || type === 'export') {
        if (!allowed.includes(type)) return forbidden(res);
      } else if (allowed.length === 1) {
        type = allowed[0];
      }
      const result = await masterDataService.listCustomers({ page, limit, offset, search, country, active, type });
      return res.json({
        success: true,
        data: {
          customers: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await masterDataService.getCustomerById(req.params.id);
      if (!(await readableTypes(req)).includes(result.customer.customer_type)) return forbidden(res);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const customer = await masterDataService.createCustomer(req.body);
      return res.status(201).json({ success: true, data: { customer } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'A customer with this name already exists.' });
      }
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const customer = await masterDataService.updateCustomer(req.params.id, req.body);
      return res.json({ success: true, data: { customer } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await masterDataService.deleteCustomer(req.params.id);
      return res.json({ success: true, message: result.message });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(409).json({ success: false, message: 'Cannot delete: customer has linked records.' });
      }
      next(err);
    }
  },
};

module.exports = customersController;
