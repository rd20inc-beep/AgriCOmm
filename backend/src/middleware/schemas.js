/**
 * RiceFlow ERP — Joi Validation Schemas
 * Centralized schemas for all critical endpoints.
 */

const Joi = require('joi');

// ===================== EXPORT ORDERS =====================

// One P.I. line — each carries its own product/qty/price/HS code/packing.
const exportOrderItem = Joi.object({
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
});

const createExportOrder = Joi.object({
  customer_id: Joi.number().integer().positive().required(),
  product_id: Joi.number().integer().positive().required(),
  product_name: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  // create() writes `destination_port || null` but this was never declared, so
  // stripUnknown removed it and the port was null on every order ever created —
  // then had to be filled in again from the Shipment form. The port prints on the
  // documents and drives the incoterm wording, so it matters from the start.
  destination_port: Joi.string().max(255).allow('', null),
  // Order-level HS code / quality / broken %. These are declared per line under
  // `items`, but create() ALSO reads them off the top level via req.body.x to
  // materialise a single item row when no items are sent — and an order-level
  // value was stripped before it got there, so that row was written with nulls.
  hs_code: Joi.string().max(20).allow('', null),
  quality_description: Joi.string().allow('', null),   // text column, unbounded
  broken_pct_target: Joi.number().min(0).allow(null),
  // The create form has always sent these four; create() never read them, so
  // they were not stripped — just never saved, and had to be re-entered from the
  // Shipment form. contract_number heads the documents, consignee_type decides
  // the BL consignee line, and the window is on the sales contract.
  contract_number: Joi.string().max(50).allow('', null),
  // Not an enum: the form's own options are 'to_order_of_bank' and 'direct', and
  // updateExportShipment accepts any string. The BL renderer treats anything
  // other than 'to_order_of_bank' as direct-to-buyer, so a strict list here would
  // only reject values the rest of the system already handles. The max matches
  // the column, so an over-long value is a field-level 400 and not a 500 from
  // Postgres. Every max below is the column width, checked against the live
  // database rather than guessed.
  consignee_type: Joi.string().max(20).allow('', null),
  shipment_window_start: Joi.date().iso().allow(null, ''),
  shipment_window_end: Joi.date().iso().allow(null, ''),
  // Export documents print in KG, or LBS for the USA and Canada. A presentation
  // choice only — the engine stores KG throughout. varchar(3) + CHECK, mig 302.
  doc_weight_unit: Joi.string().valid('kg', 'lb').allow('', null),
  // Freight, structured rather than typed into the document by hand. freight_display
  // picks how it prints: 'in_price' states the real CFR/CIF term and breaks the unit
  // price into FOB + freight inside it; 'separate' keeps the FOB-price-plus-a-freight
  // -line presentation. freight_clause overrides the generated escalation wording.
  freight_per_mt: Joi.number().min(0).allow(null, ''),
  insurance_per_mt: Joi.number().min(0).allow(null, ''),
  freight_basis_date: Joi.date().iso().allow(null, ''),
  freight_valid_until: Joi.date().iso().allow(null, ''),
  freight_display: Joi.string().valid('in_price', 'separate').allow('', null),
  freight_clause: Joi.string().allow('', null),        // text column, unbounded
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
  // A new order may only START in one of the pre-advance states. Later states
  // (Shipped, Closed, Cancelled, ...) are reached through the workflow, which
  // enforces the advance/stock/document gates; creating straight into them
  // skipped every one.
  status: Joi.string().valid('Draft', 'Awaiting Advance', 'Advance Received').default('Draft'),
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
  // Tare of one EMPTY master bag, in grams. With bag_weight_gm it is what the
  // documents add to net to reach a gross the shipping line would agree with.
  master_bag_weight_gm: Joi.number().min(0).allow(null, ''),
  // Batch 7 — structured packing spec (material + packing type + palletized).
  bag_material: Joi.string().valid('Polythene', 'Woven', 'Non-Woven', 'Cotton').allow('', null),
  packing_type: Joi.string().valid('retail', 'jumbo', 'container').default('retail'),
  palletized: Joi.boolean().default(false),
  payment_terms: Joi.string().allow('', null),
  // Days after sailing (BL / departure) the balance falls due (C6, mig 323).
  // Blank → the system setting export_balance_term_days.
  balance_term_days: Joi.number().integer().min(0).max(365).allow(null, ''),
  // #6 — Company bank account whose details print on this order's documents and
  // which its payments settle into. Mandatory at creation.
  bank_account_id: Joi.number().integer().positive().required(),
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
  items: Joi.array().items(exportOrderItem).allow(null),
});

// A Draft is a work in progress: the order is saved so it can be finished later,
// so quantities, prices, the Incoterm and the bank may still be blank or zero.
// The customer stays required, and so does the product (export_orders.product_id
// is NOT NULL). Submitting the draft runs the full check (draftSubmitProblems).
const DRAFT_BLANK = [null, '', 0];
const exportOrderItemDraft = exportOrderItem.keys({
  qty_mt: Joi.number().min(0).allow(...DRAFT_BLANK),
  price_per_mt: Joi.number().min(0).allow(...DRAFT_BLANK),
});
// P2-20: an order edit checks its money / currency fields; every other field
// passes through untouched (.unknown) to the controller's own allow-list.
// booked_fx_rate is read only with a currency change, which re-locks the rate.
const BLANK = ['', null];
const updateExportOrder = Joi.object({
  currency: Joi.string().valid('USD', 'EUR', 'GBP', 'PKR'), // an existing PKR order may re-send its own
  booked_fx_rate: Joi.number().positive().allow(...BLANK),
  qty_mt: Joi.number().min(0).allow(...BLANK),
  price_per_mt: Joi.number().min(0).allow(...BLANK),
  advance_pct: Joi.number().min(0).max(100).allow(...BLANK),
  customer_id: Joi.number().integer().positive().allow(...BLANK),
}).unknown(true);

const createExportOrderDraft = createExportOrder.keys({
  qty_mt: Joi.number().min(0).allow(...DRAFT_BLANK),
  price_per_mt: Joi.number().min(0).allow(...DRAFT_BLANK),
  contract_value: Joi.number().min(0).allow(...DRAFT_BLANK),
  incoterm: Joi.string().valid(
    'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CNF', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'
  ).allow('', null),
  bank_account_id: Joi.number().integer().positive().allow(null, ''),
  items: Joi.array().items(exportOrderItemDraft).allow(null),
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
  destination_port: Joi.string().max(255).allow('', null),
  gate_pass_no: Joi.string().allow('', null),
  // Everything below was read by updateShipment and sent by the Shipment form,
  // but never declared here — so stripUnknown deleted it on arrival. The fields
  // with an `|| order.x` fallback in the controller simply could not be changed;
  // voyage_number, gd_number and gd_date have no fallback, so every shipment
  // save overwrote them with NULL and lost whatever was there.
  // Also settable at creation and from the Overview specs form; the Shipment
  // form is simply the third place it can be corrected. max matches varchar(50).
  contract_number: Joi.string().max(50).allow('', null),
  bl_date: Joi.date().iso().allow(null, ''),
  voyage_number: Joi.string().max(50).allow('', null),
  gd_number: Joi.string().max(100).allow('', null),
  gd_date: Joi.date().iso().allow(null, ''),
  fi_number: Joi.string().max(100).allow('', null),
  fi_number_2: Joi.string().max(100).allow('', null),
  fi_number_3: Joi.string().max(100).allow('', null),
  fi_date: Joi.date().iso().allow(null, ''),
  freight_terms: Joi.string().max(20).allow('', null),
  consignee_type: Joi.string().max(20).allow('', null),
  shipment_window_start: Joi.date().iso().allow(null, ''),
  shipment_window_end: Joi.date().iso().allow(null, ''),
  notify_party_name: Joi.string().max(255).allow('', null),
  notify_party_address: Joi.string().allow('', null),    // text column, unbounded
  notify_party_phone: Joi.string().max(50).allow('', null),
  notify_party_email: Joi.string().max(255).allow('', null),
  shipment_remarks: Joi.string().allow('', null),        // text column, unbounded
  // Company bank account whose details print on this order's documents.
  bank_account_id: Joi.number().integer().positive().allow(null),
  notes: Joi.string().allow('', null),
});

// ── Packaging lines on a milling batch (mig 307) ──
// A line names a real packaging item; its pack_type decides which stock it moves
// and its own price decides what it costs. unit_cost_pkr may be sent to override
// the item's current price (the line snapshots whatever it is given).
const saveBatchPackaging = Joi.object({
  lines: Joi.array().items(Joi.object({
    mill_item_id: Joi.number().integer().positive().required(),
    // 'received' is only valid for a katta or a P.P. bag — the service refuses a
    // master or a polythene sheet, because nothing frees those. Not expressible
    // here: the pack type lives on the item, not in the request.
    direction: Joi.string().valid('received', 'consumed').required(),
    quantity: Joi.number().positive().required(),
    // Only meaningful on a consumed line — the costing formula needs the katta
    // spent on by-products specifically, and nothing else records it.
    output_type: Joi.string().valid('finished', 'byproduct').allow(null, ''),
    unit_cost_pkr: Joi.number().min(0).allow(null, ''),
    notes: Joi.string().allow('', null),
  })).required(),
});

const exportOrderAction = Joi.object({
  notes: Joi.string().allow('', null),
});

// ── Freight escalation debit note (mig 304) ──
// Raised after shipment, when the carrier's actual charge is known. Either give
// the amount outright, or the old and new freight rates and let the service work
// it out — the arithmetic the escalation clause describes.
const issueExportDebitNote = Joi.object({
  amount: Joi.number().positive().allow(null, ''),
  old_rate_per_mt: Joi.number().min(0).allow(null, ''),
  new_rate_per_mt: Joi.number().min(0).allow(null, ''),
  qty_mt: Joi.number().positive().allow(null, ''),
  issue_date: Joi.date().iso().allow(null, ''),
  fx_rate: Joi.number().positive().allow(null, ''),
  basis: Joi.string().valid('freight_escalation', 'insurance', 'surcharge', 'other').allow('', null),
  reason: Joi.string().allow('', null),          // text column, unbounded
}).or('amount', 'new_rate_per_mt').messages({
  'object.missing': 'Enter the amount to claim, or the new freight rate to work it out from.',
});

const cancelExportDebitNote = Joi.object({
  reason: Joi.string().allow('', null),
});

// P2-05: one row per vendor bill, PKR (a foreign bill is converted at entry).
// rice / raw_rice / milling are not order expenses — the rice is costed at
// shipment from stock (5020/1230) and milling is derived from the batch.
const addExportOrderCost = Joi.object({
  category: Joi.string().trim().lowercase().max(50).required()
    .invalid('rice', 'raw_rice', 'milling')
    .messages({ 'any.invalid': 'Rice and milling are costed from stock at shipment and from the milling batch — they cannot be added as an order expense.' }),
  amount: Joi.number().positive().precision(2).max(1e12).required(),
  currency: Joi.string().trim().uppercase().length(3).default('PKR'),
  fx_rate: Joi.number().positive().allow(null, ''),
  notes: Joi.string().max(2000).allow('', null),
  supplier_id: Joi.number().integer().positive().allow(null, ''),
  vendor_name: Joi.string().trim().max(200).allow('', null),
  bill_ref: Joi.string().trim().max(100).allow('', null),
});

// P2-15 / D-7: what happens to money already received when an order is cancelled.
const cancelExportOrder = Joi.object({
  reason: Joi.string().max(2000).allow('', null),
  money_disposition: Joi.string().valid('refund', 'credit', 'forfeit').allow(null, ''),
  refund_bank_account_id: Joi.number().integer().positive().allow(null, ''),
  refund_date: Joi.date().iso().allow(null, ''),
  refund_reference: Joi.string().max(100).allow('', null),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null, ''),
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
  // What the banks deducted from the wire (USD, ≤ the tolerance setting, D-8).
  bank_charges: Joi.number().min(0).allow(null),
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
  // What the banks deducted from the wire (USD, ≤ the tolerance setting, D-8).
  bank_charges: Joi.number().min(0).allow(null),
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
  // The bank's reference for the credit, carried onto the posted receipt.
  bank_reference: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().max(1000).allow(null, ''),
  // What the banks deducted from the wire (USD, ≤ the tolerance setting, D-8).
  bank_charges: Joi.number().min(0).allow(null),
});

// Finance confirms a pending export receipt with the actual FX rate → posts.
const confirmExportReceipt = Joi.object({
  fx_rate: Joi.number().positive().allow(null),
  bank_account_id: Joi.number().integer().positive().allow(null),
  payment_method: Joi.string().max(50).allow(null, ''),
  // Finance may correct the charge the recorder entered.
  bank_charges: Joi.number().min(0).allow(null),
});

// Finance rejects a pending export receipt (not received): the reason is kept
// on the row for whoever recorded it.
const rejectExportReceipt = Joi.object({
  reason: Joi.string().trim().min(1).max(1000).required(),
});

// Owner-approved write-off of a shipped order's short balance (D-8). The
// amount defaults to everything outstanding.
const writeOffExportBalance = Joi.object({
  amount: Joi.number().positive().allow(null),
  reason: Joi.string().trim().min(1).max(1000).required(),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null),
});

const allocateExportStock = Joi.object({
  lot_id: Joi.number().integer().positive().required(),
  qty_mt: Joi.number().positive().required(),
  // Optional export_order_items line this allocation serves (P4b). Without it
  // here, validate()'s stripUnknown would silently drop item_id from the body.
  item_id: Joi.number().integer().positive().allow(null),
  notes: Joi.string().allow('', null),
  // The user is confirming the system's suggested lot (D-18): recorded on the
  // reservation as source 'suggested'.
  suggested: Joi.boolean(),
});

// Packed-weight variance entry (Phase 1). The mill enters net rice + material kg.
const exportPackingWeight = Joi.object({
  packed_net_rice_kg: Joi.number().min(0).required(),
  packing_material_kg: Joi.number().min(0).default(0),
  tolerance_pct: Joi.number().min(0).max(100).default(0.5),
  variance_reason: Joi.string().allow('', null),
});

const createPurchaseLot = Joi.object({
  item_name: Joi.string().max(255).required(),
  type: Joi.string().valid('raw', 'finished', 'byproduct').default('raw'),
  entity: Joi.string().valid('mill', 'export').default('mill'),
  warehouse_id: Joi.number().integer().positive().allow(null),
  product_id: Joi.number().integer().positive().allow(null),
  lot_no: Joi.string().max(50).allow('', null),
  // #7: back-link to the rice sample this lot was converted from (optional).
  sample_id: Joi.number().integer().positive().allow(null),
  supplier_id: Joi.number().integer().positive().allow(null),
  broker_id: Joi.number().integer().positive().allow(null),
  transport_vendor_id: Joi.number().integer().positive().allow(null, ''),
  hauler_id: Joi.number().integer().positive().allow(null, ''),
  // #14 — transport responsibility + operational refs for the transport_costs record.
  transport_paid_by: Joi.string().valid('company', 'supplier', 'customer', 'service_client', 'included_in_supplier_rate', 'deduct_from_supplier', 'other').allow(null, ''),
  transport_doc_no: Joi.string().max(80).allow(null, ''),
  transport_notes: Joi.string().allow(null, ''),
  commission_per_bag: Joi.number().min(0).allow(null),
  commission_total: Joi.number().min(0).allow(null),
  purchase_date: Joi.date().iso().allow(null, ''),
  crop_year: Joi.string().max(20).allow(null, ''),
  variety: Joi.string().allow(null, ''),
  grade: Joi.string().allow(null, ''),
  moisture_pct: Joi.number().min(0).max(100).allow(null),
  broken_pct: Joi.number().min(0).max(100).allow(null),
  sortex_status: Joi.string().valid('Done', 'Pending', 'N/A').allow(null, ''),
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
  // Required (> 0) for a user who can see cost — the controller enforces it.
  // A cost-blind user records the lot unpriced: whatever they send is ignored.
  rate_input: Joi.number().min(0).allow(null, ''),
  rate_unit: Joi.string().valid('katta', 'bag', 'kg', 'maund', 'ton', 'mt').default('katta'),
  transport_cost: Joi.number().min(0).allow(null, '').default(0),
  labor_cost: Joi.number().min(0).default(0),
  unloading_cost: Joi.number().min(0).default(0),
  packing_cost: Joi.number().min(0).default(0),
  other_cost: Joi.number().min(0).default(0),
  total_bags: Joi.number().integer().min(0).allow(null),
  notes: Joi.string().allow(null, ''),
  // No payment_status / paid_amount: the lot's payables start Pending and are
  // settled through the payment flow (bank + journal), never stamped paid here.
  // Optional vehicle arrivals captured on the New Purchase Lot form — each
  // truck that delivered this lot. Only rows with a vehicle_no are recorded.
  vehicles: Joi.array().items(Joi.object({
    vehicle_no: Joi.string().max(50).allow(null, ''),
    driver_name: Joi.string().max(255).allow(null, ''),
    driver_phone: Joi.string().max(50).allow(null, ''),
    weight_kg: Joi.number().min(0).allow(null, ''),
    total_bags: Joi.number().integer().min(0).allow(null, ''),
    bag_size_kg: Joi.number().min(0).allow(null, ''),
    // #4 intake checkpoints: declared weight_kg → weighbridge → accepted.
    weighbridge_kg: Joi.number().min(0).allow(null, ''),
    accepted_kg: Joi.number().min(0).allow(null, ''),
    arrival_date: Joi.date().iso().allow(null, ''),
    departure_date: Joi.date().iso().allow(null, ''),
    // #4 dedicated Gate Pass Number (replaces the free-text notes field) + #3
    // per-truck hauler.
    gate_pass_no: Joi.string().max(80).allow(null, ''),
    hauler_id: Joi.number().integer().positive().allow(null, ''),
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
  transport_cost: Joi.number().min(0).allow(null, '').default(0),
  labor_cost: Joi.number().min(0).default(0),
  unloading_cost: Joi.number().min(0).default(0),
  packing_cost: Joi.number().min(0).default(0),
  other_cost: Joi.number().min(0).default(0),
  bag_cost_per_bag: Joi.number().min(0).allow(null),
  bag_cost_included: Joi.boolean().default(false),
  total_bags: Joi.number().integer().min(0).allow(null),
  // No payment_status / paid_amount — see createPurchaseLot.
  notes: Joi.string().allow(null, ''),
});

// Edit Received: the weighed (received) quantity of a raw purchase lot, plus the
// ordered quantity for the short/over variance. Quantities only — the server
// re-bills at the lot's own rate.
const setLotReceivedQty = Joi.object({
  received_net_weight_kg: Joi.number().positive().required(),
  ordered_net_weight_kg: Joi.number().min(0).allow(null, ''),
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
  hauler_id: Joi.number().integer().positive().allow(null, ''),
});

// Convert a shortlisted rice sample into a purchase lot. Everything optional —
// the service falls back to the sample's own supplier / rice type / offered qty
// and rate. rate_per_kg is ignored for a cost-blind user.
const convertSampleToLot = Joi.object({
  supplier_id: Joi.number().integer().positive().allow(null, ''),
  product_id: Joi.number().integer().positive().allow(null, ''),
  qty_kg: Joi.number().positive().allow(null, ''),
  rate_per_kg: Joi.number().min(0).allow(null, ''),
  purchase_date: Joi.date().iso().allow(null, ''),
  warehouse_id: Joi.number().integer().positive().allow(null, ''),
  item_name: Joi.string().max(255).allow(null, ''),
});

// Edit Price on a raw lot (LotDetail sends { rate_per_kg }).
const setLotPurchaseRate = Joi.object({
  rate_per_kg: Joi.number().positive().required(),
});

// Edit a lot's recorded quality after creation. moisture/broken come through
// quality_json (and are mirrored to the dedicated columns server-side).
const updateLotQuality = Joi.object({
  // Rice type (product) — editable on a raw lot before milling starts; the
  // controller enforces those guards and syncs item_name.
  product_id: Joi.number().integer().positive().allow(null),
  variety: Joi.string().allow(null, ''),
  grade: Joi.string().allow(null, ''),
  sortex_status: Joi.string().valid('Done', 'Pending', 'N/A').allow(null, ''),
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

// ===================== CONTRA TRANSFERS =====================
// Money between the company's own accounts (fundTransfers.createContra). Dates
// stay strings (.raw()) — the service works in YYYY-MM-DD. Every field the
// service reads is declared here: validate() strips anything else.
const ISO_DAY = Joi.date().iso().raw();
const contraTransferFields = {
  from_account_id: Joi.number().integer().positive().required(),
  to_account_id: Joi.number().integer().positive().required(),
  amount: Joi.number().positive().required().messages({ 'number.positive': 'Amount must be greater than zero' }),
  currency: Joi.string().trim().uppercase().length(3).allow(null, ''),
  to_amount: Joi.number().positive().allow(null, ''),
  to_currency: Joi.string().trim().uppercase().length(3).allow(null, ''),
  fx_rate: Joi.number().positive().allow(null, ''),
  rate_date: ISO_DAY.allow(null, ''),
  bank_charges: Joi.number().min(0).allow(null, ''),
  transfer_date: ISO_DAY.allow(null, ''),
  method: Joi.string().valid('cash', 'bank_transfer', 'cheque', 'online').allow(null, ''),
  reference: Joi.string().trim().max(100).required().messages({
    'any.required': 'Reference / transaction number is required',
    'string.empty': 'Reference / transaction number is required',
  }),
  notes: Joi.string().max(2000).allow(null, ''),
  attachment_url: Joi.string().max(500).allow(null, ''),
  attachment_name: Joi.string().max(500).allow(null, ''),
  client_ref: Joi.string().guid().allow(null, ''),
};
const createContraTransfer = Joi.object(contraTransferFields);
const replaceContraTransfer = Joi.object({
  ...contraTransferFields,
  reason: Joi.string().trim().min(1).max(2000).required().messages({
    'any.required': 'A reason is required to edit a transfer',
    'string.empty': 'A reason is required to edit a transfer',
  }),
});
// P2-24: a local sale's money fields. Only these are checked — every other
// field (items[], repacking, buyer, vehicle …) passes through untouched
// (.unknown), so the controller still sees the whole body. The cap paid ≤
// total needs the priced lines, so it is enforced in the controller.
const LOCAL_SALE_MODES = ['cash', 'credit', 'cheque', 'bank_transfer', 'online', 'lc', 'tt', 'wire', 'mobile'];
const localSaleCreate = Joi.object({
  payment_mode: Joi.string().valid(...LOCAL_SALE_MODES).default('cash').messages({
    'any.only': `payment_mode must be one of: ${LOCAL_SALE_MODES.join(', ')}`,
  }),
  paid_amount: Joi.number().min(0).allow(null, ''),
  bank_account_id: Joi.number().integer().positive().allow(null, ''),
  gate_pass_no: Joi.string().trim().max(60).allow(null, ''),
}).unknown(true);
const localSaleReceipt = Joi.object({
  amount: Joi.number().positive().required(),
  payment_method: Joi.string().lowercase().valid(...LOCAL_SALE_MODES.filter((m) => m !== 'credit')).default('cash'),
}).unknown(true);

// P2-19 / D-3: a payment reversal always carries its reason. The Owner's
// approval (authorized_by_owner_id + X-Owner-Credential) is read by
// ownerApproval BEFORE this runs, so it need not survive stripUnknown.
const reversePayment = Joi.object({
  reason: Joi.string().trim().min(1).max(2000).required().messages({
    'any.required': 'A reason is required to reverse a payment',
    'string.empty': 'A reason is required to reverse a payment',
  }),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null, ''),
});

const reverseFundTransfer = Joi.object({
  reason: Joi.string().trim().min(1).max(2000).required().messages({
    'any.required': 'A reason is required to reverse a transfer',
    'string.empty': 'A reason is required to reverse a transfer',
  }),
});

// ===================== PAYMENTS =====================

// Attach a supporting document to a payment already recorded (the file was
// uploaded first through POST /finance/payments/attachment). Metadata only.
const attachPaymentDocument = Joi.object({
  attachment_url: Joi.string().max(255).required(),
  attachment_name: Joi.string().max(255).allow(null, ''),
});

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
  // #14 Phase 1e — withholding tax, early-payment discount, supporting document.
  // wht/discount reduce the CASH paid but not the amount settled against the
  // payable (the vendor's claim is cleared in full; the withheld tax is remitted
  // to FBR and the discount is booked as income). Payments only.
  wht_amount: Joi.number().min(0).allow(null),
  wht_rate: Joi.number().min(0).max(100).allow(null),
  discount_amount: Joi.number().min(0).allow(null),
  attachment_url: Joi.string().allow('', null),
  attachment_name: Joi.string().allow('', null),
});

// P2-31: one settlement across several invoices, in one transaction
// (finance/settleAcross.js). The allocation items carry their own amount and,
// for payments, WHT / discount.
const settleAcross = Joi.object({
  type: Joi.string().valid('receipt', 'payment').required(),
  currency: Joi.string().trim().uppercase().length(3).allow(null, ''),
  payment_method: Joi.string().valid('bank_transfer', 'cash', 'cheque', 'lc', 'tt', 'wire', 'online', 'mobile').required(),
  bank_account_id: Joi.number().integer().positive().allow(null, ''),
  bank_reference: Joi.string().max(200).allow('', null),
  due_date: Joi.date().iso().allow(null, ''),
  payment_date: Joi.date().iso().required(),
  notes: Joi.string().max(2000).allow('', null),
  collection_location: Joi.string().valid('Mill', 'Head Office').allow(null, ''),
  allocations: Joi.array().min(1).max(200).required().items(Joi.object({
    payable_id: Joi.number().integer().positive(),
    receivable_id: Joi.number().integer().positive(),
    sale_group_no: Joi.string().trim().max(60),
    amount: Joi.number().positive().required(),
    wht_amount: Joi.number().min(0).allow(null),
    wht_rate: Joi.number().min(0).max(100).allow(null),
    discount_amount: Joi.number().min(0).allow(null),
  }).xor('payable_id', 'receivable_id', 'sale_group_no')),
});

// ===================== JOURNAL ENTRIES =====================

// Manual journal (POST /api/accounting/journals). The fields are the ones the
// controller reads — this schema existed but was never wired, and its old
// field names (reference_type / reference_id / line description) were not the
// controller's. Lines are PKR (the GL is PKR-base); each carries a debit OR a
// credit. Control accounts are refused by the controller (D-2).
const createJournal = Joi.object({
  date: Joi.date().iso().required(),
  description: Joi.string().trim().min(3).max(1000).required(),
  entity: Joi.string().valid('export', 'mill', 'general').required(),
  ref_type: Joi.string().trim().max(50).allow('', null),
  ref_no: Joi.string().trim().max(50).allow('', null),
  lines: Joi.array().items(
    Joi.object({
      account_id: Joi.number().integer().positive().required(),
      debit: Joi.number().min(0).precision(2).default(0),
      credit: Joi.number().min(0).precision(2).default(0),
      narration: Joi.string().max(240).allow('', null),
      description: Joi.string().max(240).allow('', null),
    }).custom((line, helpers) => {
      const dr = Number(line.debit) || 0;
      const cr = Number(line.credit) || 0;
      if ((dr > 0) === (cr > 0)) return helpers.message('Each journal line needs a debit or a credit (not both, not neither).');
      return line;
    })
  ).min(2).required().messages({
    'array.min': 'Journal entry must have at least 2 lines',
  }),
});

// Reversing a journal (D-2): a reason is mandatory. `authorized_by_owner_id`
// is read by ownerApproval (which runs first) and kept for the audit row.
const reverseJournal = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required(),
  date: Joi.date().iso().allow(null),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null),
});

const reopenPeriod = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required(),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null),
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
  // The "before" snapshot. control.service stores it as
  // `current_data: currentData ? JSON.stringify(currentData) : null`, so being
  // undeclared meant stripUnknown deleted it and the column was ALWAYS null —
  // an approver saw what was proposed but not what it was changing from.
  current_data: Joi.object().allow(null),
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

// PUT /milling/batches/:id — the generic batch edit (EDITABLE_BATCH_FIELDS +
// custom_tags). Status is not editable here; raw qty / supplier / fee are
// further locked once the yield is recorded (P2-08 / MIL-38).
const updateBatch = Joi.object({
  supplier_id: Joi.number().integer().positive().allow(null),
  raw_qty_kg: Joi.number().positive(),
  planned_finished_kg: Joi.number().min(0).allow(null),
  milling_fee_per_kg: Joi.number().min(0).allow(null),
  mill_id: Joi.number().integer().positive(),
  machine_line: Joi.string().max(100).allow('', null),
  shift: Joi.string().valid('Day', 'Night', 'Full'),
  notes: Joi.string().allow('', null),
  variance_status: Joi.string().max(50).allow('', null),
  batch_name: Joi.string().max(200).allow('', null),
  custom_tags: Joi.alternatives().try(
    Joi.array().items(Joi.string().max(60)),
    Joi.string().allow('', null),
  ),
});

// POST /service-milling/invoices (P2-16 / MIL-32). Quantities and rates are
// overrides of the batch's own figures; blank means "use the batch's".
const svcNum = Joi.number().min(0).allow(null, '');
const svcDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/).allow(null, '');
const createServiceInvoice = Joi.object({
  service_batch_id: Joi.number().integer().positive().required(),
  milling_qty_kg: svcNum,
  milling_rate_per_kg: svcNum,
  rental_kattas: Joi.number().integer().min(0).allow(null, ''),
  rental_rate_per_katta: svcNum,
  rental_from: svcDate,
  rental_to: svcDate,
  labour_kattas: Joi.number().integer().min(0).allow(null, ''),
  labour_rate_per_katta: svcNum,
  extra_charges: svcNum,
  discount: svcNum,
  tax_pct: Joi.number().min(0).max(100).allow(null, ''),
  freight_amount: svcNum,
  freight_hauler_id: Joi.number().integer().positive().allow(null, ''),
  invoice_date: svcDate,
  due_date: svcDate,
  notes: Joi.string().max(2000).allow('', null),
});

// POST /service-milling/invoices/:id/void — a reason is mandatory; the owner
// authorization travels as authorized_by_owner_id (+ X-Owner-Credential header).
const voidServiceInvoice = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
  authorized_by_owner_id: Joi.number().integer().positive().allow(null, ''),
});

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
  // Service milling (toll/job-work): client-owned rice, billed for service fees.
  is_service_milling: Joi.boolean().default(false),
  client_customer_id: Joi.number().integer().positive().allow(null),
  service_milling_rate_per_kg: Joi.number().min(0).allow(null, ''),
  service_rental_rate_per_katta: Joi.number().min(0).allow(null, ''),
  service_labour_rate_per_katta: Joi.number().min(0).allow(null, ''),
  date_received: Joi.date().allow(null, ''),
  katta_count: Joi.number().integer().min(0).allow(null, ''),
  bag_count: Joi.number().integer().min(0).allow(null, ''),
  expected_output_kg: Joi.number().min(0).allow(null, ''),
  service_remarks: Joi.string().allow('', null),
  // Incoming trucks (service milling / direct intake). Each records an arrival +
  // receives its rice into the batch raw lot.
  vehicles: Joi.array().items(Joi.object({
    vehicle_no: Joi.string().allow('', null),
    driver_name: Joi.string().allow('', null),
    driver_phone: Joi.string().allow('', null),
    weight_kg: Joi.number().min(0).allow(null, ''),
    total_bags: Joi.number().integer().min(0).allow(null, ''),
    bag_size_kg: Joi.number().min(0).allow(null, ''),
    arrival_date: Joi.date().allow(null, ''),
    notes: Joi.string().allow('', null),
    // Per-truck quality / price — the direct supplier+qty create sends the
    // Rs/kg here as price_per_mt (per MT, like addVehicle). The controller
    // whitelists the keys (sanitizeVehicleQuality).
    quality: Joi.object().unknown(true).allow(null),
  })).allow(null),
}).or('raw_qty_kg', 'source_lots');

const recordYield = Joi.object({
  actual_finished_kg: Joi.number().min(0).required(),
  broken_kg: Joi.number().min(0).default(0),
  bran_kg: Joi.number().min(0).default(0),
  husk_kg: Joi.number().min(0).default(0),
  wastage_kg: Joi.number().min(0).default(0),
});

// Generated-document preview edits (Phase E). `overrides` is a free-form patch
// merged over the frozen snapshot at render time; unknown() keeps its nested
// keys (stripUnknown would otherwise drop the arbitrary document fields).
const saveDocumentOverrides = Joi.object({
  overrides: Joi.object().unknown(true).default({}),
  editedHtml: Joi.string().allow('', null),
});

// Generated-document workflow bodies (Phase F).
const documentSettings = Joi.object({
  bankAccountId: Joi.number().integer().positive().allow(null),
  audience: Joi.string().valid('internal', 'bank', 'chamber', 'customer'),
  copyLabel: Joi.string().valid('ORIGINAL', 'COPY', 'DUPLICATE').allow(null, ''),
});
const documentStatus = Joi.object({
  status: Joi.string().valid('Sent to Bank', 'Sent to Chamber', 'Issued to Customer', 'Cancelled', 'Draft').required(),
});
const documentRevise = Joi.object({
  reason: Joi.string().min(1).required(),
});
const documentCustomerStyle = Joi.object({
  fontFamily: Joi.string().max(80).allow('', null),
  fontScale: Joi.number().min(0.7).max(1.5),
});
// Store the document body as the operator sees it (P1-08). Sanitized on the
// server; PDF / email / WhatsApp render this stored copy, never request HTML.
const saveDocumentRendering = Joi.object({
  html: Joi.string().max(900000).required(),
});
// Approve may carry the body as the approver sees it, stored atomically.
const documentApprove = Joi.object({
  renderedHtml: Joi.string().max(900000).allow('', null),
});
// Send a document to the customer over WhatsApp (QR channel). The server renders
// the STORED version — a posted `html` is no longer accepted (stripped).
const sendDocumentWhatsApp = Joi.object({
  to: Joi.string().max(30).allow('', null),
  caption: Joi.string().max(1024).allow('', null),
  filename: Joi.string().max(120).allow('', null),
});

const sendDocumentEmail = Joi.object({
  to: Joi.string().max(200).allow('', null),
  subject: Joi.string().max(255).allow('', null),
  message: Joi.string().max(4000).allow('', null),
  filename: Joi.string().max(120).allow('', null),
});

// Bundle several documents into one ZIP: stored files by id, plus generated
// documents named by type — the server renders each one's STORED latest version
// (P1-08); HTML posted by an older client is stripped and ignored.
const bundleDocuments = Joi.object({
  uploadedIds: Joi.array().items(Joi.number().integer().positive()).default([]),
  generated: Joi.array().items(Joi.object({
    docType: Joi.string().max(60).required(),
    filename: Joi.string().max(160).allow('', null),
  })).default([]),
  // The sequence to merge in: { k: 'u', id } for an uploaded file, { k: 'g', i }
  // for a generated one. validate() runs with stripUnknown, so a field missing
  // from here never reaches the controller — leaving it out silently disabled
  // the ordering fix in production while the code sat there looking correct.
  order: Joi.array().items(Joi.object({
    k: Joi.string().valid('u', 'g').required(),
    id: Joi.number().integer().positive(),
    i: Joi.number().integer().min(0),
  })),
  // Opt-in contents sheet in front of the combined PDF.
  contentsPage: Joi.boolean().default(false),
  zipName: Joi.string().max(120).allow('', null),
  // 'pdf' merges everything into one file; 'zip' keeps them separate.
  format: Joi.string().valid('zip', 'pdf').default('zip'),
});

const downloadDocumentPdf = Joi.object({
  genId: Joi.number().integer().positive(),
  filename: Joi.string().max(160).allow('', null),
});

// ===================== MILLING — BATCH PACKING =====================

// Correct a packing run (PUT /milling/batches/:id/packing/:logId). Send only
// what changes: an absent field keeps the run's value, null clears the master
// bag / polythene. updateRun in millStore/packing.service reads exactly these.
const updatePackingRun = Joi.object({
  bag_item_id: Joi.number().integer().positive().optional(),
  bags_count: Joi.number().greater(0).optional(),
  notes: Joi.string().trim().max(500).allow(null, '').optional(),
  master_bag_item_id: Joi.number().integer().positive().allow(null).optional(),
  master_bags_count: Joi.number().min(0).allow(null).optional(),
  poly_item_id: Joi.number().integer().positive().allow(null).optional(),
  poly_count: Joi.number().min(0).allow(null).optional(),
  poly_applies_to: Joi.string().valid('bag', 'master', 'both').allow(null, '').optional(),
});

// A batch's packing-spec override (PUT /milling/batches/:id/packing-spec).
// pack_bag_size_kg null (with the rest null) clears the override.
const batchPackSpec = Joi.object({
  pack_bag_size_kg: Joi.number().greater(0).max(5000).allow(null).required(),
  pack_bag_type: Joi.string().trim().max(100).allow(null, '').optional(),
  pack_master_bag_size_kg: Joi.number().greater(0).max(5000).allow(null).optional(),
});

// ===================== BANK ACCOUNTS (Admin master) =====================
// Descriptive columns only — bankAccounts.service decides what a save may touch.
// current_balance is declared so the service can SEE it and refuse a changed
// balance (400) rather than have stripUnknown hide the attempt; it is never written
// on update. On create it is the legacy name for opening_balance.
const optStr = (max) => Joi.string().trim().max(max).allow('', null);
const bankAccountFields = {
  bank_name: optStr(255),
  account_number: optStr(255),
  branch: optStr(255),
  type: Joi.string().valid('bank', 'cash', 'lc', 'mobile_money'),
  currency: Joi.string().trim().uppercase().length(3),
  entity: Joi.string().valid('general', 'mill', 'export'),
  account_title: optStr(255),
  iban: optStr(255),
  swift_bic: optStr(255),
  bank_address: Joi.string().allow('', null),
  correspondent_bank_name: optStr(255),
  correspondent_swift: optStr(255),
  correspondent_account: optStr(255),
  is_active: Joi.boolean(),
  is_export_default: Joi.boolean(),
  approved_for_customer: Joi.boolean(),
  is_favorite: Joi.boolean(),
  current_balance: Joi.number().allow(null, ''),
};
const createBankAccount = Joi.object({
  ...bankAccountFields,
  name: Joi.string().trim().max(255).required(),
  opening_balance: Joi.number().allow(null, ''),
  opening_fx_rate: Joi.number().greater(0).allow(null, ''),
});
const updateBankAccount = Joi.object({
  ...bankAccountFields,
  name: Joi.string().trim().max(255),
});

// POST /api/accounting/fx-revaluation — month-end FX revaluation (G-7).
const fxRevaluation = Joi.object({
  month_end: Joi.string().trim().pattern(/^\d{4}-\d{2}(-\d{2})?$/).required(),
  currency: Joi.string().trim().uppercase().length(3).default('USD'),
  rerun: Joi.boolean().default(false),
  preview: Joi.boolean().default(false),
});

// POST /api/finance/payments/:id/bounce — an uncleared cheque bounced (B1).
// The bank's return charge is optional; it is in the charged account's own
// currency and taken from charge_account_id (default: the cheque's account).
const bounceCheque = Joi.object({
  reason: Joi.string().trim().min(1).max(2000).required().messages({
    'any.required': 'A reason is required to mark a cheque bounced',
    'string.empty': 'A reason is required to mark a cheque bounced',
  }),
  bank_charge: Joi.number().min(0).allow(null, ''),
  charge_date: Joi.date().iso().raw().allow(null, ''),
  charge_account_id: Joi.number().integer().positive().allow(null, ''),
});

// Bank reconciliation (B5) — /api/accounting/reconciliations.
const createReconciliation = Joi.object({
  bank_account_id: Joi.number().integer().positive().required(),
  statement_date: Joi.date().iso().raw().required(),
  statement_balance: Joi.number().required(),
  notes: Joi.string().max(2000).allow(null, ''),
});
const saveReconciliationTicks = Joi.object({
  bank_transaction_ids: Joi.array().items(Joi.number().integer().positive()).required(),
  statement_balance: Joi.number().allow(null, ''),
});
const reconciliationStatementLines = Joi.object({
  items: Joi.array().min(1).max(5000).items(Joi.object({
    date: Joi.date().iso().raw().allow(null, ''),
    reference: Joi.string().max(255).allow(null, ''),
    amount: Joi.number().required(),
    notes: Joi.string().max(2000).allow(null, ''),
  })).required(),
});

// ===================== SYSTEM SETTINGS =====================
// PUT /api/admin/settings — allowlist of the keys something actually reads
// (each comment names the reader). Validated STRICTLY by the controller (an
// unknown key is a 400, not silently stripped) so a typo or a camelCase key the
// backend never reads cannot be "saved".
const settingStr = (max = 200) => Joi.string().trim().max(max).allow('', null);
const updateSettings = Joi.object({
  // portal.routes companyProfile(), AppContext companyProfileData (print headers)
  companyProfile: Joi.object({
    name: settingStr(200), tagline: settingStr(200), address: settingStr(500),
    phone: settingStr(100), email: settingStr(200), website: settingStr(200), ntn: settingStr(50),
  }).unknown(true),
  // intelligence.service scanOverdueAdvances; finance Confirmations page
  payment_reminder_days: Joi.number().integer().min(1).max(365),
  // automation.service scanLowMarginOrders
  min_margin_pct: Joi.number().min(0).max(100),
  // Legacy key, kept so older clients can still save settings. Nothing
  // converts with it any more (D-10: no fallback FX rate — rates are kept per
  // currency in fx_rates through POST /finance/fx-rates; addRate mirrors the
  // latest USD rate here for display only).
  pkr_rate: Joi.number().positive().max(100000),
  // finance/collectionRate.js
  export_balance_term_days: Joi.number().integer().min(0).max(365),
  collection_target_pct: Joi.number().min(0).max(100),
  // exportDocument.controller company fields
  default_hs_code: settingStr(30),
  rex_number: settingStr(50),
  kcci_membership: settingStr(50),
  port_of_loading: settingStr(100),
  // communications/whatsapp.service getWhatsAppSettings (api key is write-only)
  whatsapp_provider: settingStr(50),
  whatsapp_api_url: settingStr(500),
  whatsapp_api_key: settingStr(1000),
  whatsapp_sender_phone: settingStr(30),
})
  // collection_target_pct_USD / _PKR … (collectionRate.collectionTargets)
  .pattern(/^collection_target_pct_[A-Za-z]{3}$/, Joi.number().min(0).max(100))
  .min(1);

module.exports = {
  bounceCheque,
  createReconciliation,
  saveReconciliationTicks,
  reconciliationStatementLines,
  fxRevaluation,
  attachPaymentDocument,
  createBankAccount,
  updateBankAccount,
  bundleDocuments,
  createExportOrder,
  createExportOrderDraft,
  updateExportOrder,
  updateExportShipment,
  exportPackingWeight,
  exportOrderAction,
  saveBatchPackaging,
  issueExportDebitNote,
  cancelExportDebitNote,
  addExportOrderCost,
  cancelExportOrder,
  exportOrderDocumentAction,
  confirmAdvance,
  confirmBalance,
  recordExportReceipt,
  rejectExportReceipt,
  writeOffExportBalance,
  confirmExportReceipt,
  setExportReady,
  allocateExportStock,
  createPurchaseLot,
  addPurchaseToLot,
  setLotReceivedQty,
  recordLotTransaction,
  updateLotCosts,
  setLotPurchaseRate,
  convertSampleToLot,
  updateLotQuality,
  createAdvance,
  allocateAdvance,
  recordPayment,
  createContraTransfer,
  replaceContraTransfer,
  reverseFundTransfer,
  reversePayment,
  settleAcross,
  localSaleCreate,
  localSaleReceipt,
  createJournal,
  reverseJournal,
  reopenPeriod,
  stockAdjustment,
  submitApproval,
  rejectApproval,
  createBatch,
  updateBatch,
  createServiceInvoice,
  voidServiceInvoice,
  recordYield,
  saveDocumentOverrides,
  saveDocumentRendering,
  documentApprove,
  documentSettings,
  documentStatus,
  documentRevise,
  documentCustomerStyle,
  sendDocumentWhatsApp,
  sendDocumentEmail,
  downloadDocumentPdf,
  updatePackingRun,
  batchPackSpec,
  updateSettings,
};
