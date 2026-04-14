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

module.exports = {
  createItemSchema,
  updateItemSchema,
  createRatioSchema,
  updateRatioSchema,
};
