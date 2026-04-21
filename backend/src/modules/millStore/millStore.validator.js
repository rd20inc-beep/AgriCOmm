const Joi = require('joi');

const CATEGORIES = ['packaging', 'operational', 'fuel', 'maintenance'];
const UNITS = ['piece', 'kg', 'liter', 'meter', 'roll', 'bag', 'box', 'set'];

const createItemSchema = Joi.object({
  code: Joi.string().trim().uppercase().max(50).required(),
  name: Joi.string().trim().max(255).required(),
  category: Joi.string().valid(...CATEGORIES).required(),
  subcategory: Joi.string().max(50).allow(null, '').optional(),
  unit: Joi.string().valid(...UNITS).required(),
  bag_type_id: Joi.number().integer().allow(null).optional(),
  reorder_level: Joi.number().min(0).default(0),
  preferred_supplier_id: Joi.number().integer().allow(null).optional(),
  notes: Joi.string().allow(null, '').optional(),
});

const updateItemSchema = Joi.object({
  name: Joi.string().trim().max(255).optional(),
  category: Joi.string().valid(...CATEGORIES).optional(),
  subcategory: Joi.string().max(50).allow(null, '').optional(),
  unit: Joi.string().valid(...UNITS).optional(),
  bag_type_id: Joi.number().integer().allow(null).optional(),
  reorder_level: Joi.number().min(0).optional(),
  preferred_supplier_id: Joi.number().integer().allow(null).optional(),
  notes: Joi.string().allow(null, '').optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

const createRatioSchema = Joi.object({
  item_id: Joi.number().integer().required(),
  product_id: Joi.number().integer().allow(null).optional(),
  unit_per_mt: Joi.number().min(0).required(),
  notes: Joi.string().allow(null, '').optional(),
});

const updateRatioSchema = Joi.object({
  unit_per_mt: Joi.number().min(0).optional(),
  notes: Joi.string().allow(null, '').optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

const purchaseLineSchema = Joi.object({
  item_id: Joi.number().integer().required(),
  quantity: Joi.number().greater(0).required(),
  cost_per_unit: Joi.number().min(0).required(),
  warehouse_id: Joi.number().integer().allow(null).optional(),
});

const createPurchaseSchema = Joi.object({
  supplier_id: Joi.number().integer().required(),
  invoice_number: Joi.string().max(100).allow(null, '').optional(),
  purchase_date: Joi.date().required(),
  notes: Joi.string().allow(null, '').optional(),
  lines: Joi.array().items(purchaseLineSchema).min(1).required(),
});

const updatePaymentSchema = Joi.object({
  payment_status: Joi.string().valid('Unpaid', 'Partial', 'Paid').required(),
});

const ADJUSTMENT_TYPES = ['damage', 'correction', 'wastage', 'count'];

const requestAdjustmentSchema = Joi.object({
  item_id: Joi.number().integer().required(),
  warehouse_id: Joi.number().integer().allow(null).optional(),
  adjustment_type: Joi.string().valid(...ADJUSTMENT_TYPES).required(),
  quantity_delta: Joi.number().not(0).required(),
  reason: Joi.string().trim().min(3).required(),
});

const rejectAdjustmentSchema = Joi.object({
  rejection_reason: Joi.string().trim().min(3).required(),
});

module.exports = {
  createItemSchema,
  updateItemSchema,
  createRatioSchema,
  updateRatioSchema,
  createPurchaseSchema,
  updatePaymentSchema,
  requestAdjustmentSchema,
  rejectAdjustmentSchema,
};
