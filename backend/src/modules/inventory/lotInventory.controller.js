/**
 * RiceFlow ERP — Lot-Based Inventory Controller
 * Full lot CRUD, purchase-to-lot creation, transactions, costing, reports.
 * All quantities stored in KG; display units derived at read time.
 */

const db = require('../../config/database');
const uc = require('../../services/unitConversion');
const accountingService = require('../../services/accountingService');
// Shared lot-number generators — keeps the Purchase Lot drawer and the
// Add Vehicle flow on the same SUP-VARIETY-YYMMDD-SEQ format.
const inventoryService = require('./inventory.service');
const { blendPurchaseIntoLot } = require('./lotCosting');

async function generateTxnNo(trx) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await trx('lot_transactions').count('id as c').first();
  return `TXN-${today}-${String((count?.c || 0) + 1).padStart(4, '0')}`;
}

// Whitelist + coerce the extended quality payload for inventory_lots.quality_json.
// Numeric percentages are clamped to 0–100 implicitly by parseFloat; keys are
// fixed so the jsonb column can't be polluted with arbitrary data.
const LOT_QUALITY_KEYS = [
  // Percentages from the milling quality sample sheet
  'moisture', 'broken', 'chalky', 'foreign_matter', 'discoloration',
  'purity', 'grain_size', 'whiteness',
  // Pakistani grade breakdown
  'b1', 'b2', 'b3', 'csr', 'short_grain', 'cobba', 'nb', 'ov',
  // Price (optional — for arrival pricing override)
  'price_per_mt', 'price_per_kg',
  // Free text
  'notes',
];
function sanitizeLotQuality(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of LOT_QUALITY_KEYS) {
    const v = raw[k];
    if (v == null || v === '') continue;
    if (k === 'notes') {
      out[k] = String(v).slice(0, 500);
    } else {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) out[k] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

async function generatePayNo(trx) {
  // Only consider the bare PAY-NNN namespace used by lot payables.
  // Other sequences (PAY-EXP*, PAY-MS*, PAY-EOC*) live in payables too
  // but mustn't bump this counter — that's what was producing collisions:
  // last.pay_no = 'PAY-EXP0003' → parseInt('EXP0003') = NaN → seq reset
  // to 1 → conflict with the long-existing PAY-001 row.
  const last = await trx('payables')
    .whereRaw("pay_no ~ '^PAY-[0-9]+$'")
    .select('pay_no')
    .orderByRaw("CAST(SUBSTRING(pay_no FROM 5) AS INTEGER) DESC")
    .first();

  if (!last || !last.pay_no) {
    return 'PAY-001';
  }

  const num = parseInt(last.pay_no.replace('PAY-', ''), 10) || 0;
  return `PAY-${String(num + 1).padStart(3, '0')}`;
}

function addDays(dateValue, days) {
  const base = new Date(dateValue || new Date().toISOString().slice(0, 10));
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Compute derived unit fields from KG-based lot */
function enrichLot(lot) {
  if (!lot) return lot;
  const bw = parseFloat(lot.bag_weight_kg) || 50;
  const rawNetKg = parseFloat(lot.net_weight_kg) || 0;
  const netKg = rawNetKg > 0 ? rawNetKg : (parseFloat(lot.qty) || 0) * 1000;
  const availKg = (parseFloat(lot.available_qty) || 0) * 1000; // available_qty is in MT
  const reservedKg = (parseFloat(lot.reserved_qty) || 0) * 1000; // reserved_qty is in MT
  const soldKg = parseFloat(lot.sold_weight_kg) || 0;
  const damagedKg = parseFloat(lot.damaged_weight_kg) || 0;
  const rateKg = parseFloat(lot.rate_per_kg) || (parseFloat(lot.cost_per_unit) || 0) / 1000;
  const landedKg = parseFloat(lot.landed_cost_per_kg) || rateKg;

  return {
    ...lot,
    // Derived quantity equivalents
    total_katta: uc.kgToKatta(netKg, bw),
    total_maund: uc.kgToMaund(netKg),
    total_ton: uc.kgToTon(netKg),
    available_katta: uc.kgToKatta(availKg, bw),
    available_maund: uc.kgToMaund(availKg),
    available_ton: uc.kgToTon(availKg),
    reserved_katta: uc.kgToKatta(reservedKg, bw),
    reserved_maund: uc.kgToMaund(reservedKg),
    sold_katta: uc.kgToKatta(soldKg, bw),
    sold_maund: uc.kgToMaund(soldKg),
    damaged_katta: uc.kgToKatta(damagedKg, bw),
    damaged_maund: uc.kgToMaund(damagedKg),
    // Derived rate equivalents
    rate_per_katta: uc.ratePerKgToKatta(rateKg, bw),
    rate_per_maund: uc.ratePerKgToMaund(rateKg),
    rate_per_ton: uc.ratePerKgToTon(rateKg),
    landed_cost_per_katta: uc.ratePerKgToKatta(landedKg, bw),
    landed_cost_per_maund: uc.ratePerKgToMaund(landedKg),
    landed_cost_per_ton: uc.ratePerKgToTon(landedKg),
  };
}

// Assemble the full detail bundle for ONE lot row (already fetched with the
// warehouse/product/supplier joins). Shared by the single-lot detail endpoint
// and the multi-lot printable report so both stay in lockstep.
async function buildLotDetail(lot) {
  const transactions = await db('lot_transactions')
    .where({ lot_id: lot.id })
    .orderBy('transaction_date', 'desc')
    .orderBy('created_at', 'desc');

  const reservations = await db('inventory_reservations as r')
    .leftJoin('export_orders as eo', 'r.order_id', 'eo.id')
    .select('r.*', 'eo.order_no')
    .where({ 'r.lot_id': lot.id });

  // Milling batches consuming this lot — surfaced via batch_source_lots.
  const millingBatches = await db('batch_source_lots as bsl')
    .join('milling_batches as mb', 'bsl.batch_id', 'mb.id')
    .where('bsl.lot_id', lot.id)
    .select(
      'mb.id', 'mb.batch_no', 'mb.status', 'mb.pass_number',
      'mb.parent_batch_id', 'mb.raw_qty_mt', 'mb.actual_finished_mt',
      'mb.yield_pct', 'mb.created_at', 'mb.completed_at',
      'bsl.qty_mt as source_qty_mt'
    )
    .orderBy('mb.pass_number', 'asc')
    .orderBy('mb.created_at', 'asc');

  // The lot's own batch's full quality analysis (arrival + post-milling) + the
  // grade-split yield, so the lot's Quality Specifications can show the complete
  // sheet a finished/raw lot inherits — not just the moisture/broken on the row.
  let batchQuality = null;
  let batchYield = null;
  const brMatch = /^batch-(\d+)$/.exec(lot.batch_ref || '');
  const ownBatchId = brMatch ? parseInt(brMatch[1], 10) : null;
  if (ownBatchId) {
    const [arrival, post, byield, rawCost] = await Promise.all([
      db('milling_quality_samples').where({ batch_id: ownBatchId, analysis_type: 'arrival' })
        .orderBy('created_at', 'desc').first(),
      db('milling_quality_post').where({ batch_id: ownBatchId }).orderBy('created_at', 'desc').first(),
      db('milling_batches').where({ id: ownBatchId }).first(
        'raw_qty_mt', 'actual_finished_mt', 'broken_mt', 'b1_mt', 'b2_mt', 'b3_mt', 'csr_mt',
        'short_grain_mt', 'bran_mt', 'husk_mt', 'sortex_rejects_mt',
        'powder_mt', 'sweeping_mt', 'post_milling_grade'),
      db('milling_costs').where({ batch_id: ownBatchId, category: 'raw_rice' }).sum('amount as t').first(),
    ]);
    if (arrival || post) batchQuality = { arrival: arrival || null, post: post || null };
    batchYield = byield || null;
    // Purchase rate of the raw rice this lot was milled from = batch raw-rice
    // cost ÷ raw input kg. Shared by every output (finished + by-product) of the
    // batch. A produced lot has no purchase rate of its own; this is the rate the
    // operator actually paid for the input rice.
    const rawTotal = parseFloat(rawCost?.t) || 0;
    const rawKg = (parseFloat(byield?.raw_qty_mt) || 0) * 1000;
    lot.raw_purchase_rate_per_kg = (rawTotal > 0 && rawKg > 0) ? rawTotal / rawKg : null;
  }

  // Blend recipe — for a blended OUTPUT lot, the varieties + ratios + per-source
  // suppliers that were milled to make it.
  let blendRecipe = null;
  if (lot.blend_batch_no) {
    const batch = await db('milling_batches')
      .where({ batch_no: lot.blend_batch_no })
      .first('id', 'batch_no', 'raw_qty_mt');
    if (batch) {
      const inputs = await db('batch_source_lots as bsl')
        .leftJoin('inventory_lots as il', 'bsl.lot_id', 'il.id')
        .leftJoin('products as ilp', 'il.product_id', 'ilp.id')
        .leftJoin('suppliers as ils', 'il.supplier_id', 'ils.id')
        .where('bsl.batch_id', batch.id)
        .select(
          'bsl.qty_mt', 'bsl.ratio_pct', 'bsl.variety', 'bsl.lot_type', 'bsl.unit_cost_pkr',
          'il.lot_no as source_lot_no', 'il.variety as lot_variety',
          'il.item_name as lot_item_name', 'ilp.name as lot_product_name',
          'il.supplier_id as source_supplier_id', 'ils.name as source_supplier_name',
          'il.moisture_pct as lot_moisture', 'il.broken_pct as lot_broken',
          'il.grade as lot_grade', 'il.whiteness as lot_whiteness',
        )
        .orderBy('bsl.qty_mt', 'desc');
      const supMap = {};
      for (const i of inputs) {
        if (i.source_supplier_id && !supMap[i.source_supplier_id]) supMap[i.source_supplier_id] = i.source_supplier_name;
      }
      blendRecipe = {
        batch_no: batch.batch_no,
        raw_qty_mt: parseFloat(batch.raw_qty_mt) || 0,
        suppliers: Object.entries(supMap).map(([id, name]) => ({ id: Number(id), name })),
        inputs: inputs.map((i) => {
          const variety = i.variety || i.lot_variety || i.lot_item_name || i.lot_product_name || 'Unknown';
          return {
            variety,
            variety_known: !!(i.variety || i.lot_variety),
            qty_mt: parseFloat(i.qty_mt) || 0,
            ratio_pct: i.ratio_pct != null ? parseFloat(i.ratio_pct) : null,
            unit_cost_pkr: i.unit_cost_pkr != null ? parseFloat(i.unit_cost_pkr) : null,
            source_lot_no: i.source_lot_no || null,
            lot_type: i.lot_type || null,
            supplier_id: i.source_supplier_id || null,
            supplier_name: i.source_supplier_name || null,
            moisture: i.lot_moisture != null ? parseFloat(i.lot_moisture) : null,
            broken: i.lot_broken != null ? parseFloat(i.lot_broken) : null,
            grade: i.lot_grade || null,
            whiteness: i.lot_whiteness != null ? parseFloat(i.lot_whiteness) : null,
          };
        }),
      };
    }
  }

  return { lot: enrichLot(lot), transactions, reservations, millingBatches, blendRecipe, batchQuality, batchYield };
}

// Fetch a lot row (by numeric id or lot_no) with the standard display joins.
function lotRowQuery() {
  return db('inventory_lots as l')
    .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
    .leftJoin('products as p', 'l.product_id', 'p.id')
    .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
    .select('l.*', 'w.name as warehouse_name', 'p.name as product_name', 'p.code as product_code', 's.name as supplier_name');
}

module.exports = {

  // ─── List Lots ───
  async listLots(req, res) {
    try {
      const { page = 1, limit = 50, type, entity, warehouse_id, status, supplier_id, variety, search, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
      const offset = (page - 1) * limit;

      let query = db('inventory_lots as l')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .select(
          'l.*',
          'w.name as warehouse_name',
          'p.name as product_name',
          'p.code as product_code',
          's.name as supplier_name'
        );

      if (type) query = query.where('l.type', type);
      if (entity) query = query.where('l.entity', entity);
      if (warehouse_id) query = query.where('l.warehouse_id', warehouse_id);
      if (status) query = query.where('l.status', status);
      if (supplier_id) query = query.where('l.supplier_id', supplier_id);
      if (variety) query = query.where('l.variety', 'ilike', `%${variety}%`);
      if (search) {
        query = query.where(function () {
          this.where('l.lot_no', 'ilike', `%${search}%`)
            .orWhere('l.item_name', 'ilike', `%${search}%`)
            .orWhere('l.variety', 'ilike', `%${search}%`)
            .orWhere('l.grade', 'ilike', `%${search}%`)
            .orWhere('p.code', 'ilike', `%${search}%`)
            .orWhere('p.name', 'ilike', `%${search}%`)
            .orWhere('s.name', 'ilike', `%${search}%`);
        });
      }

      const [{ count: total }] = await query.clone().clearSelect().count('l.id as count');
      const lots = await query.orderBy(`l.${sort_by}`, sort_dir).limit(limit).offset(offset);

      return res.json({
        success: true,
        data: {
          lots: lots.map(enrichLot),
          pagination: { page: +page, limit: +limit, total: +total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (err) {
      console.error('listLots error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Get Lot Detail ───
  async getLotDetail(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const where = isNumeric ? { 'l.id': +id } : { 'l.lot_no': id };

      const lot = await lotRowQuery().where(where).first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });

      return res.json({ success: true, data: await buildLotDetail(lot) });
    } catch (err) {
      console.error('getLotDetail error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Multi-lot printable report ───
  // Returns the FULL detail bundle for several lots at once so the Lot Reports
  // page can render/print one or many lots. Accepts either an explicit list of
  // ids (?ids=1,2,3) or the same filters as listLots (type/entity/warehouse_id/
  // status/supplier_id/variety/search) to report a whole filtered set.
  async getLotsReport(req, res) {
    try {
      const { ids, type, entity, warehouse_id, status, supplier_id, variety, search, limit = 100 } = req.query;
      const cap = Math.min(parseInt(limit, 10) || 100, 200);

      let rows;
      if (ids) {
        const idList = String(ids).split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
        if (!idList.length) return res.json({ success: true, data: { lots: [], generatedAt: new Date().toISOString() } });
        // Preserve the caller's id order so the printed report matches selection.
        const fetched = await lotRowQuery().whereIn('l.id', idList.slice(0, cap));
        const byId = new Map(fetched.map(l => [l.id, l]));
        rows = idList.map(id => byId.get(id)).filter(Boolean);
      } else {
        let q = lotRowQuery();
        if (type) q = q.where('l.type', type);
        if (entity) q = q.where('l.entity', entity);
        if (warehouse_id) q = q.where('l.warehouse_id', warehouse_id);
        if (status) q = q.where('l.status', status);
        if (supplier_id) q = q.where('l.supplier_id', supplier_id);
        if (variety) q = q.where('l.variety', 'ilike', `%${variety}%`);
        if (search) {
          q = q.where(function () {
            this.where('l.lot_no', 'ilike', `%${search}%`)
              .orWhere('l.item_name', 'ilike', `%${search}%`)
              .orWhere('l.variety', 'ilike', `%${search}%`)
              .orWhere('l.grade', 'ilike', `%${search}%`);
          });
        }
        rows = await q.orderBy('l.created_at', 'desc').limit(cap);
      }

      // Build detail sequentially to keep the connection pool sane on large sets.
      const lots = [];
      for (const row of rows) lots.push(await buildLotDetail(row));

      return res.json({ success: true, data: { lots, generatedAt: new Date().toISOString() } });
    } catch (err) {
      console.error('getLotsReport error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Create Lot from Purchase ───
  async createPurchaseLot(req, res) {
    try {
      const {
        item_name, type = 'raw', entity = 'mill', warehouse_id, product_id,
        supplier_id, broker_id, purchase_date, crop_year,
        variety, grade, moisture_pct, broken_pct, sortex_status, whiteness, quality_notes,
        // Extended quality (B1/B2/B3/Cobba/CSR/NB/OV percentages, etc.).
        // Stored as jsonb so we can add fields without further migrations.
        quality, quality_json,
        bag_type, bag_quality, bag_size_kg, bag_weight_gm, bag_color,
        bag_cost_per_bag, bag_cost_included,
        // Quantity — user enters in chosen unit
        quantity_input, quantity_unit = 'katta', bag_weight_kg = 50,
        // Rate — user enters in chosen unit
        rate_input, rate_unit = 'katta',
        // Additional costs
        transport_cost = 0, labor_cost = 0, unloading_cost = 0,
        packing_cost = 0, other_cost = 0,
        total_bags: inputTotalBags,
        notes, payment_status = 'Pending',
      } = req.body;

      // Whitelist + coerce extended quality keys so callers can't shove
      // arbitrary payload into the jsonb column.
      const cleanQuality = sanitizeLotQuality(quality_json || quality);

      // Field-by-field validation so the operator sees what's missing.
      const missing = [];
      if (!item_name)               missing.push('rice type');
      if (quantity_input == null || quantity_input === '' || !(parseFloat(quantity_input) > 0)) missing.push('weight');
      if (rate_input == null || rate_input === '' || !(parseFloat(rate_input) > 0))             missing.push('price');
      // Rice purchase lots must record who they came from — otherwise the
      // ledger and supplier payables can't reconcile.
      if (type === 'raw' && entity === 'mill' && !supplier_id) missing.push('supplier');
      if (type === 'raw' && entity === 'mill' && !product_id)  missing.push('rice type (product)');
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: `Please fill in: ${missing.join(', ')}.`,
          missing,
        });
      }

      const bagWt = parseFloat(bag_weight_kg) || 50;
      const netWeightKg = uc.toKg(quantity_input, quantity_unit, bagWt);
      const ratePerKg = uc.rateToPerKg(rate_input, rate_unit, bagWt);
      const totalBags = inputTotalBags || (quantity_unit === 'katta' || quantity_unit === 'bag' ? Math.round(parseFloat(quantity_input)) : Math.round(netWeightKg / bagWt));
      const purchaseAmount = uc.round2(netWeightKg * ratePerKg);

      // Landed cost calculation
      const directCosts = [transport_cost, labor_cost, unloading_cost, packing_cost, other_cost].reduce((s, c) => s + (parseFloat(c) || 0), 0);
      const totalBagCost = (bag_cost_included ? 0 : (parseFloat(bag_cost_per_bag) || 0) * totalBags);
      const landedCostTotal = uc.round2(purchaseAmount + directCosts + totalBagCost);
      const landedCostPerKg = netWeightKg > 0 ? uc.round4(landedCostTotal / netWeightKg) : 0;
      // Post round 35 (migration 120) every payment_status column uses
      // title case — drop the previous lowercase normalisation.
      const normalizedPaymentStatus = String(payment_status || 'Pending');
      const landedPayableAmount = landedCostTotal;
      const paidAmount = normalizedPaymentStatus === 'Paid'
        ? landedPayableAmount
        : normalizedPaymentStatus === 'Partial'
          ? Math.max(0, Math.min(landedPayableAmount, parseFloat(req.body.paid_amount) || 0))
          : Math.max(0, parseFloat(req.body.paid_amount) || 0);
      const payableStatus = paidAmount >= landedPayableAmount - 0.01
        ? 'Paid'
        : paidAmount > 0
          ? 'Partial'
          : 'Pending';

      const result = await db.transaction(async (trx) => {
        // Generate lot number. Rice lots received at the mill get the
        // SUP-VARIETY-YYMMDD-SEQ format (matches receiveRice); everything
        // else falls back to the legacy LOT-YYYYMMDD-XXXX so old
        // workflows (finished goods, byproducts) stay consistent.
        let lotNo;
        if (type === 'raw' && entity === 'mill' && supplier_id && product_id) {
          lotNo = await inventoryService.generateRiceLotNo(trx, {
            supplierId: parseInt(supplier_id, 10),
            productId: parseInt(product_id, 10),
            date: purchase_date,
          });
        } else {
          lotNo = await inventoryService.generateLotNo(trx);
        }

        // warehouse_id is NOT NULL on inventory_lots — resolve a sensible
        // default based on type/entity if the wizard didn't supply one.
        let resolvedWarehouseId = warehouse_id || null;
        if (!resolvedWarehouseId) {
          const matchType = type === 'finished' ? 'finished'
            : type === 'byproduct' ? 'byproduct'
            : 'raw';
          let wh = await trx('warehouses')
            .where({ entity: entity || 'mill', type: matchType, is_active: true })
            .orderBy('id', 'asc').first();
          if (!wh) {
            // Fallback: any warehouse for the entity
            wh = await trx('warehouses').where({ entity: entity || 'mill', is_active: true }).orderBy('id', 'asc').first();
          }
          if (!wh) {
            // Last resort: create a default warehouse so the insert can proceed
            const [created] = await trx('warehouses').insert({
              name: entity === 'export' ? 'Export Warehouse' : `Mill ${matchType === 'raw' ? 'Raw Stock' : matchType === 'finished' ? 'Finished' : 'By-products'}`,
              entity: entity || 'mill',
              type: matchType,
              is_active: true,
            }).returning('*');
            wh = created;
          }
          resolvedWarehouseId = wh.id;
        }

        // product_id is NOT NULL on inventory_lots since round 067 —
        // resolve a fallback when the wizard didn't pick one.
        // Type-aware: raw → RAW-RICE (legacy: RAW-PADDY), finished →
        // FINISHED-RICE, byproduct → first byproduct product. Always
        // succeeds (last resort: any non-raw-input product) so the
        // insert can proceed.
        let resolvedProductId = product_id || null;
        if (!resolvedProductId) {
          if (type === 'finished') {
            const p = await trx('products').where({ code: 'FINISHED-RICE' }).first('id');
            if (p) resolvedProductId = p.id;
          } else if (type === 'raw') {
            let p = await trx('products').where({ code: 'RAW-RICE' }).first('id');
            if (!p) p = await trx('products').where({ code: 'RAW-PADDY' }).first('id');
            if (p) resolvedProductId = p.id;
          }
          if (!resolvedProductId && type === 'byproduct') {
            const p = await trx('products').where({ is_byproduct: true }).orderBy('id').first('id');
            if (p) resolvedProductId = p.id;
          }
          if (!resolvedProductId) {
            const p = await trx('products')
              .where({ is_byproduct: false })
              .whereNotIn('code', ['RAW-RICE', 'RAW-PADDY'])
              .orderBy('id').first('id');
            if (p) resolvedProductId = p.id;
          }
          if (!resolvedProductId) {
            // Truly empty products table — refuse rather than crash with
            // a confusing constraint message.
            throw new Error('Cannot resolve product_id for new lot: no products exist. Seed at least one product first.');
          }
        }

        const [lot] = await trx('inventory_lots').insert({
          lot_no: lotNo,
          item_name,
          type,
          entity,
          warehouse_id: resolvedWarehouseId,
          product_id: resolvedProductId,
          qty: uc.kgToTon(netWeightKg), // legacy field in MT
          unit: 'MT',
          status: 'Available',
          // Supplier
          supplier_id: supplier_id || null,
          broker_id: broker_id || null,
          purchase_date: purchase_date || new Date().toISOString().slice(0, 10),
          crop_year: crop_year || null,
          // Quality
          variety: variety || null,
          grade: grade || null,
          moisture_pct: moisture_pct || null,
          broken_pct: broken_pct || null,
          sortex_status: sortex_status || null,
          whiteness: whiteness || null,
          quality_notes: quality_notes || null,
          quality_json: cleanQuality,
          // Bags
          bag_type: bag_type || null,
          bag_quality: bag_quality || null,
          bag_size_kg: bag_size_kg || null,
          bag_weight_gm: bag_weight_gm || null,
          bag_color: bag_color || null,
          bag_cost_per_bag: bag_cost_per_bag || 0,
          bag_cost_included: !!bag_cost_included,
          // Units
          standard_unit_type: quantity_unit || 'katta',
          bag_weight_kg: bagWt,
          total_bags: totalBags,
          gross_weight_kg: netWeightKg,
          net_weight_kg: netWeightKg,
          received_net_weight_kg: netWeightKg, // immutable original intake
          // Pricing
          rate_input_unit: rate_unit,
          rate_input_value: parseFloat(rate_input),
          rate_per_kg: ratePerKg,
          purchase_amount: purchaseAmount,
          // Costs
          transport_cost: parseFloat(transport_cost) || 0,
          labor_cost: parseFloat(labor_cost) || 0,
          unloading_cost: parseFloat(unloading_cost) || 0,
          packing_cost: parseFloat(packing_cost) || 0,
          other_cost: parseFloat(other_cost) || 0,
          total_bag_cost: totalBagCost,
          landed_cost_total: landedCostTotal,
          landed_cost_per_kg: landedCostPerKg,
          // Stock
          available_qty: netWeightKg / 1000, // legacy field in MT
          reserved_qty: 0,
          sold_weight_kg: 0,
          damaged_weight_kg: 0,
          cost_per_unit: landedCostPerKg * 1000, // per MT for legacy
          total_value: landedCostTotal,
          // Payment — title case across the board post migration 120.
          payment_status: payableStatus,
          paid_amount: paidAmount,
          due_amount: Math.max(0, landedPayableAmount - paidAmount),
          notes: notes || null,
          created_by: req.user?.id || null,
        }).returning('*');

        // Create initial purchase_in transaction
        const txnNo = await generateTxnNo(trx);
        await trx('lot_transactions').insert({
          transaction_no: txnNo,
          transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
          lot_id: lot.id,
          transaction_type: 'purchase_in',
          reference_module: 'purchase',
          warehouse_to_id: resolvedWarehouseId,
          input_unit: quantity_unit,
          input_qty: parseFloat(quantity_input),
          quantity_kg: netWeightKg,
          quantity_bags: totalBags,
          rate_input_unit: rate_unit,
          rate_input_value: parseFloat(rate_input),
          rate_per_kg: ratePerKg,
          cost_impact: landedCostTotal,
          currency: 'PKR',
          balance_kg: netWeightKg,
          balance_bags: totalBags,
          remarks: `Purchase: ${parseFloat(quantity_input)} ${quantity_unit} @ ${parseFloat(rate_input)}/${rate_unit}`,
          created_by: req.user?.id || null,
          performed_by: req.user?.id || null,
          performed_at: new Date(),
        });

        // Also create legacy inventory_movements entry
        await trx('inventory_movements').insert({
          lot_id: lot.id,
          movement_type: 'purchase_receipt',
          qty: uc.kgToTon(netWeightKg),
          to_warehouse_id: resolvedWarehouseId,
          dest_entity: entity,
          notes: `Purchase lot ${lotNo}`,
          cost_per_unit: landedCostPerKg * 1000,
          total_cost: landedCostTotal,
          currency: 'PKR',
          created_by: req.user?.id || null,
        });

        if (landedPayableAmount > 0 && supplier_id) {
          const payNo = await generatePayNo(trx);

          await trx('payables').insert({
            pay_no: payNo,
            entity: 'mill',
            category: 'Raw Material',
            supplier_id: supplier_id || null,
            linked_ref: lotNo,
            original_amount: landedPayableAmount,
            paid_amount: paidAmount,
            outstanding: Math.max(0, landedPayableAmount - paidAmount),
            due_date: addDays(purchase_date, 30),
            status: payableStatus,
            currency: 'PKR',
            notes: `Auto-created from purchase lot ${lotNo}`,
          });

          await accountingService.autoPost(trx, {
            triggerEvent: 'purchase_invoice',
            entity: 'mill',
            amount: landedPayableAmount,
            currency: 'PKR',
            refType: 'Purchase Lot',
            refNo: lotNo,
            description: `Purchase lot ${lotNo} for ${item_name}`,
            userId: req.user?.id || null,
            partyType: supplier_id ? 'supplier' : null,
            partyId: supplier_id || null,
          });
        }

        return lot;
      });

      return res.status(201).json({
        success: true,
        data: { lot: enrichLot(result) },
      });
    } catch (err) {
      console.error('createPurchaseLot error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Add another purchase to an EXISTING raw lot ───
  //
  // Tops up a lot with a further delivery from the SAME supplier instead of
  // opening a separate lot. The lot's landed cost becomes the weighted average
  // of both purchases:
  //   new_per_kg = (old_landed_total + add_landed_total) / (old_kg + add_kg)
  //
  // Only allowed while the lot is still untouched (nothing reserved, milled,
  // sold or transferred) — otherwise blending the cost would retroactively
  // change the COGS of stock that has already left the lot. Mirrors
  // createPurchaseLot's side-effects: a purchase_in lot_transaction, a
  // purchase_receipt movement, a fresh payable for the added amount, and a
  // purchase_invoice journal posting.
  async addPurchaseToLot(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      const {
        quantity_input, quantity_unit = 'katta', bag_weight_kg,
        rate_input, rate_unit = 'katta',
        transport_cost = 0, labor_cost = 0, unloading_cost = 0,
        packing_cost = 0, other_cost = 0,
        bag_cost_per_bag = 0, bag_cost_included = false,
        total_bags: inputTotalBags,
        purchase_date, payment_status = 'Pending', paid_amount,
        notes, supplier_id: bodySupplierId,
      } = req.body;

      const missing = [];
      if (quantity_input == null || quantity_input === '' || !(parseFloat(quantity_input) > 0)) missing.push('weight');
      if (rate_input == null || rate_input === '' || !(parseFloat(rate_input) > 0)) missing.push('price');
      if (missing.length) {
        return res.status(400).json({ success: false, message: `Please fill in: ${missing.join(', ')}.`, missing });
      }

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id: lotId }).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }

        // ── Guards ──────────────────────────────────────────────────────
        if (lot.type !== 'raw' || lot.entity !== 'mill') {
          const e = new Error('Additional purchases can only be added to raw mill lots.'); e.status = 422; throw e;
        }
        if (!lot.supplier_id) {
          const e = new Error('This lot has no supplier on record, so a supplier purchase cannot be attached.'); e.status = 422; throw e;
        }
        if (bodySupplierId && parseInt(bodySupplierId, 10) !== lot.supplier_id) {
          const e = new Error('A purchase can only be added to a lot from the same supplier.'); e.status = 422; throw e;
        }
        if (String(lot.status) !== 'Available') {
          const e = new Error(`Cannot add a purchase to a lot with status "${lot.status}".`); e.status = 422; throw e;
        }
        // Cost-integrity gate: the lot must be wholly intact. Blending cost into
        // a lot that has already been drawn down would rewrite the cost of stock
        // that has already left.
        const currentNetKg = parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000;
        const availableKg = (parseFloat(lot.available_qty) || 0) * 1000;
        const reservedKg = (parseFloat(lot.reserved_qty) || 0) * 1000;
        const soldKg = parseFloat(lot.sold_weight_kg) || 0;
        const damagedKg = parseFloat(lot.damaged_weight_kg) || 0;
        const outbound = await trx('lot_transactions')
          .where({ lot_id: lotId })
          .whereIn('transaction_type', [
            'milling_issue', 'export_dispatch_out', 'local_sale_out', 'export_allocation',
            'stock_adjustment_minus', 'damage_out', 'shortage_out', 'warehouse_transfer_out',
          ])
          .first();
        if (reservedKg > 0.5 || soldKg > 0.5 || damagedKg > 0.5 || outbound || availableKg < currentNetKg - 1) {
          const e = new Error('Cannot add a purchase: this lot has already been reserved, milled, sold or transferred. Create a new lot instead.');
          e.status = 422; throw e;
        }

        // ── Landed cost of the added purchase (same math as createPurchaseLot) ──
        const bagWt = parseFloat(bag_weight_kg) || parseFloat(lot.bag_weight_kg) || 50;
        const addNetKg = uc.toKg(quantity_input, quantity_unit, bagWt);
        const addRatePerKg = uc.rateToPerKg(rate_input, rate_unit, bagWt);
        const addBags = inputTotalBags
          || (quantity_unit === 'katta' || quantity_unit === 'bag'
            ? Math.round(parseFloat(quantity_input))
            : Math.round(addNetKg / bagWt));
        const addPurchaseAmount = uc.round2(addNetKg * addRatePerKg);
        const addDirectCosts = [transport_cost, labor_cost, unloading_cost, packing_cost, other_cost]
          .reduce((s, c) => s + (parseFloat(c) || 0), 0);
        const addBagCost = bag_cost_included ? 0 : (parseFloat(bag_cost_per_bag) || 0) * addBags;
        const addLandedTotal = uc.round2(addPurchaseAmount + addDirectCosts + addBagCost);

        // ── Payment for the added purchase ──
        const status = String(payment_status || 'Pending');
        const addPaid = status === 'Paid'
          ? addLandedTotal
          : status === 'Partial'
            ? Math.max(0, Math.min(addLandedTotal, parseFloat(paid_amount) || 0))
            : Math.max(0, parseFloat(paid_amount) || 0);

        // ── Blend into the existing lot (weighted-average landed cost) ──
        const {
          newNetKg, newBags, newLandedTotal, newPurchaseAmount,
          newLandedPerKg, newRatePerKg, newPaid, newDue, newPaymentStatus,
        } = blendPurchaseIntoLot(lot, {
          netKg: addNetKg,
          bags: addBags,
          landedTotal: addLandedTotal,
          purchaseAmount: addPurchaseAmount,
          paid: addPaid,
        });

        await trx('inventory_lots').where({ id: lotId }).update({
          qty: uc.kgToTon(newNetKg),
          net_weight_kg: newNetKg,
          gross_weight_kg: newNetKg,
          received_net_weight_kg: trx.raw('COALESCE(received_net_weight_kg, 0) + ?', [addNetKg]),
          total_bags: newBags,
          available_qty: newNetKg / 1000,
          purchase_amount: newPurchaseAmount,
          rate_per_kg: newRatePerKg,
          transport_cost: (parseFloat(lot.transport_cost) || 0) + (parseFloat(transport_cost) || 0),
          labor_cost: (parseFloat(lot.labor_cost) || 0) + (parseFloat(labor_cost) || 0),
          unloading_cost: (parseFloat(lot.unloading_cost) || 0) + (parseFloat(unloading_cost) || 0),
          packing_cost: (parseFloat(lot.packing_cost) || 0) + (parseFloat(packing_cost) || 0),
          other_cost: (parseFloat(lot.other_cost) || 0) + (parseFloat(other_cost) || 0),
          total_bag_cost: (parseFloat(lot.total_bag_cost) || 0) + addBagCost,
          landed_cost_total: newLandedTotal,
          landed_cost_per_kg: newLandedPerKg,
          cost_per_unit: newLandedPerKg * 1000,
          total_value: newLandedTotal,
          paid_amount: newPaid,
          due_amount: newDue,
          payment_status: newPaymentStatus,
          updated_at: trx.fn.now(),
        });

        const txnNo = await generateTxnNo(trx);
        await trx('lot_transactions').insert({
          transaction_no: txnNo,
          transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
          lot_id: lotId,
          transaction_type: 'purchase_in',
          reference_module: 'purchase',
          warehouse_to_id: lot.warehouse_id,
          input_unit: quantity_unit,
          input_qty: parseFloat(quantity_input),
          quantity_kg: addNetKg,
          quantity_bags: addBags,
          rate_input_unit: rate_unit,
          rate_input_value: parseFloat(rate_input),
          rate_per_kg: addRatePerKg,
          cost_impact: addLandedTotal,
          currency: 'PKR',
          balance_kg: newNetKg,
          balance_bags: newBags,
          remarks: `Added purchase: ${parseFloat(quantity_input)} ${quantity_unit} @ ${parseFloat(rate_input)}/${rate_unit}`
            + (notes ? ` — ${String(notes).slice(0, 200)}` : ''),
          created_by: req.user?.id || null,
          performed_by: req.user?.id || null,
          performed_at: new Date(),
        });

        await trx('inventory_movements').insert({
          lot_id: lotId,
          movement_type: 'purchase_receipt',
          qty: uc.kgToTon(addNetKg),
          to_warehouse_id: lot.warehouse_id,
          dest_entity: lot.entity,
          notes: `Added purchase to lot ${lot.lot_no}`,
          cost_per_unit: (addNetKg > 0 ? uc.round4(addLandedTotal / addNetKg) : 0) * 1000,
          total_cost: addLandedTotal,
          currency: 'PKR',
          created_by: req.user?.id || null,
        });

        if (addLandedTotal > 0) {
          const payNo = await generatePayNo(trx);
          await trx('payables').insert({
            pay_no: payNo,
            entity: 'mill',
            category: 'Raw Material',
            supplier_id: lot.supplier_id,
            linked_ref: lot.lot_no,
            original_amount: addLandedTotal,
            paid_amount: addPaid,
            outstanding: Math.max(0, uc.round2(addLandedTotal - addPaid)),
            due_date: addDays(purchase_date, 30),
            status: addPaid >= addLandedTotal - 0.01 ? 'Paid' : addPaid > 0 ? 'Partial' : 'Pending',
            currency: 'PKR',
            notes: `Added purchase to lot ${lot.lot_no}`,
          });

          await accountingService.autoPost(trx, {
            triggerEvent: 'purchase_invoice',
            entity: 'mill',
            amount: addLandedTotal,
            currency: 'PKR',
            refType: 'Purchase Lot',
            refNo: lot.lot_no,
            description: `Added purchase to lot ${lot.lot_no} (${lot.item_name})`,
            userId: req.user?.id || null,
            partyType: 'supplier',
            partyId: lot.supplier_id,
          });
        }

        return trx('inventory_lots').where({ id: lotId }).first();
      });

      return res.status(200).json({ success: true, data: { lot: enrichLot(result) } });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('addPurchaseToLot error:', err);
      return res.status(status).json({ success: false, message: err.message || 'Failed to add purchase to lot.' });
    }
  },

  // ─── Record Lot Transaction ───
  async recordTransaction(req, res) {
    try {
      const { lot_id } = req.params;
      const {
        transaction_type, transaction_date,
        quantity_input, quantity_unit = 'kg', bag_weight_kg = 50,
        warehouse_from_id, warehouse_to_id,
        reference_module, reference_id, reference_no,
        rate_input, rate_unit,
        remarks,
      } = req.body;

      if (!transaction_type || !quantity_input) {
        return res.status(400).json({ success: false, message: 'transaction_type and quantity_input required.' });
      }

      const bagWt = parseFloat(bag_weight_kg) || 50;
      const qtyKg = uc.toKg(quantity_input, quantity_unit, bagWt);
      const bags = Math.round(qtyKg / bagWt);

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id: lot_id }).first();
        if (!lot) throw new Error('Lot not found');

        const currentKg = parseFloat(lot.net_weight_kg) || 0;
        const currentAvail = parseFloat(lot.available_qty) || 0; // in MT

        // Determine direction
        const outbound = ['milling_issue', 'export_allocation', 'sales_allocation', 'dispatch_out', 'wastage', 'damage', 'shortage', 'lot_split'].includes(transaction_type);
        const inbound = ['purchase_in', 'milling_receipt', 'warehouse_transfer_in', 'return_in', 'lot_merge', 'stock_adjustment_plus'].includes(transaction_type);

        if (outbound) {
          const availKg = currentAvail * 1000; // MT to KG
          if (qtyKg > availKg + 0.001) {
            throw new Error(`Insufficient stock: need ${qtyKg} kg but only ${availKg.toFixed(3)} kg available`);
          }
        }

        // Compute new balances
        let newNetKg = currentKg;
        let newAvailMT = currentAvail;
        let soldDelta = 0, damagedDelta = 0;

        if (outbound) {
          newNetKg = currentKg; // net doesn't change for allocation, only avail
          newAvailMT = currentAvail - (qtyKg / 1000);
          if (['dispatch_out', 'sales_allocation'].includes(transaction_type)) soldDelta = qtyKg;
          if (['wastage', 'damage', 'shortage'].includes(transaction_type)) damagedDelta = qtyKg;
        } else if (inbound) {
          newNetKg = currentKg + qtyKg;
          newAvailMT = currentAvail + (qtyKg / 1000);
        }

        // Update lot
        const updates = {
          net_weight_kg: newNetKg,
          available_qty: Math.max(0, newAvailMT),
          qty: Math.max(0, newAvailMT + (parseFloat(lot.reserved_qty) || 0)),
        };
        if (inbound) updates.received_net_weight_kg = trx.raw('COALESCE(received_net_weight_kg, 0) + ?', [qtyKg]);
        if (soldDelta > 0) updates.sold_weight_kg = (parseFloat(lot.sold_weight_kg) || 0) + soldDelta;
        if (damagedDelta > 0) updates.damaged_weight_kg = (parseFloat(lot.damaged_weight_kg) || 0) + damagedDelta;
        if (newAvailMT <= 0.001 && (parseFloat(lot.reserved_qty) || 0) <= 0.001) updates.status = 'Closed';

        await trx('inventory_lots').where({ id: lot_id }).update(updates);

        // Insert transaction
        const txnNo = await generateTxnNo(trx);
        // Cost basis: use the manually-entered rate if given, otherwise fall back
        // to the lot's own landed cost (per kg) so a consumption/sale still records
        // a cost impact instead of a blank.
        const lotRateKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
        const rateKg = rate_input ? uc.rateToPerKg(rate_input, rate_unit || 'kg', bagWt) : (lotRateKg || null);
        const defaultRemark = `${transaction_type.replace(/_/g, ' ')} — ${parseFloat(quantity_input)} ${quantity_unit}`;

        const [txn] = await trx('lot_transactions').insert({
          transaction_no: txnNo,
          transaction_date: transaction_date || new Date().toISOString().slice(0, 10),
          lot_id: +lot_id,
          transaction_type,
          reference_module: reference_module || null,
          reference_id: reference_id || null,
          reference_no: reference_no || null,
          warehouse_from_id: warehouse_from_id || null,
          warehouse_to_id: warehouse_to_id || null,
          input_unit: quantity_unit,
          input_qty: parseFloat(quantity_input),
          quantity_kg: outbound ? -qtyKg : qtyKg,
          quantity_bags: outbound ? -bags : bags,
          rate_input_unit: rate_input ? (rate_unit || null) : (rateKg ? 'kg' : null),
          rate_input_value: rate_input ? parseFloat(rate_input) : (rateKg || null),
          rate_per_kg: rateKg,
          cost_impact: rateKg ? uc.round2(qtyKg * rateKg) : null,
          currency: 'PKR',
          balance_kg: newNetKg,
          balance_bags: Math.round(newNetKg / bagWt),
          remarks: remarks || defaultRemark,
          created_by: req.user?.id || null,
          performed_by: req.user?.id || null, // NOT NULL column
          performed_at: new Date(),
        }).returning('*');

        return txn;
      });

      return res.json({ success: true, data: { transaction: result } });
    } catch (err) {
      console.error('recordTransaction error:', err);
      const status = err.message.includes('Insufficient') ? 400 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // ─── Get Lot Transactions ───
  async getLotTransactions(req, res) {
    try {
      const { id } = req.params;
      const txns = await db('lot_transactions')
        .where({ lot_id: id })
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc');

      // Enrich with unit equivalents
      const enriched = txns.map(t => {
        const bw = 50; // default
        const absKg = Math.abs(parseFloat(t.quantity_kg) || 0);
        return {
          ...t,
          quantity_katta: uc.kgToKatta(absKg, bw),
          quantity_maund: uc.kgToMaund(absKg),
          quantity_ton: uc.kgToTon(absKg),
          balance_katta: uc.kgToKatta(parseFloat(t.balance_kg) || 0, bw),
          balance_maund: uc.kgToMaund(parseFloat(t.balance_kg) || 0),
        };
      });

      return res.json({ success: true, data: { transactions: enriched } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Inventory Reports ───
  async getStockReport(req, res) {
    try {
      const { group_by = 'supplier', status = 'Available' } = req.query;

      let query = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id');

      if (status && status !== 'all') query = query.where('l.status', status);

      let groupCol, nameCol;
      if (group_by === 'supplier') { groupCol = 'l.supplier_id'; nameCol = 's.name'; }
      else if (group_by === 'warehouse') { groupCol = 'l.warehouse_id'; nameCol = 'w.name'; }
      else if (group_by === 'variety') { groupCol = 'l.variety'; nameCol = 'l.variety'; }
      else if (group_by === 'grade') { groupCol = 'l.grade'; nameCol = 'l.grade'; }
      else if (group_by === 'processing_type') { groupCol = 'l.processing_type'; nameCol = 'l.processing_type'; }
      else { groupCol = 'l.type'; nameCol = 'l.type'; }

      const rows = await query
        .select(
          db.raw(`${nameCol} as group_name`),
          db.raw('COUNT(l.id) as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0) as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0) as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0) as reserved_kg'),
          db.raw('COALESCE(SUM(l.sold_weight_kg), 0) as sold_kg'),
          db.raw('COALESCE(SUM(l.damaged_weight_kg), 0) as damaged_kg'),
          db.raw('COALESCE(SUM(CASE WHEN l.landed_cost_total > 0 THEN l.landed_cost_total ELSE l.total_value END), 0) as total_value'),
        )
        .groupBy(groupCol, nameCol)
        .orderBy('total_kg', 'desc');

      const enriched = rows.map(r => ({
        ...r,
        total_katta: uc.kgToKatta(r.total_kg),
        total_maund: uc.kgToMaund(r.total_kg),
        total_ton: uc.kgToTon(r.total_kg),
        available_katta: uc.kgToKatta(r.available_kg),
        available_maund: uc.kgToMaund(r.available_kg),
      }));

      return res.json({ success: true, data: { report: enriched, group_by } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Update Lot Costs ───
  async updateLotCosts(req, res) {
    try {
      const { id } = req.params;
      const { transport_cost, labor_cost, unloading_cost, packing_cost, other_cost, bag_cost_per_bag } = req.body;

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id }).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }

        const netKg = parseFloat(lot.net_weight_kg) || 0;
        // purchase_amount + additional costs are for the ORIGINAL received intake,
        // so the per-kg landed cost must divide by received_net_weight_kg — NOT the
        // current net weight, which milling/sales have already drawn down. Dividing
        // by the reduced weight inflates cost/kg wildly (e.g. 210 → 495 after a lot
        // was half-milled). Falls back to net weight for lots predating the column.
        const receivedKg = parseFloat(lot.received_net_weight_kg) || netKg;
        const totalBags = lot.total_bags || 0;
        const purchaseAmount = parseFloat(lot.purchase_amount) || 0;

        const tc = parseFloat(transport_cost) ?? parseFloat(lot.transport_cost) ?? 0;
        const lc = parseFloat(labor_cost) ?? parseFloat(lot.labor_cost) ?? 0;
        const ulc = parseFloat(unloading_cost) ?? parseFloat(lot.unloading_cost) ?? 0;
        const pc = parseFloat(packing_cost) ?? parseFloat(lot.packing_cost) ?? 0;
        const oc = parseFloat(other_cost) ?? parseFloat(lot.other_cost) ?? 0;
        const bcpb = parseFloat(bag_cost_per_bag) ?? parseFloat(lot.bag_cost_per_bag) ?? 0;
        const totalBagCost = lot.bag_cost_included ? 0 : bcpb * totalBags;
        const directCosts = tc + lc + ulc + pc + oc;
        const landedTotal = uc.round2(purchaseAmount + directCosts + totalBagCost);
        const landedPerKg = receivedKg > 0 ? uc.round4(landedTotal / receivedKg) : 0;

        await trx('inventory_lots').where({ id }).update({
          transport_cost: tc, labor_cost: lc, unloading_cost: ulc,
          packing_cost: pc, other_cost: oc, bag_cost_per_bag: bcpb,
          total_bag_cost: totalBagCost,
          landed_cost_total: landedTotal,
          landed_cost_per_kg: landedPerKg,
          total_value: landedTotal,
          cost_per_unit: landedPerKg * 1000,
        });

        // Cascade the corrected cost into any batch that already consumed this
        // lot (batch_source_lots, raw-cost pool, output-lot costs, non-locked
        // COGS). No-op when the lot hasn't been milled.
        const propagation = await inventoryService.propagateLotCostToBatches(trx, parseInt(id, 10), { userId: req.user?.id });

        const updated = await trx('inventory_lots').where({ id }).first();
        return { updated, propagation };
      });

      return res.json({ success: true, data: { lot: enrichLot(result.updated), propagation: result.propagation } });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('updateLotCosts error:', err);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // ─── Edit a lot's recorded quality after creation ───
  //
  // Quality is an analysis record, not a cost input, so it can be corrected at
  // any time without touching landed cost or stock. moisture/broken are stored
  // both on dedicated columns AND inside quality_json; we drive both from the
  // submitted quality object so they never diverge.
  async updateLotQuality(req, res) {
    try {
      const { id } = req.params;
      const lot = await db('inventory_lots').where({ id }).first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });

      const b = req.body;
      const update = {};
      for (const f of ['variety', 'grade', 'sortex_status', 'quality_notes', 'bag_quality']) {
        if (f in b) update[f] = (b[f] === '' || b[f] == null) ? null : String(b[f]);
      }
      // whiteness is a numeric column (a whiteness index), not free text
      if ('whiteness' in b) {
        update.whiteness = (b.whiteness === '' || b.whiteness == null || Number.isNaN(parseFloat(b.whiteness)))
          ? null : parseFloat(b.whiteness);
      }
      if ('quality_json' in b || 'quality' in b) {
        const qj = sanitizeLotQuality(b.quality_json || b.quality);
        update.quality_json = qj;
        // keep the dedicated shortlist columns in step with the jsonb
        update.moisture_pct = qj && qj.moisture != null ? qj.moisture : null;
        update.broken_pct = qj && qj.broken != null ? qj.broken : null;
      }
      // explicit dedicated values win if sent directly
      if ('moisture_pct' in b) update.moisture_pct = (b.moisture_pct === '' || b.moisture_pct == null) ? null : parseFloat(b.moisture_pct);
      if ('broken_pct' in b) update.broken_pct = (b.broken_pct === '' || b.broken_pct == null) ? null : parseFloat(b.broken_pct);

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ success: false, message: 'No quality fields supplied.' });
      }
      // moisture/broken feed CHECK-constrained 0–100 columns; reject out-of-range
      // up front so the operator gets a clear message instead of a DB error.
      for (const [f, label] of [['moisture_pct', 'Moisture'], ['broken_pct', 'Broken']]) {
        const v = update[f];
        if (v != null && (v < 0 || v > 100)) {
          return res.status(400).json({ success: false, message: `${label} must be between 0 and 100.` });
        }
      }
      update.updated_at = db.fn.now();

      await db('inventory_lots').where({ id }).update(update);
      const updated = await db('inventory_lots').where({ id }).first();
      return res.json({ success: true, data: { lot: enrichLot(updated) } });
    } catch (err) {
      console.error('updateLotQuality error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /sources
   * Return milling batches with vehicle arrivals and quality data,
   * used as a dropdown source for purchase lot creation.
   */
  async getLotSources(req, res) {
    try {
      // 1. Get milling batches with supplier info
      const batches = await db('milling_batches as mb')
        .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
        .select(
          'mb.id', 'mb.batch_no', 'mb.supplier_id', 's.name as supplier_name',
          'mb.status', 'mb.raw_qty_mt', 'mb.actual_finished_mt',
          'mb.broken_mt', 'mb.bran_mt', 'mb.husk_mt', 'mb.wastage_mt',
          'mb.yield_pct', 'mb.linked_export_order_id',
          'mb.post_milling_grade'
        )
        .orderBy('mb.id', 'desc');

      // 2. Get quality samples for all batches
      const qualitySamples = await db('milling_quality_samples')
        .whereIn('batch_id', batches.map(b => b.id))
        .orderBy('created_at', 'desc');

      // 3. Get vehicle arrivals for all batches
      const vehicles = await db('milling_vehicle_arrivals')
        .whereIn('batch_id', batches.map(b => b.id))
        .orderBy('batch_id', 'asc')
        .orderBy('id', 'asc');

      // 4. Get linked export orders info
      const orderIds = batches.filter(b => b.linked_export_order_id).map(b => b.linked_export_order_id);
      const orders = orderIds.length > 0
        ? await db('export_orders').whereIn('id', orderIds).select('id', 'order_no')
        : [];
      const orderMap = {};
      orders.forEach(o => { orderMap[o.id] = o.order_no; });

      // Build response - each batch with its quality, vehicles, and export order info
      const sources = batches.map(batch => {
        const batchQuality = qualitySamples.filter(q => q.batch_id === batch.id);
        const arrivalQuality = batchQuality.find(q => q.analysis_type === 'arrival');
        const sampleQuality = batchQuality.find(q => q.analysis_type === 'sample');
        const batchVehicles = vehicles.filter(v => v.batch_id === batch.id);

        return {
          ...batch,
          export_order_no: orderMap[batch.linked_export_order_id] || null,
          quality: {
            arrival: arrivalQuality ? {
              moisture: arrivalQuality.moisture,
              broken: arrivalQuality.broken,
              chalky: arrivalQuality.chalky,
              foreign_matter: arrivalQuality.foreign_matter,
              purity: arrivalQuality.purity,
              price_per_mt: arrivalQuality.price_per_mt,
            } : null,
            sample: sampleQuality ? {
              moisture: sampleQuality.moisture,
              broken: sampleQuality.broken,
              chalky: sampleQuality.chalky,
              foreign_matter: sampleQuality.foreign_matter,
              purity: sampleQuality.purity,
              price_per_mt: sampleQuality.price_per_mt,
            } : null,
          },
          vehicles: batchVehicles.map(v => ({
            id: v.id,
            vehicle_no: v.vehicle_no,
            driver_name: v.driver_name,
            weight_mt: v.weight_mt,
            arrival_date: v.arrival_date,
          })),
        };
      });

      return res.json({ success: true, data: { sources } });
    } catch (err) {
      console.error('getLotSources error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Saved supplier templates ───
  // Owner-private. The wizard reads them on step 1 to prefill
  // supplier+warehouse+category+product+defaults in one click.
  async listTemplates(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Auth required.' });
      const rows = await db('purchase_lot_templates as t')
        .leftJoin('suppliers as s', 't.supplier_id', 's.id')
        .leftJoin('products as p', 't.product_id', 'p.id')
        .leftJoin('warehouses as w', 't.warehouse_id', 'w.id')
        .leftJoin('product_categories as pc', 't.category_id', 'pc.id')
        .where('t.owner_id', userId)
        .select(
          't.*',
          's.name as supplier_name',
          'p.name as product_name',
          'w.name as warehouse_name',
          'pc.name as category_name',
        )
        .orderBy('t.name', 'asc');
      return res.json({ success: true, data: { templates: rows } });
    } catch (err) {
      console.error('listTemplates error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async createTemplate(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Auth required.' });
      const {
        name, supplier_id, warehouse_id, category_id, product_id,
        type, entity, grade, variety,
        default_rate_per_kg, default_bag_weight_kg, default_rate_unit, crop_year,
      } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Template name is required.' });
      }
      if (type && !['raw', 'finished', 'byproduct', 'packaging'].includes(type)) {
        return res.status(400).json({ success: false, message: 'Invalid type. Must be raw, finished, byproduct or packaging.' });
      }
      const [row] = await db('purchase_lot_templates').insert({
        name: String(name).trim(),
        owner_id: userId,
        supplier_id: supplier_id || null,
        warehouse_id: warehouse_id || null,
        category_id: category_id || null,
        product_id: product_id || null,
        type: type || 'raw',
        entity: entity || 'mill',
        grade: grade || null,
        variety: variety || null,
        default_rate_per_kg: default_rate_per_kg || null,
        default_bag_weight_kg: default_bag_weight_kg || null,
        default_rate_unit: default_rate_unit || 'kg',
        crop_year: crop_year || null,
      }).returning('*');
      return res.status(201).json({ success: true, data: { template: row } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'A template with this name already exists.' });
      }
      console.error('createTemplate error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async updateTemplate(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Auth required.' });
      const updates = { ...req.body };
      delete updates.id;
      delete updates.owner_id;
      delete updates.created_at;
      if (updates.type != null && !['raw', 'finished', 'byproduct', 'packaging'].includes(updates.type)) {
        return res.status(400).json({ success: false, message: 'Invalid type. Must be raw, finished, byproduct or packaging.' });
      }
      updates.updated_at = db.fn.now();
      const [row] = await db('purchase_lot_templates')
        .where({ id: req.params.id, owner_id: userId })
        .update(updates)
        .returning('*');
      if (!row) return res.status(404).json({ success: false, message: 'Template not found.' });
      return res.json({ success: true, data: { template: row } });
    } catch (err) {
      console.error('updateTemplate error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async deleteTemplate(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Auth required.' });
      const n = await db('purchase_lot_templates').where({ id: req.params.id, owner_id: userId }).del();
      if (!n) return res.status(404).json({ success: false, message: 'Template not found.' });
      return res.json({ success: true, message: 'Template deleted.' });
    } catch (err) {
      console.error('deleteTemplate error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Allocate a raw lot into an existing milling batch ────────────
  // Lets the user feed a Purchase Lot (created via /lot-inventory →
  // New Purchase Lot) into a batch's raw input. Decrements the lot's
  // available_qty, increments batch.raw_qty_mt, and writes a vehicle
  // arrival row so the batch traces back to the source lot.
  async allocateLotToBatch(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      const { batch_id, weight_mt, notes } = req.body || {};
      const weightMt = parseFloat(weight_mt);
      const batchId  = parseInt(batch_id, 10);

      if (!lotId)               return res.status(400).json({ success: false, message: 'Invalid lot id.' });
      if (!batchId)             return res.status(400).json({ success: false, message: 'batch_id is required.' });
      if (!weightMt || weightMt <= 0) return res.status(400).json({ success: false, message: 'weight_mt must be positive.' });

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id: lotId }).first();
        if (!lot)                throw new Error('Lot not found.');
        if (lot.type !== 'raw')  throw new Error(`Lot is type "${lot.type}" — only raw lots can be allocated to a milling batch.`);
        const available = parseFloat(lot.available_qty) || 0;
        if (weightMt > available + 0.0001) {
          throw new Error(`Lot has only ${available} MT available, can't allocate ${weightMt} MT.`);
        }

        const batch = await trx('milling_batches').where({ id: batchId }).first();
        if (!batch)              throw new Error('Milling batch not found.');
        const lockedStatuses = ['Completed', 'Cancelled', 'Rejected'];
        if (lockedStatuses.includes(batch.status)) {
          throw new Error(`Batch is ${batch.status} — can't add raw material.`);
        }

        // 1. Reduce the source lot's available qty. If we fully consume
        //    it, mark milling_status = 'Consumed' so it drops off raw
        //    stock filters.
        const newAvailable = parseFloat((available - weightMt).toFixed(4));
        const fullyConsumed = newAvailable <= 0.0001;
        await trx('inventory_lots').where({ id: lotId }).update({
          available_qty: Math.max(0, newAvailable),
          milling_status: fullyConsumed ? 'Consumed' : (lot.milling_status || 'Partial'),
          updated_at: trx.fn.now(),
        });

        // 2. Vehicle-arrival row so the batch shows where its raw came
        //    from. Uses the lot's lot_no as the vehicle identifier so
        //    the audit trail reads "received from LOT-XXX".
        const [arrival] = await trx('milling_vehicle_arrivals')
          .insert({
            batch_id: batchId,
            vehicle_no: lot.lot_no,
            driver_name: null,
            weight_mt: weightMt,
            bag_size_kg: lot.bag_weight_kg || null,
            total_bags: lot.total_bags || null,
            arrival_date: trx.fn.now(),
            notes: notes || `Allocated from purchase lot ${lot.lot_no}`,
            created_by: req.user?.id || null,
          })
          .returning('*');

        // 3. Refresh the batch's raw_qty_mt to the sum of every arrival
        //    so it reflects what physically arrived (matches addVehicle
        //    behaviour).
        const totalArrivals = await trx('milling_vehicle_arrivals')
          .where({ batch_id: batchId })
          .sum('weight_mt as total').first();
        const newRawQty = parseFloat(totalArrivals?.total) || 0;
        await trx('milling_batches').where({ id: batchId }).update({
          raw_qty_mt: newRawQty,
          updated_at: trx.fn.now(),
        });

        return {
          lot_id: lotId,
          batch_id: batchId,
          weight_mt: weightMt,
          lot_remaining_mt: Math.max(0, newAvailable),
          batch_raw_qty_mt: newRawQty,
          fully_consumed: fullyConsumed,
        };
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('allocateLotToBatch error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to allocate lot.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Lot-level vehicles + Start Milling
  // ═══════════════════════════════════════════════════════════════════

  async listLotVehicles(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      if (!lotId) return res.status(400).json({ success: false, message: 'Invalid lot id.' });
      const rows = await db('milling_vehicle_arrivals')
        .where(function () { this.where('lot_id', lotId); })
        .orWhereExists(function () {
          // Also surface vehicles that were originally added to the lot
          // and later inherited by a batch — match by lot_id OR by the
          // batch_id that the lot ended up routed into.
          this.select(db.raw('1'))
            .from('batch_source_lots as bsl')
            .whereRaw('bsl.lot_id = ?', [lotId])
            .andWhereRaw('milling_vehicle_arrivals.batch_id = bsl.batch_id');
        })
        .orWhereExists(function () {
          // The lot is the RAW/primary lot of a batch (linked via
          // inventory_lots.batch_ref = 'batch-<id>'), and the vehicle was added
          // at the batch level (lot_id null). Surface those on the lot too —
          // otherwise the lot's vehicle panel reads empty while the batch's
          // own Vehicle Arrivals card shows the same truck.
          this.select(db.raw('1'))
            .from('inventory_lots as il')
            .whereRaw('il.id = ?', [lotId])
            .andWhereRaw("il.batch_ref = 'batch-' || milling_vehicle_arrivals.batch_id");
        })
        .orWhereExists(function () {
          // The lot is the OUTPUT of a blend batch: trace through that batch's
          // source lots to their originating batches' arrivals, so a blended
          // lot shows the trucks that delivered the raw material across the
          // whole blend (the blend batch itself records no direct arrivals).
          this.select(db.raw('1'))
            .from('inventory_lots as out_lot')
            .join('batch_source_lots as bsl', function () {
              this.on(db.raw("out_lot.batch_ref = 'batch-' || bsl.batch_id"));
            })
            .join('inventory_lots as src', 'src.id', 'bsl.lot_id')
            .whereRaw('out_lot.id = ?', [lotId])
            .andWhere(function () {
              this.whereRaw('milling_vehicle_arrivals.lot_id = src.id')
                .orWhereRaw("milling_vehicle_arrivals.lot_id IS NULL AND src.batch_ref = 'batch-' || milling_vehicle_arrivals.batch_id");
            });
        })
        .orderBy('arrival_date', 'desc')
        .orderBy('id', 'desc');
      return res.json({ success: true, data: { vehicles: rows } });
    } catch (err) {
      console.error('listLotVehicles error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async addLotVehicle(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      if (!lotId) return res.status(400).json({ success: false, message: 'Invalid lot id.' });
      const lot = await db('inventory_lots').where({ id: lotId }).first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });

      const {
        vehicle_no, driver_name, driver_phone,
        weight_kg, weight_mt, total_bags, bag_size_kg,
        arrival_date, notes,
      } = req.body || {};

      // Canonicalise weight to MT
      let weightMT = null;
      if (weight_kg != null && weight_kg !== '') weightMT = parseFloat(weight_kg) / 1000;
      else if (weight_mt != null && weight_mt !== '') weightMT = parseFloat(weight_mt);

      const parsedTotalBags = total_bags != null && total_bags !== '' ? parseInt(total_bags, 10) : null;
      let parsedBagSize = bag_size_kg != null && bag_size_kg !== '' ? parseFloat(bag_size_kg) : null;
      if (!parsedBagSize && weightMT && parsedTotalBags && parsedTotalBags > 0) {
        parsedBagSize = (weightMT * 1000) / parsedTotalBags;
      }

      // If the lot has already been routed into a batch, link the vehicle
      // straight to that batch so it shows up on the batch detail page too.
      const sourceLink = await db('batch_source_lots').where({ lot_id: lotId }).first('batch_id');

      const [vehicle] = await db('milling_vehicle_arrivals').insert({
        lot_id: lotId,
        batch_id: sourceLink?.batch_id || null,
        vehicle_no: vehicle_no || null,
        driver_name: driver_name || null,
        driver_phone: driver_phone || null,
        weight_mt: weightMT,
        bag_size_kg: parsedBagSize,
        total_bags: parsedTotalBags,
        arrival_date: arrival_date || db.fn.now(),
        notes: notes || null,
        created_by: req.user?.id || null,
      }).returning('*');

      return res.status(201).json({ success: true, data: { vehicle } });
    } catch (err) {
      console.error('addLotVehicle error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async deleteLotVehicle(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      const vehicleId = parseInt(req.params.vehicleId, 10);
      if (!lotId || !vehicleId) return res.status(400).json({ success: false, message: 'Invalid id.' });

      const v = await db('milling_vehicle_arrivals')
        .where({ id: vehicleId, lot_id: lotId })
        .first();
      if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found on this lot.' });
      if (v.batch_id) {
        // Once a batch has picked the vehicle up, deletion has to go
        // through the batch flow so the inventory ledger stays clean.
        return res.status(409).json({
          success: false,
          message: 'This vehicle is already attached to a milling batch — delete it from the batch page instead.',
        });
      }

      await db('milling_vehicle_arrivals').where({ id: vehicleId }).delete();
      return res.json({ success: true });
    } catch (err) {
      console.error('deleteLotVehicle error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Start a milling batch for this lot. The lot becomes the batch's
   * source. Any lot-attached vehicles (lot_id set, batch_id null) get
   * back-filled with the new batch_id so they show on the batch page.
   *
   * Multi-pass: if the source lot was itself produced by an earlier
   * batch (i.e. a finished/byproduct lot whose batch_ref points at a
   * milling batch), the new batch records parent_batch_id and
   * pass_number = parent.pass_number + 1.
   */
  async startMillingForLot(req, res) {
    try {
      const lotId = parseInt(req.params.id, 10);
      if (!lotId) return res.status(400).json({ success: false, message: 'Invalid lot id.' });

      const { mill_id, machine_line, shift, milling_fee_per_kg, raw_qty_mt: overrideQty, notes } = req.body || {};

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id: lotId }).first();
        if (!lot) {
          const err = new Error('Lot not found.'); err.statusCode = 404; throw err;
        }
        const availableMT = parseFloat(lot.available_qty) || 0;
        if (availableMT <= 0) {
          const err = new Error(`Lot ${lot.lot_no} has no available stock to mill.`);
          err.statusCode = 400; throw err;
        }

        // mill_id is NOT NULL on milling_batches. Resolve a default
        // when the operator didn't pick one: lowest-id active mill,
        // falling back to any mill. Block with a clear error if there
        // are zero mills configured.
        let resolvedMillId = mill_id ? parseInt(mill_id, 10) : null;
        if (!resolvedMillId) {
          // mills.status enum: 'Active' / 'Maintenance' / 'Inactive'
          let m = await trx('mills').where({ status: 'Active' }).orderBy('id').first('id');
          if (!m) m = await trx('mills').orderBy('id').first('id');
          if (!m) {
            const err = new Error('No mill configured. Add one in Admin → Mills before starting milling.');
            err.statusCode = 400; throw err;
          }
          resolvedMillId = m.id;
        }

        // Look up parent batch if the lot was produced by milling
        // (batch_ref like "batch-123"). If found, this is pass N+1.
        let parentBatchId = null;
        let passNumber = 1;
        if (lot.batch_ref && /^batch-\d+$/.test(lot.batch_ref)) {
          const parentId = parseInt(lot.batch_ref.replace('batch-', ''), 10);
          const parent = await trx('milling_batches').where({ id: parentId }).first('id', 'pass_number');
          if (parent) {
            parentBatchId = parent.id;
            passNumber = (parseInt(parent.pass_number) || 1) + 1;
          }
        }

        // Generate batch number — match the M-NNN convention used in
        // milling.controller.js. Done locally to avoid pulling in the
        // whole milling controller just for this helper.
        const last = await trx('milling_batches').select('batch_no').orderBy('created_at', 'desc').first();
        let nextNum = 1;
        if (last && last.batch_no) {
          const n = parseInt(String(last.batch_no).replace('M-', ''), 10);
          if (!Number.isNaN(n)) nextNum = n + 1;
        }
        const batchNo = `M-${String(nextNum).padStart(3, '0')}`;

        // Partial milling: the operator can mill less than the whole lot. The
        // committed qty (batch_source_lots.qty_mt) is what consumeForMilling
        // draws down from the lot at yield, so the remainder stays available.
        let rawQtyMT = availableMT;
        if (overrideQty != null && overrideQty !== '') {
          const q = parseFloat(overrideQty);
          if (!(q > 0)) {
            const err = new Error('Quantity to mill must be greater than zero.');
            err.statusCode = 400; throw err;
          }
          if (q > availableMT + 1e-6) {
            const err = new Error(`Cannot mill ${q} MT — only ${availableMT.toFixed(2)} MT available in lot ${lot.lot_no}.`);
            err.statusCode = 400; throw err;
          }
          rawQtyMT = q;
        }
        const isPartial = rawQtyMT < availableMT - 1e-6;

        const [batch] = await trx('milling_batches').insert({
          batch_no: batchNo,
          supplier_id: lot.supplier_id || null,
          supplier_name: null,
          product_id: lot.product_id || null,
          mill_id: resolvedMillId,
          machine_line: machine_line || null,
          shift: shift || 'Day',
          milling_fee_per_kg: milling_fee_per_kg ? parseFloat(milling_fee_per_kg) : 5,
          raw_qty_mt: rawQtyMT,
          status: 'Queued',
          notes: notes || null,
          parent_batch_id: parentBatchId,
          pass_number: passNumber,
          created_by: req.user?.id || null,
        }).returning('*');

        // Link the lot as a source. Existing column set per migration 011.
        await trx('batch_source_lots').insert({
          batch_id: batch.id,
          lot_id: lot.id,
          qty_mt: rawQtyMT,
          notes: notes || null,
        });

        // Mark the source lot as "In Milling" so it doesn't get double-
        // booked. consumeForMilling will flip it to "Consumed" on yield.
        await trx('inventory_lots').where({ id: lot.id }).update({
          milling_status: 'In Milling',
          updated_at: trx.fn.now(),
        });

        // Prefill batch arrival quality from the lot. The operator
        // already entered moisture/broken/B1-OV/price/etc. when they
        // created the lot — surface it on the batch's Quality tab so
        // they don't have to retype. Skipped silently if the lot has
        // no usable quality data, or if the batch already has an
        // arrival sample (idempotent — start-milling can be retried).
        const lotQ = lot.quality_json || {};
        // Coerce helper: null/undef → null, numeric → number, else null.
        const num = (v) => {
          if (v == null || v === '') return null;
          const n = parseFloat(v);
          return Number.isNaN(n) ? null : n;
        };
        const lotRateKg = num(lot.rate_per_kg);
        const arrivalRow = {
          batch_id: batch.id,
          analysis_type: 'arrival',
          moisture:        num(lotQ.moisture)       ?? num(lot.moisture_pct),
          broken:          num(lotQ.broken)         ?? num(lot.broken_pct),
          foreign_matter:  num(lotQ.foreign_matter),
          chalky:          num(lotQ.chalky),
          discoloration:   num(lotQ.discoloration),
          purity:          num(lotQ.purity),
          grain_size:      num(lotQ.grain_size),
          b1_pct:          num(lotQ.b1),
          b2_pct:          num(lotQ.b2),
          b3_pct:          num(lotQ.b3),
          csr_pct:         num(lotQ.csr),
          short_grain_pct: num(lotQ.short_grain),
          cobba_pct:       num(lotQ.cobba),
          nb_pct:          num(lotQ.nb),
          ov_pct:          num(lotQ.ov),
          price_per_mt:    num(lotQ.price_per_mt) ?? (lotRateKg ? lotRateKg * 1000 : null),
          price_per_kg:    num(lotQ.price_per_kg) ?? lotRateKg,
          created_by:      req.user?.id || null,
        };
        const hasAnyValue = Object.entries(arrivalRow).some(
          ([k, v]) => !['batch_id', 'analysis_type', 'created_by'].includes(k) && v != null
        );
        if (hasAnyValue) {
          // Unique constraint on (batch_id, analysis_type) from migration
          // 080. Use onConflict so re-running start-milling refreshes the
          // row instead of throwing.
          await trx('milling_quality_samples')
            .insert(arrivalRow)
            .onConflict(['batch_id', 'analysis_type'])
            .merge();
        }

        // Back-fill batch_id on any lot-attached vehicles so the batch
        // page picks them up automatically. Capture the row count so
        // the UI can confirm to the operator how many trucks were
        // carried over.
        const inheritedRows = await trx('milling_vehicle_arrivals')
          .where({ lot_id: lot.id })
          .whereNull('batch_id')
          .update({ batch_id: batch.id })
          .returning('id');
        const inheritedVehicles = Array.isArray(inheritedRows) ? inheritedRows.length : 0;

        // Roll the lot's total received weight up to the batch — same
        // truth-from-the-scale rule we use in receiveRice. Skip if the
        // operator already supplied an override.
        if (!overrideQty) {
          const totals = await trx('milling_vehicle_arrivals')
            .where({ batch_id: batch.id })
            .sum('weight_mt as total').first();
          const actualReceived = parseFloat(totals?.total) || 0;
          if (actualReceived > 0 && actualReceived !== rawQtyMT) {
            await trx('milling_batches').where({ id: batch.id }).update({
              raw_qty_mt: actualReceived,
              updated_at: trx.fn.now(),
            });
            batch.raw_qty_mt = actualReceived;
          }
        }

        return { batch, lot, passNumber, parentBatchId, inheritedVehicles };
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || 500;
      if (status === 500) console.error('startMillingForLot error:', err);
      return res.status(status).json({ success: false, message: err.message });
    }
  },
};
