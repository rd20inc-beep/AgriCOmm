const Joi = require('joi');

const createCustomerSchema = Joi.object({
  name: Joi.string().trim().required(),
  country: Joi.string().allow(null, '').optional(),
  contact_person: Joi.string().allow(null, '').optional(),
  email: Joi.string().email().allow(null, '').optional(),
  phone: Joi.string().allow(null, '').optional(),
  address: Joi.string().allow(null, '').optional(),
  payment_terms: Joi.string().default('Advance'),
  currency: Joi.string().default('USD'),
  credit_limit: Joi.number().min(0).default(0),
  bank_name: Joi.string().allow(null, '').optional(),
  bank_account: Joi.string().allow(null, '').optional(),
  bank_swift: Joi.string().allow(null, '').optional(),
  bank_iban: Joi.string().allow(null, '').optional(),
});

const createSupplierSchema = Joi.object({
  name: Joi.string().trim().required(),
  contact_person: Joi.string().allow(null, '').optional(),
  email: Joi.string().email().allow(null, '').optional(),
  phone: Joi.string().allow(null, '').optional(),
  address: Joi.string().allow(null, '').optional(),
  country: Joi.string().allow(null, '').optional(),
  type: Joi.string().default('Paddy Supplier'),
});

const createProductSchema = Joi.object({
  name: Joi.string().trim().required(),
  code: Joi.string().allow(null, '').optional(),
  grade: Joi.string().allow(null, '').optional(),
  variety: Joi.string().allow(null, '').optional(),
  hs_code: Joi.string().allow(null, '').optional(),
  description: Joi.string().allow(null, '').optional(),
});

module.exports = {
  createCustomerSchema,
  createSupplierSchema,
  createProductSchema,
};
