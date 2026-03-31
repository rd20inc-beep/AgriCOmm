/**
 * RiceFlow ERP — Joi Validation Schemas
 * Centralized schemas for all critical endpoints.
 */

const Joi = require('joi');

// ===================== EXPORT ORDERS =====================

const createExportOrder = Joi.object({
  customer_id: Joi.number().integer().positive().required(),
  product_id: Joi.number().integer().positive().required(),
  product_name: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  qty_mt: Joi.number().positive().required().messages({
    'number.positive': 'Quantity must be greater than zero',
  }),
  price_per_mt: Joi.number().positive().required().messages({
    'number.positive': 'Price per MT must be greater than zero',
  }),
  currency: Joi.string().valid('USD', 'EUR', 'GBP').default('USD'),
  contract_value: Joi.number().positive().required(),
  incoterm: Joi.string().valid('FOB', 'CIF', 'CNF', 'CFR', 'EXW', 'DDP').required(),
  advance_pct: Joi.number().min(0).max(100).default(20),
  advance_expected: Joi.number().min(0).default(0),
  balance_expected: Joi.number().min(0).default(0),
  shipment_eta: Joi.date().iso().allow(null, ''),
  source: Joi.string().allow('', null),
  notes: Joi.string().allow('', null),
  status: Joi.string().valid(
    'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending',
    'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship',
    'Shipped', 'Arrived', 'Closed', 'Cancelled'
  ).default('Draft'),
  // Bag specification
  bag_type: Joi.string().max(100).allow('', null),
  bag_quality: Joi.string().max(100).allow('', null),
  bag_size_kg: Joi.number().positive().allow(null),
  bag_weight_gm: Joi.number().positive().allow(null),
  bag_printing: Joi.string().max(255).allow('', null),
  bag_color: Joi.string().max(100).allow('', null),
  bag_brand: Joi.string().max(255).allow('', null),
  units_per_bag: Joi.number().integer().positive().allow(null),
  bag_notes: Joi.string().allow('', null),
  // Packing / receiving mode
  receiving_mode: Joi.string().valid('loose', 'bags', 'mixed', 'custom').allow('', null),
  quantity_unit: Joi.string().valid('kg', 'katta', 'maund', 'ton', 'mt', 'bags').allow('', null),
  quantity_input_value: Joi.number().positive().allow(null),
  total_bags: Joi.number().integer().min(0).allow(null),
  total_loose_weight_kg: Joi.number().min(0).allow(null),
  packing_notes: Joi.string().allow('', null),
  packing_lines: Joi.array().items(Joi.object({
    bag_type: Joi.string().max(100).allow('', null),
    bag_quality: Joi.string().max(100).allow('', null),
    fill_weight_kg: Joi.number().positive().required(),
    bag_count: Joi.number().integer().positive().required(),
    bag_printing: Joi.string().max(255).allow('', null),
    bag_color: Joi.string().max(100).allow('', null),
    bag_brand: Joi.string().max(255).allow('', null),
    notes: Joi.string().allow('', null),
  })).allow(null),
});

// ===================== PAYMENTS =====================

const recordPayment = Joi.object({
  type: Joi.string().valid('receipt', 'payment').required(),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Payment amount must be greater than zero',
  }),
  currency: Joi.string().valid('USD', 'PKR', 'EUR').required(),
  payment_method: Joi.string().valid('bank_transfer', 'cash', 'cheque', 'lc', 'tt').required(),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().allow('', null),
  payment_date: Joi.date().iso().required(),
  linked_receivable_id: Joi.number().integer().allow(null),
  linked_payable_id: Joi.number().integer().allow(null),
  notes: Joi.string().allow('', null),
});

// ===================== JOURNAL ENTRIES =====================

const createJournal = Joi.object({
  date: Joi.date().iso().required(),
  description: Joi.string().min(3).required(),
  entity: Joi.string().valid('export', 'mill', 'general').required(),
  lines: Joi.array().items(
    Joi.object({
      account_id: Joi.number().integer().positive().required(),
      debit: Joi.number().min(0).default(0),
      credit: Joi.number().min(0).default(0),
      description: Joi.string().allow('', null),
    })
  ).min(2).required().messages({
    'array.min': 'Journal entry must have at least 2 lines',
  }),
  reference_type: Joi.string().allow('', null),
  reference_id: Joi.number().integer().allow(null),
});

// ===================== STOCK ADJUSTMENT =====================

const stockAdjustment = Joi.object({
  lot_id: Joi.number().integer().positive().required(),
  type: Joi.string().valid(
    'procurement_receipt', 'milling_input', 'milling_output',
    'internal_transfer', 'export_dispatch', 'quality_adjustment',
    'wastage', 'manual_adjustment', 'return', 'local_sale', 'reservation'
  ).required(),
  qty_mt: Joi.number().required().messages({
    'number.base': 'Quantity must be a valid number',
  }),
  reason: Joi.string().min(3).required().messages({
    'string.min': 'Reason must be at least 3 characters',
  }),
  reference_type: Joi.string().allow('', null),
  reference_id: Joi.number().integer().allow(null),
});

// ===================== APPROVAL =====================

const submitApproval = Joi.object({
  approval_type: Joi.string().valid(
    'payment_confirmation', 'stock_adjustment', 'internal_transfer',
    'manual_journal', 'cost_edit', 'order_close', 'quality_override', 'price_change'
  ).required(),
  entity_type: Joi.string().required(),
  entity_id: Joi.number().integer().required(),
  entity_ref: Joi.string().allow('', null),
  proposed_data: Joi.object().required(),
  amount: Joi.number().min(0).default(0),
  currency: Joi.string().valid('USD', 'PKR').default('USD'),
  notes: Joi.string().allow('', null),
  priority: Joi.string().valid('Low', 'Normal', 'High', 'Urgent').default('Normal'),
});

const rejectApproval = Joi.object({
  reason: Joi.string().min(3).required().messages({
    'string.min': 'Rejection reason must be at least 3 characters',
    'any.required': 'Rejection reason is required',
  }),
});

// ===================== MILLING =====================

const createBatch = Joi.object({
  supplier_id: Joi.number().integer().positive().required(),
  raw_qty_mt: Joi.number().positive().required().messages({
    'number.positive': 'Raw quantity must be greater than zero',
  }),
  planned_finished_mt: Joi.number().positive().required(),
  linked_export_order_id: Joi.number().integer().allow(null),
  mill_id: Joi.number().integer().allow(null),
  machine_line: Joi.string().allow('', null),
  shift: Joi.string().valid('Day', 'Night', 'Full').default('Day'),
  notes: Joi.string().allow('', null),
});

const recordYield = Joi.object({
  actual_finished_mt: Joi.number().min(0).required(),
  broken_mt: Joi.number().min(0).default(0),
  bran_mt: Joi.number().min(0).default(0),
  husk_mt: Joi.number().min(0).default(0),
  wastage_mt: Joi.number().min(0).default(0),
});

module.exports = {
  createExportOrder,
  recordPayment,
  createJournal,
  stockAdjustment,
  submitApproval,
  rejectApproval,
  createBatch,
  recordYield,
};
