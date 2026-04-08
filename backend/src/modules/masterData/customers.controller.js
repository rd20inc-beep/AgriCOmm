const masterDataService = require('./masterData.service');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');

const customersController = {
  async list(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { search, country, active } = req.query;
      const result = await masterDataService.listCustomers({ page, limit, offset, search, country, active });
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
