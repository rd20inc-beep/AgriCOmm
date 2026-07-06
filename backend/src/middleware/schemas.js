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
  // Incoterms 2020 — kept in sync with src/shared/constants/incoterms.js.
  // CNF is the alt-spelling of CFR commonly used in South Asia; both accepted.
  incoterm: Joi.string().valid(
    'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CNF', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'
  ).required(),
  advance_pct: Joi.number().min(0).max(100).default(20),
  doc_address_mode: Joi.string().valid('country', 'port', 'full', 'country_port').default('country'),
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
  // Master (outer) bag spec + payment terms — read + inserted by the controller
  // on create; must be whitelisted here or validate(stripUnknown) drops them so
  // they only persist on a later edit. See [[project_validation_stripunknown]].
  master_bag_size_kg: Joi.number().positive().allow(null, ''),
  master_bag_type: Joi.string().max(100).allow('', null),
  payment_terms: Joi.string().allow('', null),
  // Optional manual FX rate at creation (controller sets fx_rate_source='manual').
  booked_fx_rate: Joi.number().positive().allow(null),
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
  // Multi-line P.I. items — each line carries its own product/qty/price/HS code/packing
  items: Joi.array().items(Joi.object({
    product_id: Joi.number().integer().positive().allow(null),
    product_name: Joi.string().max(255).allow('', null),
    qty_mt: Joi.number().positive().required(),
    price_per_mt: Joi.number().positive().required(),
    hs_code: Joi.string().max(20).allow('', null),
    packing: Joi.string().max(100).allow('', null),
    bag_size_kg: Joi.number().positive().allow(null, ''),
    master_bag_size_kg: Joi.number().positive().allow(null, ''),
    master_bag_type: Joi.string().max(100).allow('', null),
    bag_count: Joi.number().integer().min(0).allow(null, ''),
    bag_type: Joi.string().max(100).allow('', null),
    bag_quality: Joi.string().max(100).allow('', null),
    bag_brand: Joi.string().max(255).allow('', null),
    bag_color: Joi.string().max(100).allow('', null),
    bag_printing: Joi.string().max(255).allow('', null),
    quality_description: Joi.string().allow('', null),
    broken_pct_target: Joi.number().min(0).max(100).allow(null, ''),
    notes: Joi.string().allow('', null),
  })).allow(null),
});

const updateExportShipment = Joi.object({
  vessel_name: Joi.string().allow('', null),
  booking_no: Joi.string().allow('', null),
  container_no: Joi.string().allow('', null),
  containers: Joi.array().items(Joi.object({
    sequence_no: Joi.number().integer().allow(null),
    container_no: Joi.string().trim().min(1).required(),
    seal_no: Joi.string().allow('', null),
    // These were silently stripped before (not declared) so they never
    // persisted — declare them so the container rows save fully (P4c).
    lot_number: Joi.string().allow('', null),
    bags_count: Joi.number().integer().allow(null),
    tare_weight_kg: Joi.number().min(0).allow(null),
    container_type: Joi.string().allow('', null),
    gross_weight_kg: Joi.number().min(0).allow(null),
    net_weight_kg: Joi.number().min(0).allow(null),
    // Structured lot links → container_lots (P4c).
    lots: Joi.array().items(Joi.object({
      lot_id: Joi.number().integer().positive().required(),
      qty_kg: Joi.number().min(0).allow(null),
      bags: Joi.number().integer().allow(null),
    })).allow(null),
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
  // Rate the bank actually applied to convert the foreign-currency
  // advance into PKR. PKR-denominated orders can omit / send 1.
  fx_rate: Joi.number().positive().allow(null),
  payment_date: Joi.date().iso().allow(null, ''),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().max(255).allow(null, ''),
  reference: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().max(1000).allow(null, ''),
});

const confirmBalance = Joi.object({
  amount: Joi.number().positive().required(),
  // Rate the bank actually applied for the balance credit. Mirrors
  // confirmAdvance — PKR-denominated orders can omit / send 1.
  fx_rate: Joi.number().positive().allow(null),
  payment_date: Joi.date().iso().allow(null, ''),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().max(255).allow(null, ''),
  reference: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().max(1000).allow(null, ''),
});

// Mark a finished/by-product lot ready for export + set its export display name.
const setExportReady = Joi.object({
  export_ready: Joi.boolean(),
  export_display_name: Joi.string().max(255).allow('', null),
}).min(1);

// Record a pending export receipt (Export/any) — no posting.
const recordExportReceipt = Joi.object({
  kind: Joi.string().valid('advance', 'balance').default('advance'),
  amount: Joi.number().positive().required(),
  fx_rate: Joi.number().positive().allow(null),      // estimate; Finance sets the real one
  payment_date: Joi.date().iso().allow(null, ''),
  payment_method: Joi.string().max(50).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null),
  notes: Joi.string().max(1000).allow(null, ''),
});

// Finance confirms a pending export receipt with the actual FX rate → posts.
const confirmExportReceipt = Joi.object({
  fx_rate: Joi.number().positive().allow(null),
  bank_account_id: Joi.number().integer().positive().allow(null),
  payment_method: Joi.string().max(50).allow(null, ''),
});

const allocateExportStock = Joi.object({
  lot_id: Joi.number().integer().positive().required(),
  qty_mt: Joi.number().positive().required(),
  // Optional export_order_items line this allocation serves (P4b). Without it
  // here, validate()'s stripUnknown would silently drop item_id from the body.
  item_id: Joi.number().integer().positive().allow(null),
  notes: Joi.string().allow('', null),
});

const createPurchaseLot = Joi.object({
  item_name: Joi.string().max(255).required(),
  type: Joi.string().valid('raw', 'finished', 'byproduct').default('raw'),
  entity: Joi.string().valid('mill', 'export').default('mill'),
  warehouse_id: Joi.number().integer().positive().allow(null),
  product_id: Joi.number().integer().positive().allow(null),
  lot_no: Joi.string().max(50).allow('', null),
  supplier_id: Joi.number().integer().positive().allow(null),
  broker_id: Joi.number().integer().positive().allow(null),
  transport_vendor_id: Joi.number().integer().positive().allow(null, ''),
  commission_per_bag: Joi.number().min(0).allow(null),
  commission_total: Joi.number().min(0).allow(null),
  purchase_date: Joi.date().iso().allow(null, ''),
  crop_year: Joi.string().max(20).allow(null, ''),
  variety: Joi.string().allow(null, ''),
  grade: Joi.string().allow(null, ''),
  moisture_pct: Joi.number().min(0).max(100).allow(null),
  broken_pct: Joi.number().min(0).max(100).allow(null),
  sortex_status: Joi.string().allow(null, ''),
  whiteness: Joi.string().allow(null, ''),
  quality_notes: Joi.string().allow(null, ''),
  // Extended quality (B1/B2/B3/Cobba/CSR/NB/OV/chalky/purity/etc.).
  // Free-form object — sanitizeLotQuality whitelists keys server-side.
  quality_json: Joi.object().unknown(true).allow(null),
  quality: Joi.object().unknown(true).allow(null),
  bag_type: Joi.string().allow(null, ''),
  bag_quality: Joi.string().allow(null, ''),
  bag_size_kg: Joi.number().positive().allow(null),
  bag_weight_gm: Joi.number().positive().allow(null),
  bag_color: Joi.string().allow(null, ''),
  bag_cost_per_bag: Joi.number().min(0).allow(null),
  bag_cost_included: Joi.boolean().default(false),
  quantity_input: Joi.number().positive().required(),
  quantity_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  // Ordered quantity (optional) — what was ordered, vs quantity_input = received.
  ordered_quantity_input: Joi.number().positive().allow(null, ''),
  ordered_quantity_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').allow(null, ''),
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
  payment_status: Joi.string().valid('Pending', 'Partial', 'Paid').default('Pending'),
  paid_amount: Joi.number().min(0).allow(null),
  // Optional vehicle arrivals captured on the New Purchase Lot form — each
  // truck that delivered this lot. Only rows with a vehicle_no are recorded.
  vehicles: Joi.array().items(Joi.object({
    vehicle_no: Joi.string().max(50).allow(null, ''),
    driver_name: Joi.string().max(255).allow(null, ''),
    driver_phone: Joi.string().max(50).allow(null, ''),
    weight_kg: Joi.number().min(0).allow(null, ''),
    total_bags: Joi.number().integer().min(0).allow(null, ''),
    bag_size_kg: Joi.number().min(0).allow(null, ''),
    arrival_date: Joi.date().iso().allow(null, ''),
    notes: Joi.string().allow(null, ''),
    // Per-truck quality at intake — free-form object, whitelisted server-side.
    quality_json: Joi.object().unknown(true).allow(null),
    quality: Joi.object().unknown(true).allow(null),
  })).allow(null),
});

// Add another purchase onto an existing lot. Only the quantity / rate / cost /
// payment fields — item, product, quality etc. are inherited from the lot.
const addPurchaseToLot = Joi.object({
  supplier_id: Joi.number().integer().positive().allow(null),
  purchase_date: Joi.date().iso().allow(null, ''),
  quantity_input: Joi.number().positive().required(),
  quantity_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  bag_weight_kg: Joi.number().positive().allow(null),
  rate_input: Joi.number().positive().required(),
  rate_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  transport_cost: Joi.number().min(0).default(0),
  labor_cost: Joi.number().min(0).default(0),
  unloading_cost: Joi.number().min(0).default(0),
  packing_cost: Joi.number().min(0).default(0),
  other_cost: Joi.number().min(0).default(0),
  bag_cost_per_bag: Joi.number().min(0).allow(null),
  bag_cost_included: Joi.boolean().default(false),
  total_bags: Joi.number().integer().min(0).allow(null),
  payment_status: Joi.string().valid('Pending', 'Partial', 'Paid').default('Pending'),
  paid_amount: Joi.number().min(0).allow(null),
  notes: Joi.string().allow(null, ''),
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
  transport_vendor_id: Joi.number().integer().positive().allow(null, ''),
});

// Edit a lot's recorded quality after creation. moisture/broken come through
// quality_json (and are mirrored to the dedicated columns server-side).
const updateLotQuality = Joi.object({
  // Rice type (product) — editable on a raw lot before milling starts; the
  // controller enforces those guards and syncs item_name.
  product_id: Joi.number().integer().positive().allow(null),
  variety: Joi.string().allow(null, ''),
  grade: Joi.string().allow(null, ''),
  sortex_status: Joi.string().allow(null, ''),
  whiteness: Joi.number().min(0).allow(null, ''),
  bag_quality: Joi.string().allow(null, ''),
  quality_notes: Joi.string().allow(null, ''),
  moisture_pct: Joi.number().min(0).max(100).allow(null),
  broken_pct: Joi.number().min(0).max(100).allow(null),
  quality_json: Joi.object().unknown(true).allow(null),
  quality: Joi.object().unknown(true).allow(null),
}).min(1);

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
  payment_method: Joi.string().valid('bank_transfer', 'cash', 'cheque', 'lc', 'tt', 'wire', 'online', 'mobile').required(),
  bank_account_id: Joi.number().integer().positive().allow(null),
  bank_reference: Joi.string().allow('', null),
  due_date: Joi.date().iso().allow(null),
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
  // Required for a single-source batch; for a blend it's omitted and the
  // backend derives it from source_lots. The .or() below requires one of them.
  raw_qty_kg: Joi.number().positive().messages({
    'number.positive': 'Raw quantity must be greater than zero',
  }),
  // Blend input: partial quantities from multiple existing mill lots
  // (raw and/or leftover finished rice). [{ lot_id, qty_kg }].
  source_lots: Joi.array().items(
    Joi.object({
      lot_id: Joi.number().integer().positive().required(),
      qty_kg: Joi.number().positive().required(),
    })
  ),
  product_id: Joi.number().integer().positive().allow(null),
  // Single-Variety vs Blended. Omit to let the backend infer it from the number
  // of distinct source-lot varieties.
  processing_type: Joi.string().valid('single_variety', 'blended').allow(null),
  planned_finished_kg: Joi.number().positive().allow(null),
  milling_fee_per_kg: Joi.number().min(0).allow(null),
  transport_mode: Joi.string().allow('', null),
  purchase_price_per_kg: Joi.number().min(0).allow(null),
  linked_export_order_id: Joi.number().integer().allow(null),
  mill_id: Joi.number().integer().allow(null),
  machine_line: Joi.string().allow('', null),
  shift: Joi.string().valid('Day', 'Night', 'Full').default('Day'),
  notes: Joi.string().allow('', null),
  // Human label + free-form tags for easy referencing (esp. blends).
  batch_name: Joi.string().max(200).allow('', null),
  custom_tags: Joi.alternatives().try(
    Joi.array().items(Joi.string().max(60)),
    Joi.string().allow('', null),
  ),
}).or('raw_qty_kg', 'source_lots');

const recordYield = Joi.object({
  actual_finished_kg: Joi.number().min(0).required(),
  broken_kg: Joi.number().min(0).default(0),
  bran_kg: Joi.number().min(0).default(0),
  husk_kg: Joi.number().min(0).default(0),
  wastage_kg: Joi.number().min(0).default(0),
});

module.exports = {
  createExportOrder,
  updateExportShipment,
  exportOrderAction,
  exportOrderDocumentAction,
  confirmAdvance,
  confirmBalance,
  recordExportReceipt,
  confirmExportReceipt,
  setExportReady,
  allocateExportStock,
  createPurchaseLot,
  addPurchaseToLot,
  recordLotTransaction,
  updateLotCosts,
  updateLotQuality,
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
