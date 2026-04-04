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

const updateExportShipment = Joi.object({
  vessel_name: Joi.string().allow('', null),
  booking_no: Joi.string().allow('', null),
  container_no: Joi.string().allow('', null),
  containers: Joi.array().items(Joi.object({
    container_no: Joi.string().trim().min(1).required(),
    seal_no: Joi.string().allow('', null),
    gross_weight_kg: Joi.number().min(0).allow(null),
    net_weight_kg: Joi.number().min(0).allow(null),
    notes: Joi.string().allow('', null),
  })).allow(null),
  bl_number: Joi.string().allow('', null),
  shipping_line: Joi.string().allow('', null),
  etd: Joi.date().iso().allow(null, ''),
  atd: Joi.date().iso().allow(null, ''),
  eta: Joi.date().iso().allow(null, ''),
  ata: Joi.date().iso().allow(null, ''),
  destination_port: Joi.string().allow('', null),
  notes: Joi.string().allow('', null),
});

const exportOrderAction = Joi.object({
  notes: Joi.string().allow('', null),
});

const exportOrderDocumentAction = Joi.object({
  doc_type: Joi.string().required(),
  file_path: Joi.string().allow('', null),
  version: Joi.number().integer().min(1).allow(null),
  notes: Joi.string().allow('', null),
});

const confirmAdvance = Joi.object({
  amount: Joi.number().positive().required(),
  payment_date: Joi.date().iso().allow(null, ''),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().max(255).allow(null, ''),
  reference: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().max(1000).allow(null, ''),
});

const confirmBalance = Joi.object({
  amount: Joi.number().positive().required(),
  payment_date: Joi.date().iso().allow(null, ''),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().max(255).allow(null, ''),
  reference: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().max(1000).allow(null, ''),
});

const allocateExportStock = Joi.object({
  lot_id: Joi.number().integer().positive().required(),
  qty_mt: Joi.number().positive().required(),
  notes: Joi.string().allow('', null),
});

const createPurchaseLot = Joi.object({
  item_name: Joi.string().max(255).required(),
  type: Joi.string().valid('raw', 'finished', 'byproduct').default('raw'),
  entity: Joi.string().valid('mill', 'export').default('mill'),
  warehouse_id: Joi.number().integer().positive().allow(null),
  product_id: Joi.number().integer().positive().allow(null),
  supplier_id: Joi.number().integer().positive().allow(null),
  broker_id: Joi.number().integer().positive().allow(null),
  purchase_date: Joi.date().iso().allow(null, ''),
  crop_year: Joi.string().max(20).allow(null, ''),
  variety: Joi.string().allow(null, ''),
  grade: Joi.string().allow(null, ''),
  moisture_pct: Joi.number().min(0).max(100).allow(null),
  broken_pct: Joi.number().min(0).max(100).allow(null),
  sortex_status: Joi.string().allow(null, ''),
  whiteness: Joi.string().allow(null, ''),
  quality_notes: Joi.string().allow(null, ''),
  bag_type: Joi.string().allow(null, ''),
  bag_quality: Joi.string().allow(null, ''),
  bag_size_kg: Joi.number().positive().allow(null),
  bag_weight_gm: Joi.number().positive().allow(null),
  bag_color: Joi.string().allow(null, ''),
  bag_cost_per_bag: Joi.number().min(0).allow(null),
  bag_cost_included: Joi.boolean().default(false),
  quantity_input: Joi.number().positive().required(),
  quantity_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  bag_weight_kg: Joi.number().positive().default(50),
  rate_input: Joi.number().positive().required(),
  rate_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  transport_cost: Joi.number().min(0).default(0),
  labor_cost: Joi.number().min(0).default(0),
  unloading_cost: Joi.number().min(0).default(0),
  packing_cost: Joi.number().min(0).default(0),
  other_cost: Joi.number().min(0).default(0),
  total_bags: Joi.number().integer().min(0).allow(null),
  notes: Joi.string().allow(null, ''),
  payment_status: Joi.string().valid('Unpaid', 'Partial', 'Paid').default('Unpaid'),
  paid_amount: Joi.number().min(0).allow(null),
});

const recordLotTransaction = Joi.object({
  transaction_type: Joi.string().required(),
  transaction_date: Joi.date().iso().allow(null, ''),
  quantity_input: Joi.number().positive().required(),
  quantity_unit: Joi.string().valid('kg', 'katta', 'bag', 'maund', 'ton', 'mt').default('kg'),
  bag_weight_kg: Joi.number().positive().default(50),
  warehouse_from_id: Joi.number().integer().positive().allow(null),
  warehouse_to_id: Joi.number().integer().positive().allow(null),
  reference_module: Joi.string().allow(null, ''),
  reference_id: Joi.number().integer().allow(null),
  reference_no: Joi.string().allow(null, ''),
  rate_input: Joi.number().min(0).allow(null),
  rate_unit: Joi.string().valid('kg', 'katta', 'bag', 'maund', 'ton', 'mt').allow(null, ''),
  remarks: Joi.string().allow(null, ''),
});

const updateLotCosts = Joi.object({
  transport_cost: Joi.number().min(0).allow(null),
  labor_cost: Joi.number().min(0).allow(null),
  unloading_cost: Joi.number().min(0).allow(null),
  packing_cost: Joi.number().min(0).allow(null),
  other_cost: Joi.number().min(0).allow(null),
  bag_cost_per_bag: Joi.number().min(0).allow(null),
});

const createAdvance = Joi.object({
  customer_id: Joi.number().integer().positive().required(),
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid('USD', 'PKR', 'EUR').allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_reference: Joi.string().max(255).allow(null, ''),
  payment_date: Joi.date().iso().allow(null, ''),
  notes: Joi.string().allow(null, ''),
});

const allocateAdvance = Joi.object({
  order_id: Joi.number().integer().positive().required(),
  amount: Joi.number().positive().required(),
  notes: Joi.string().allow(null, ''),
});

const createInternalTransfer = Joi.object({
  batch_id: Joi.number().integer().positive().required(),
  export_order_id: Joi.number().integer().positive().required(),
  product_name: Joi.string().allow('', null),
  qty_mt: Joi.number().positive().required(),
  transfer_price_pkr: Joi.number().min(0).allow(null),
  total_value_pkr: Joi.number().min(0).allow(null),
  usd_equivalent: Joi.number().min(0).allow(null),
  pkr_rate: Joi.number().min(0).allow(null),
  dispatch_date: Joi.date().iso().allow(null, ''),
  status: Joi.string().allow(null, ''),
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
  supplier_id: Joi.number().integer().positive().allow(null),
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
  updateExportShipment,
  exportOrderAction,
  exportOrderDocumentAction,
  confirmAdvance,
  confirmBalance,
  allocateExportStock,
  createPurchaseLot,
  recordLotTransaction,
  updateLotCosts,
  createAdvance,
  allocateAdvance,
  createInternalTransfer,
  recordPayment,
  createJournal,
  stockAdjustment,
  submitApproval,
  rejectApproval,
  createBatch,
  recordYield,
};
