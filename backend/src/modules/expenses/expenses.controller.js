const service = require('./expenses.service');
const Joi = require('joi');
const { ValidationError } = require('../../shared/errors');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');

const createSchema = Joi.object({
  expense_type: Joi.string().valid('general', 'mill', 'export').default('general'),
  category: Joi.string().trim().max(50).required(),
  subcategory: Joi.string().max(50).allow(null, '').optional(),
  amount: Joi.number().greater(0).required(),
  currency: Joi.string().valid('PKR', 'USD', 'EUR', 'GBP').default('PKR'),
  fx_rate: Joi.number().min(0).allow(null).optional(),
  supplier_id: Joi.number().integer().allow(null).optional(),
  vendor_name: Joi.string().max(255).allow(null, '').optional(),
  expense_date: Joi.date().required(),
  due_date: Joi.date().allow(null).optional(),
  invoice_reference: Joi.string().max(100).allow(null, '').optional(),
  description: Joi.string().allow(null, '').optional(),
  notes: Joi.string().allow(null, '').optional(),
  batch_id: Joi.number().integer().allow(null).optional(),
  order_id: Joi.number().integer().allow(null).optional(),
  pay_now: Joi.boolean().default(false),
  bank_account_id: Joi.number().integer().allow(null).optional(),
  payment_method: Joi.string().max(30).allow(null, '').optional(),
  payment_reference: Joi.string().max(100).allow(null, '').optional(),
});

const paySchema = Joi.object({
  bank_account_id: Joi.number().integer().required(),
  payment_method: Joi.string().max(30).default('bank'),
  payment_reference: Joi.string().max(100).allow(null, '').optional(),
  paid_date: Joi.date().optional(),
});

function validate(schema, body) {
  const { value, error } = schema.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(error.details.map(d => d.message).join('; '));
  return value;
}

const expensesController = {
  async create(req, res, next) {
    try {
      const data = validate(createSchema, req.body);
      const expense = await service.create(data, req.user?.id);
      res.status(201).json({ success: true, data: { expense } });
    } catch (err) { next(err); }
  },

  async list(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { expense_type, category, payment_status, from_date, to_date } = req.query;
      const result = await service.list({ expense_type, category, payment_status, from_date, to_date, limit, offset });
      res.json({
        success: true,
        data: {
          expenses: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) { next(err); }
  },

  async getById(req, res, next) {
    try {
      const expense = await service.getById(req.params.id);
      res.json({ success: true, data: { expense } });
    } catch (err) { next(err); }
  },

  async markPaid(req, res, next) {
    try {
      const data = validate(paySchema, req.body);
      const expense = await service.markPaid(req.params.id, data, req.user?.id);
      res.json({ success: true, data: { expense } });
    } catch (err) { next(err); }
  },

  async getSummary(req, res, next) {
    try {
      const summary = await service.getSummary();
      res.json({ success: true, data: { summary } });
    } catch (err) { next(err); }
  },

  async getCategories(req, res, next) {
    try {
      res.json({ success: true, data: { categories: service.getCategories() } });
    } catch (err) { next(err); }
  },
};

module.exports = expensesController;
