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
// #8 — has this lot been drawn into milling yet? "Milling started" = the lot is
// committed to a batch (batch_source_lots row), hard-reserved at batch start
// (milling_reserved_qty), or already issued out to milling. Mirrors the
// codebase's own "touched by milling" definition (see addPurchaseToLot). q is a
// trx or db so it works inside or outside a transaction.
async function lotMillingStarted(lot, q) {
  if ((parseFloat(lot.milling_reserved_qty) || 0) > 0) return true;
  const sourced = await q('batch_source_lots').where({ lot_id: lot.id }).first();
  if (sourced) return true;
  const issued = await q('lot_transactions')
    .where({ lot_id: lot.id })
    .where('transaction_type', 'milling_issue')
    .first();
  return !!issued;
}

// #8 — Mill Operator scoped lot editing. A Mill Operator may edit a lot ONLY if
// they created it AND milling has not started. Every other role is governed
// solely by the inventory.edit permission (this helper is a no-op for them).
// Throws a 403-tagged Error (each endpoint's catch maps err.status → response).
// Resolves the role by id (authoritative; req.user.role from the JWT is not
// trusted), so prod/local role-id differences don't matter.
async function assertLotEditableByOperator(req, lot, q) {
  const roleId = req.user && req.user.role_id;
  if (!roleId) return;
  const role = await q('roles').where({ id: roleId }).first();
  if (!role || role.name !== 'Mill Operator') return; // only constrains Mill Operator
  if (String(lot.created_by ?? '') !== String(req.user.id)) {
    const e = new Error('You can only edit lots you created.'); e.status = 403; throw e;
  }
  if (await lotMillingStarted(lot, q)) {
    const e = new Error('Lot cannot be edited after milling has started.'); e.status = 403; throw e;
  }
}

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

    // Fallback: quality entered WITH the vehicle arrival (milling_vehicle_arrivals
    // .quality_json) is never copied into milling_quality_samples, so a batch whose
    // only quality lives on its truck(s) would show nothing here. Surface it as the
    // arrival analysis (weight-weighted across vehicles) when no formal arrival
    // sample exists, so the lot's Quality tab still shows moisture/broken/etc.
    if (!batchQuality?.arrival) {
      const arrivals = await db('milling_vehicle_arrivals')
        .where({ batch_id: ownBatchId }).whereNotNull('quality_json');
      const withQ = arrivals.filter((a) => a.quality_json && typeof a.quality_json === 'object' && Object.keys(a.quality_json).length);
      if (withQ.length) {
        const wAvgQ = (key) => {
          let num = 0, den = 0;
          for (const a of withQ) {
            const v = parseFloat(a.quality_json[key]);
            if (Number.isNaN(v)) continue;
            const w = parseFloat(a.weight_mt) || 1;
            num += v * w; den += w;
          }
          return den > 0 ? Math.round((num / den) * 100) / 100 : null;
        };
        const vehicleArrival = {
          analysis_type: 'arrival', from_vehicle: true,
          moisture: wAvgQ('moisture'), broken: wAvgQ('broken'), chalky: wAvgQ('chalky'),
          foreign_matter: wAvgQ('foreign_matter'), purity: wAvgQ('purity'),
          price_per_mt: wAvgQ('price_per_mt'),
        };
        batchQuality = { arrival: vehicleArrival, post: batchQuality?.post || null };
      }
    }
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
      const { page = 1, limit = 50, type, entity, warehouse_id, status, supplier_id, product_id, variety, search, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
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
      if (product_id) query = query.where('l.product_id', product_id);
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

  // Purchase Invoice / GRN for a purchased rice lot — mirrors the sales invoice
  // (header, item, intake vehicle(s), supplier payment timeline, traceability).
  // Read-only; raw (purchased) lots only. No change to purchase/stock/payable
  // logic — it just assembles what already exists.
  async getPurchaseInvoice(req, res) {
    try {
      const { id } = req.params;
      const num = (v) => parseFloat(v) || 0;
      const isNumeric = /^\d+$/.test(id);
      const lot = await db('inventory_lots as l')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('suppliers as tv', 'l.transport_vendor_id', 'tv.id')
        .where(isNumeric ? { 'l.id': +id } : { 'l.lot_no': id })
        .select('l.*', 'w.name as warehouse_name', 'p.name as product_name',
          's.name as supplier_name', 's.phone as supplier_phone', 's.address as supplier_address', 's.email as supplier_email',
          'tv.name as transport_vendor_name')
        .first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });
      if (lot.type !== 'raw') {
        return res.status(400).json({ success: false, message: 'A purchase invoice is only available for purchased rice lots.' });
      }

      const vehs = await db('milling_vehicle_arrivals').where('lot_id', lot.id)
        .select('vehicle_no', 'driver_name', 'driver_phone', 'weight_mt', 'total_bags', 'arrival_date')
        .orderBy('id', 'asc');

      // Supplier payable for this lot (auto-created with linked_ref = lot_no).
      // The payable is the source of truth for what's been paid — the lot's own
      // paid_amount/due_amount can be stale (not synced on later finance payments).
      const payable = await db('payables')
        .where('linked_ref', lot.lot_no).andWhere('category', 'Raw Material').first();
      const pays = await db('payments')
        .andWhere('type', 'payment')
        .where(function () {
          if (payable) {
            this.where('linked_payable_id', payable.id)
              .orWhere(function () { this.where('source_table', 'inventory_lots').andWhere('source_id', lot.id); });
          } else {
            // Legacy fallback only when no payable exists.
            this.where(function () { this.where('source_table', 'inventory_lots').andWhere('source_id', lot.id); })
              .orWhere('notes', 'ilike', `%${lot.lot_no}%`);
          }
        })
        .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'cleared', 'notes')
        .orderBy('payment_date', 'asc').orderBy('id', 'asc');

      const qtyKg = num(lot.received_net_weight_kg) || num(lot.net_weight_kg);
      const amount = num(lot.purchase_amount) || num(lot.rate_per_kg) * qtyKg;
      const landed = payable ? num(payable.original_amount) || num(lot.landed_cost_total) || amount
        : num(lot.landed_cost_total) || amount;
      // Prefer the payable (authoritative); fall back to the lot's own fields.
      const paid = payable ? num(payable.paid_amount) : num(lot.paid_amount);
      const outstanding = payable ? num(payable.outstanding) : num(lot.due_amount);
      const paymentStatus = payable ? payable.status : lot.payment_status;

      const timeline = [{ kind: 'created', date: lot.purchase_date || lot.created_at, label: 'Purchase recorded', amount: landed, balance: landed }];
      let bal = landed;
      for (const p of pays) {
        bal = Math.max(0, bal - num(p.amount));
        timeline.push({ kind: 'payment', date: p.payment_date, paymentNo: p.payment_no, mode: p.payment_method, reference: p.bank_reference || null, cleared: p.cleared !== false, amount: num(p.amount), balance: bal });
      }

      // Produced by-product pricing (INTERNAL/ADMIN ONLY — gated by role, mirrors
      // the sales invoice): the per-grade output valuation of the milling batches
      // this purchased lot fed, attributed by the lot's share of each batch's
      // input (same basis as Lot/Batch 360). Excluded for non-admin viewers so a
      // supplier-facing GRN print never exposes our downstream valuation/recovery.
      const ADMIN_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];
      let roleName = req.user && req.user._roleName;
      if (!roleName && req.user && req.user.role_id) {
        const r = await db('roles').where({ id: req.user.role_id }).select('name').first();
        roleName = r && r.name;
      }
      let producedByproducts = [];
      if (ADMIN_ROLES.includes(roleName)) {
        const srcRows = await db('batch_source_lots as bsl').leftJoin('milling_batches as mb', 'mb.id', 'bsl.batch_id')
          .where('bsl.lot_id', lot.id).select('bsl.batch_id', 'bsl.qty_mt', 'mb.batch_no');
        const myBatchIds = [...new Set(srcRows.map(r => r.batch_id).filter(Boolean))];
        if (myBatchIds.length) {
          const allSrc = await db('batch_source_lots').whereIn('batch_id', myBatchIds).select('batch_id', 'qty_mt');
          const batchTotalQty = {}; for (const x of allSrc) batchTotalQty[x.batch_id] = (batchTotalQty[x.batch_id] || 0) + num(x.qty_mt);
          const myQtyByBatch = {}; const batchNoById = {};
          for (const r of srcRows) { myQtyByBatch[r.batch_id] = (myQtyByBatch[r.batch_id] || 0) + num(r.qty_mt); batchNoById[r.batch_id] = r.batch_no; }
          const priceBatches = await db('milling_batches').whereIn('id', myBatchIds)
            .select('id', 'batch_no', 'finished_price_per_mt', 'b1_price_per_mt', 'b2_price_per_mt', 'b3_price_per_mt',
              'csr_price_per_mt', 'short_grain_price_per_mt', 'broken_price_per_mt', 'powder_price_per_mt',
              'sweeping_price_per_mt', 'choba_price_per_mt', 'sortex_rejects_price_per_mt');
          const priceById = {}; for (const b of priceBatches) priceById[b.id] = b;
          const outLots = await db('inventory_lots as l').leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
            .whereIn('l.batch_ref', myBatchIds.map(b => `batch-${b}`)).whereIn('l.type', ['finished', 'byproduct'])
            .select('l.id', 'l.lot_no', 'l.batch_ref', 'l.type', 'l.item_name', 'l.grade', 'l.variety',
              'l.net_weight_kg', 'l.received_net_weight_kg', 'l.landed_cost_per_kg', 'w.name as warehouse_name');
          const priceForOutput = (o, b) => {
            const g = String(o.grade || '').toUpperCase();
            const n = String(o.item_name || '').toLowerCase();
            let perMt = 0;
            if (o.type === 'finished') perMt = num(b.finished_price_per_mt);
            else if (g === 'B1') perMt = num(b.b1_price_per_mt);
            else if (g === 'B2') perMt = num(b.b2_price_per_mt);
            else if (g === 'B3') perMt = num(b.b3_price_per_mt);
            else if (g === 'CSR') perMt = num(b.csr_price_per_mt);
            else if (g === 'SHORT GRAIN') perMt = num(b.short_grain_price_per_mt);
            else if (n.includes('powder')) perMt = num(b.powder_price_per_mt);
            else if (n.includes('sweep')) perMt = num(b.sweeping_price_per_mt);
            else if (n.includes('choba')) perMt = num(b.choba_price_per_mt);
            else if (n.includes('sortex')) perMt = num(b.sortex_rejects_price_per_mt);
            else if (n.includes('broken')) perMt = num(b.broken_price_per_mt);
            return perMt / 1000;
          };
          const byBatch = {};
          for (const o of outLots) {
            const bid = parseInt(String(o.batch_ref).replace(/^batch-/, ''), 10);
            const b = priceById[bid] || {};
            const tot = batchTotalQty[bid] || myQtyByBatch[bid] || 0;
            const share = tot > 0 ? (myQtyByBatch[bid] / tot) : 1;
            const produced = (num(o.received_net_weight_kg) || num(o.net_weight_kg)) * share;
            const salePerKg = priceForOutput(o, b);
            (byBatch[bid] = byBatch[bid] || []).push({
              lotId: o.id, lotNo: o.lot_no, type: o.type,
              productGrade: o.grade || o.item_name || '—', riceType: o.variety || o.item_name || '—',
              producedKg: produced, costPerKg: num(o.landed_cost_per_kg),
              salePricePerKg: salePerKg, recoveryValue: produced * salePerKg,
              warehouse: o.warehouse_name || null, href: `/lot-inventory/${o.id}`,
            });
          }
          producedByproducts = myBatchIds.map(bid => {
            const tot = batchTotalQty[bid] || myQtyByBatch[bid] || 0;
            return {
              batchId: bid, batchNo: batchNoById[bid] || `#${bid}`, batchHref: `/milling/${bid}`,
              sharePct: tot > 0 ? (myQtyByBatch[bid] / tot) * 100 : 100,
              outputs: (byBatch[bid] || []).sort((a, c) => (a.type === 'byproduct' ? 0 : 1) - (c.type === 'byproduct' ? 0 : 1)),
              byproductRecovery: (byBatch[bid] || []).filter(o => o.type === 'byproduct').reduce((s, o) => s + o.recoveryValue, 0),
            };
          }).filter(x => x.outputs.length);
        }
      }

      return res.json({
        success: true,
        data: {
          purchase: {
            id: lot.id, purchaseNo: lot.lot_no, date: lot.purchase_date || lot.created_at,
            supplier: lot.supplier_name || '—', supplierId: lot.supplier_id || null,
            supplierPhone: lot.supplier_phone || null, supplierAddress: lot.supplier_address || null,
            warehouse: lot.warehouse_name || null,
            riceType: lot.variety || lot.product_name || lot.item_name || '—',
            variety: lot.variety || null, grade: lot.grade || null,
            quantityKg: qtyKg, quantityMt: qtyKg / 1000,
            bags: lot.total_bags != null ? Number(lot.total_bags) : null, bagWeightKg: num(lot.bag_weight_kg) || null,
            ratePerKg: num(lot.rate_per_kg), landedCostPerKg: num(lot.landed_cost_per_kg),
            amount, landedTotal: landed, paymentStatus,
            paid, outstanding,
            supplierHref: lot.supplier_id ? `/finance/statements?type=supplier&id=${lot.supplier_id}` : null,
            lotHref: `/lot-inventory/${lot.id}`,
          },
          costs: {
            riceCost: num(lot.purchase_amount) || num(lot.rate_per_kg) * qtyKg,
            transport: num(lot.transport_cost), transportVendor: lot.transport_vendor_name || null,
            unloading: num(lot.unloading_cost), labor: num(lot.labor_cost),
            packing: num(lot.packing_cost), other: num(lot.other_cost),
            landedTotal: landed,
          },
          intakeVehicles: vehs.map(v => ({ vehicleNo: v.vehicle_no, driverName: v.driver_name || null, driverPhone: v.driver_phone || null, weightMt: num(v.weight_mt), totalBags: v.total_bags != null ? Number(v.total_bags) : null, arrivalDate: v.arrival_date || null })),
          payments: timeline,
          payable: payable ? { payNo: payable.pay_no, outstanding: num(payable.outstanding), status: payable.status } : null,
          producedByproducts, // INTERNAL/ADMIN ONLY — empty for non-admin viewers
        },
      });
    } catch (err) {
      console.error('getPurchaseInvoice error:', err);
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
      // Ordered quantity (what was ordered, vs the received netWeightKg above).
      // Defaults to received when not supplied, so a fully-received lot shows no variance.
      const orderedKg = (req.body.ordered_quantity_input != null && req.body.ordered_quantity_input !== '')
        ? uc.toKg(req.body.ordered_quantity_input, req.body.ordered_quantity_unit || quantity_unit, bagWt)
        : netWeightKg;
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
          received_net_weight_kg: netWeightKg, // what actually arrived (drives stock + bill)
          ordered_net_weight_kg: orderedKg,    // what was ordered (for the short/over variance)
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

        // Optional vehicle arrival(s) captured on the New Purchase Lot form —
        // each delivering truck, linked straight to this (pre-batch) lot. Rows
        // without a vehicle number are skipped. Weight is canonicalised to MT.
        const vehicles = Array.isArray(req.body.vehicles) ? req.body.vehicles : [];
        for (const v of vehicles) {
          const vno = String(v.vehicle_no || '').trim();
          if (!vno) continue;
          let vWeightMT = null;
          if (v.weight_kg != null && v.weight_kg !== '') vWeightMT = parseFloat(v.weight_kg) / 1000;
          else if (v.weight_mt != null && v.weight_mt !== '') vWeightMT = parseFloat(v.weight_mt);
          const vBags = v.total_bags != null && v.total_bags !== '' ? parseInt(v.total_bags, 10) : null;
          let vBagSize = v.bag_size_kg != null && v.bag_size_kg !== '' ? parseFloat(v.bag_size_kg) : null;
          if (!vBagSize && vWeightMT && vBags && vBags > 0) vBagSize = (vWeightMT * 1000) / vBags;
          await trx('milling_vehicle_arrivals').insert({
            lot_id: lot.id,
            batch_id: null,
            vehicle_no: vno,
            driver_name: v.driver_name || null,
            driver_phone: v.driver_phone || null,
            weight_mt: vWeightMT,
            bag_size_kg: vBagSize,
            total_bags: vBags,
            // Per-truck quality captured at intake (moisture/broken/purity/price…).
            quality_json: sanitizeLotQuality(v.quality_json || v.quality),
            arrival_date: v.arrival_date || purchase_date || new Date().toISOString().slice(0, 10),
            notes: v.notes || null,
            created_by: req.user?.id || null,
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
        // Transport is EXCLUDED — it's a hauler payable set on the lot via the
        // Additional Costs editor, not part of the rice's landed cost.
        const addDirectCosts = [labor_cost, unloading_cost, packing_cost, other_cost]
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

        // ── If the lot has rice committed to a milling batch (started but not yet
        //    yielded — nothing consumed), SPLIT instead of blending in place: freeze
        //    the committed portion's cost on THIS lot (so the batch is never
        //    re-priced) and move the un-milled remainder + the new purchase into a
        //    NEW lot at the blended cost. ─────────────────────────────────────────
        const committedRows = await trx('batch_source_lots').where({ lot_id: lotId }).select('id', 'batch_id', 'qty_mt');
        const committedKg = committedRows.reduce((s, r) => s + (parseFloat(r.qty_mt) || 0) * 1000, 0);

        if (committedKg > 0.5) {
          const oldNetKg = currentNetKg;
          const oldRate = parseFloat(lot.landed_cost_per_kg) || 0;
          const oldPurchaseAmt = parseFloat(lot.purchase_amount) || 0;
          const remainderKg = Math.max(0, oldNetKg - committedKg);
          const cf = oldNetKg > 0 ? committedKg / oldNetKg : 1; // committed fraction
          const rf = 1 - cf;                                    // remainder fraction
          const scale = (v, f) => uc.round2((parseFloat(v) || 0) * f);

          // 1) Freeze committed source-lot cost + lock each batch's raw_rice pool.
          const byBatch = {};
          for (const r of committedRows) {
            const ct = uc.round2(oldRate * (parseFloat(r.qty_mt) || 0) * 1000);
            await trx('batch_source_lots').where({ id: r.id }).update({ unit_cost_pkr: oldRate, cost_total_pkr: ct });
            byBatch[r.batch_id] = (byBatch[r.batch_id] || 0) + ct;
          }
          for (const bid of Object.keys(byBatch)) {
            const total = uc.round2(byBatch[bid]);
            const ex = await trx('milling_costs').where({ batch_id: bid, category: 'raw_rice' }).first();
            if (ex) await trx('milling_costs').where({ id: ex.id }).update({ amount: total });
            else await trx('milling_costs').insert({ batch_id: bid, category: 'raw_rice', amount: total, notes: 'Raw rice cost (locked at add-purchase split)' });
          }

          // 2) Shrink THIS lot to the committed portion (cost rate unchanged).
          const committedBags = Math.max(0, Math.round(committedKg / bagWt));
          const committedLanded = uc.round2(oldRate * committedKg);
          await trx('inventory_lots').where({ id: lotId }).update({
            qty: uc.kgToTon(committedKg),
            net_weight_kg: committedKg, gross_weight_kg: committedKg,
            available_qty: committedKg / 1000, total_bags: committedBags,
            received_net_weight_kg: committedKg,
            purchase_amount: scale(oldPurchaseAmt, cf),
            labor_cost: scale(lot.labor_cost, cf), unloading_cost: scale(lot.unloading_cost, cf),
            packing_cost: scale(lot.packing_cost, cf), other_cost: scale(lot.other_cost, cf),
            total_bag_cost: scale(lot.total_bag_cost, cf),
            landed_cost_total: committedLanded, total_value: committedLanded,
            cost_per_unit: oldRate * 1000,
            updated_at: trx.fn.now(),
          });
          const splitTxn = await generateTxnNo(trx);
          await trx('lot_transactions').insert({
            transaction_no: splitTxn, transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
            lot_id: lotId, transaction_type: 'lot_split', reference_module: 'purchase',
            input_unit: 'kg', input_qty: remainderKg, quantity_kg: -remainderKg, quantity_bags: -Math.round(remainderKg / bagWt),
            balance_kg: committedKg, balance_bags: committedBags, currency: 'PKR',
            remarks: `Split off ${(remainderKg / 1000).toFixed(2)} MT un-milled remainder into a new lot for an added purchase`,
            created_by: req.user?.id || null, performed_by: req.user?.id || null, performed_at: new Date(),
          });

          // 3) New lot = remainder (at old rate) + the new purchase (blended).
          const newNetKg = remainderKg + addNetKg;
          const newLanded = uc.round2(oldRate * remainderKg + addLandedTotal);
          const newRate = newNetKg > 0 ? uc.round4(newLanded / newNetKg) : 0;
          const newBags = Math.max(0, Math.round(remainderKg / bagWt) + addBags);
          const newPurchaseAmt = uc.round2(scale(oldPurchaseAmt, rf) + addPurchaseAmount);
          const newLotNo = await inventoryService.generateRiceLotNo(trx, { supplierId: lot.supplier_id, productId: lot.product_id, date: purchase_date });
          const newPaid = status === 'Paid' ? addLandedTotal : status === 'Partial' ? Math.max(0, Math.min(addLandedTotal, parseFloat(paid_amount) || 0)) : Math.max(0, parseFloat(paid_amount) || 0);
          // eslint-disable-next-line no-unused-vars
          const { id: _oid, created_at: _oc, updated_at: _ou, ...clone } = lot;
          const [newLot] = await trx('inventory_lots').insert({
            ...clone,
            lot_no: newLotNo,
            qty: uc.kgToTon(newNetKg), net_weight_kg: newNetKg, gross_weight_kg: newNetKg,
            available_qty: newNetKg / 1000, reserved_qty: 0, sold_weight_kg: 0, damaged_weight_kg: 0,
            total_bags: newBags, received_net_weight_kg: newNetKg,
            purchase_amount: newPurchaseAmt,
            // Blended purchase rate — keep rate_per_kg AND the displayed "Original
            // Rate" (rate_input_value) in sync so they never disagree on a blended lot.
            rate_per_kg: newNetKg > 0 ? uc.round4(newPurchaseAmt / newNetKg) : 0,
            rate_input_value: newNetKg > 0 ? uc.round4(newPurchaseAmt / newNetKg) : 0,
            rate_input_unit: 'kg',
            // Transport stays on the original lot (its hauler payable is keyed there);
            // the remainder lot carries only its share of the non-transport add-ons.
            transport_cost: 0, transport_vendor_id: null,
            labor_cost: uc.round2(scale(lot.labor_cost, rf) + (parseFloat(labor_cost) || 0)),
            unloading_cost: uc.round2(scale(lot.unloading_cost, rf) + (parseFloat(unloading_cost) || 0)),
            packing_cost: uc.round2(scale(lot.packing_cost, rf) + (parseFloat(packing_cost) || 0)),
            other_cost: uc.round2(scale(lot.other_cost, rf) + (parseFloat(other_cost) || 0)),
            total_bag_cost: uc.round2(scale(lot.total_bag_cost, rf) + addBagCost),
            landed_cost_total: newLanded, landed_cost_per_kg: newRate,
            total_value: newLanded, cost_per_unit: newRate * 1000,
            milling_status: null, status: 'Available',
            quality_json: lot.quality_json == null ? null : (typeof lot.quality_json === 'object' ? JSON.stringify(lot.quality_json) : lot.quality_json),
            // Only the NEW purchase is freshly owed here — the remainder's debt was
            // already booked on the original lot's purchase, so don't double-count it.
            paid_amount: newPaid, due_amount: uc.round2(addLandedTotal - newPaid),
            payment_status: newPaid >= addLandedTotal - 0.01 ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending',
          }).returning('*');

          // Ledger leg 1: the un-milled remainder carried over from the split (at
          // the original lot's rate) — so the new lot's ledger reconciles to its
          // full balance and shows the right price for every kg.
          if (remainderKg > 0.5) {
            const splitInTxn = await generateTxnNo(trx);
            await trx('lot_transactions').insert({
              transaction_no: splitInTxn, transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
              lot_id: newLot.id, transaction_type: 'lot_merge', reference_module: 'purchase',
              warehouse_to_id: newLot.warehouse_id,
              input_unit: 'kg', input_qty: remainderKg, quantity_kg: remainderKg, quantity_bags: Math.round(remainderKg / bagWt),
              rate_input_unit: 'kg', rate_input_value: uc.round4(oldRate), rate_per_kg: uc.round4(oldRate),
              cost_impact: uc.round2(oldRate * remainderKg), currency: 'PKR',
              balance_kg: remainderKg, balance_bags: Math.round(remainderKg / bagWt),
              remarks: `Un-milled remainder split from ${lot.lot_no} (${(remainderKg / 1000).toFixed(2)} MT @ ${uc.round4(oldRate)}/kg)`,
              created_by: req.user?.id || null, performed_by: req.user?.id || null, performed_at: new Date(),
            });
          }
          // Ledger leg 2: the new purchase tranche.
          const newTxn = await generateTxnNo(trx);
          await trx('lot_transactions').insert({
            transaction_no: newTxn, transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
            lot_id: newLot.id, transaction_type: 'purchase_in', reference_module: 'purchase',
            warehouse_to_id: newLot.warehouse_id,
            input_unit: quantity_unit, input_qty: parseFloat(quantity_input),
            quantity_kg: addNetKg, quantity_bags: addBags,
            rate_input_unit: rate_unit, rate_input_value: parseFloat(rate_input), rate_per_kg: addRatePerKg,
            cost_impact: addLandedTotal, currency: 'PKR',
            balance_kg: newNetKg, balance_bags: newBags,
            remarks: `Added purchase: ${parseFloat(quantity_input)} ${quantity_unit} @ ${parseFloat(rate_input)}/${rate_unit}`,
            created_by: req.user?.id || null, performed_by: req.user?.id || null, performed_at: new Date(),
          });
          await trx('inventory_movements').insert({
            lot_id: newLot.id, movement_type: 'purchase_receipt', qty: uc.kgToTon(addNetKg),
            to_warehouse_id: newLot.warehouse_id, dest_entity: newLot.entity,
            notes: `Added purchase (split from ${lot.lot_no})`,
            cost_per_unit: (addNetKg > 0 ? uc.round4(addLandedTotal / addNetKg) : 0) * 1000,
            total_cost: addLandedTotal, currency: 'PKR', created_by: req.user?.id || null,
          });
          if (addLandedTotal > 0) {
            const payNo = await generatePayNo(trx);
            await trx('payables').insert({
              pay_no: payNo, entity: 'mill', category: 'Raw Material', supplier_id: lot.supplier_id,
              linked_ref: newLotNo, original_amount: addLandedTotal, paid_amount: newPaid,
              outstanding: Math.max(0, uc.round2(addLandedTotal - newPaid)),
              due_date: addDays(purchase_date, 30),
              status: newPaid >= addLandedTotal - 0.01 ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending',
              currency: 'PKR', notes: `Added purchase — new lot ${newLotNo}`,
            });
            await accountingService.autoPost(trx, {
              triggerEvent: 'purchase_invoice', entity: 'mill', amount: addLandedTotal, currency: 'PKR',
              refType: 'Purchase Lot', refNo: newLotNo, description: `Added purchase — new lot ${newLotNo} (${lot.item_name})`,
              userId: req.user?.id || null, partyType: 'supplier', partyId: lot.supplier_id,
            });
          }

          // NOTE: we deliberately do NOT reallocate the supplier purchase debt on a
          // split. A purchase invoice follows the PURCHASE, not the rice's lot
          // location — the original purchase payable stays as-is, and the new lot is
          // only newly billed for its added tranche. The remainder it carries was
          // already invoiced on the original lot's purchase.
          return { __split: true, newLot: enrichLot(newLot), newLotNo, remainderMt: uc.kgToTon(remainderKg), committedMt: uc.kgToTon(committedKg) };
        }

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
          // Keep the displayed "Original Rate" in sync with the blended per-kg rate.
          rate_input_value: newRatePerKg,
          rate_input_unit: 'kg',
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

      // A split routes the remainder + new purchase into a brand-new lot.
      if (result && result.__split) {
        return res.status(200).json({
          success: true,
          data: { split: true, lot: result.newLot, newLotNo: result.newLotNo, remainderMt: result.remainderMt, committedMt: result.committedMt },
        });
      }
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

      const { entity, type } = req.query;
      let query = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p', 'l.product_id', 'p.id');

      if (status && status !== 'all') query = query.where('l.status', status);
      if (entity) query = query.where('l.entity', entity);
      if (type) query = query.where('l.type', type);

      let groupCol, nameCol;
      if (group_by === 'supplier') { groupCol = 'l.supplier_id'; nameCol = 's.name'; }
      else if (group_by === 'warehouse') { groupCol = 'l.warehouse_id'; nameCol = 'w.name'; }
      else if (group_by === 'variety') { groupCol = 'l.variety'; nameCol = 'l.variety'; }
      else if (group_by === 'grade') { groupCol = 'l.grade'; nameCol = 'l.grade'; }
      else if (group_by === 'processing_type') { groupCol = 'l.processing_type'; nameCol = 'l.processing_type'; }
      // Item/SKU view — each product with its on-hand stock & value across all lots.
      else if (group_by === 'product') { groupCol = 'l.product_id'; nameCol = 'p.name'; }
      else { groupCol = 'l.type'; nameCol = 'l.type'; }

      const isProduct = group_by === 'product';
      const rows = await query
        .select(
          db.raw(`${nameCol} as group_name`),
          db.raw(`${groupCol} as group_id`),
          // reorder_level only meaningful when grouping by product (the SKU view)
          ...(isProduct ? [db.raw('MAX(COALESCE(p.reorder_level, 0)) as reorder_level')] : []),
          db.raw('COUNT(l.id) as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0) as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0) as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0) as reserved_kg'),
          db.raw('COALESCE(SUM(l.sold_weight_kg), 0) as sold_kg'),
          db.raw('COALESCE(SUM(l.damaged_weight_kg), 0) as damaged_kg'),
          db.raw('COALESCE(SUM(l.total_bags), 0) as total_bags'),
          // Value of what's ACTUALLY on hand = on-hand kg × cost/kg. Using the
          // stored landed_cost_total would carry the original received value even
          // after a lot is milled/sold down (e.g. 3 MT left still showing the full
          // 33 MT cost). Compute it so value always tracks current quantity.
          db.raw(`COALESCE(SUM(
            (CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END)
            * COALESCE(NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.rate_per_kg, 0), CAST(l.cost_per_unit AS DECIMAL) / 1000.0, 0)
          ), 0) as total_value`),
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

  // ─── Set Product Reorder Level (Stock Summary) ───
  async setProductReorderLevel(req, res) {
    try {
      const { id } = req.params;
      const level = parseFloat(req.body.reorder_level);
      if (!Number.isFinite(level) || level < 0) {
        return res.status(400).json({ success: false, message: 'reorder_level must be a non-negative number.' });
      }
      const updated = await db('products').where({ id }).update({ reorder_level: level, updated_at: new Date() });
      if (!updated) return res.status(404).json({ success: false, message: 'Product not found.' });
      return res.json({ success: true, data: { id: Number(id), reorder_level: level } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Update Lot Costs ───
  async updateLotCosts(req, res) {
    try {
      const { id } = req.params;
      const { transport_cost, labor_cost, unloading_cost, packing_cost, other_cost, bag_cost_per_bag, transport_vendor_id } = req.body;

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id }).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }
        await assertLotEditableByOperator(req, lot, trx);

        const netKg = parseFloat(lot.net_weight_kg) || 0;
        // purchase_amount + additional costs are for the ORIGINAL received intake,
        // so the per-kg landed cost must divide by received_net_weight_kg — NOT the
        // current net weight, which milling/sales have already drawn down. Dividing
        // by the reduced weight inflates cost/kg wildly (e.g. 210 → 495 after a lot
        // was half-milled). Falls back to net weight for lots predating the column.
        const receivedKg = parseFloat(lot.received_net_weight_kg) || netKg;
        const totalBags = lot.total_bags || 0;
        const purchaseAmount = parseFloat(lot.purchase_amount) || 0;

        // parseFloat(undefined) is NaN, and `NaN ?? x` keeps NaN (?? only catches
        // null/undefined) — so an omitted body field would corrupt landed cost to
        // NaN. Fall back to the lot's stored value on any non-finite parse.
        const pick = (v, fb) => { const n = parseFloat(v); return Number.isFinite(n) ? n : (parseFloat(fb) || 0); };
        const tc = pick(transport_cost, lot.transport_cost);
        const lc = pick(labor_cost, lot.labor_cost);
        const ulc = pick(unloading_cost, lot.unloading_cost);
        const pc = pick(packing_cost, lot.packing_cost);
        const oc = pick(other_cost, lot.other_cost);
        const bcpb = pick(bag_cost_per_bag, lot.bag_cost_per_bag);
        const totalBagCost = lot.bag_cost_included ? 0 : bcpb * totalBags;
        // Transport (freight) is owed to a separate hauler and is NOT part of the
        // rice's landed cost / finished COGS — it is tracked as its own payable
        // below. So it is EXCLUDED from directCosts here.
        const directCosts = lc + ulc + pc + oc;
        const landedTotal = uc.round2(purchaseAmount + directCosts + totalBagCost);
        const landedPerKg = receivedKg > 0 ? uc.round4(landedTotal / receivedKg) : 0;
        const haulerId = (transport_vendor_id != null && transport_vendor_id !== '')
          ? parseInt(transport_vendor_id, 10) : (lot.transport_vendor_id || null);

        await trx('inventory_lots').where({ id }).update({
          transport_cost: tc, labor_cost: lc, unloading_cost: ulc,
          packing_cost: pc, other_cost: oc, bag_cost_per_bag: bcpb,
          transport_vendor_id: haulerId,
          total_bag_cost: totalBagCost,
          landed_cost_total: landedTotal,
          landed_cost_per_kg: landedPerKg,
          total_value: landedTotal,
          cost_per_unit: landedPerKg * 1000,
        });

        // Transport → a stored 'Transport' payable owed to the hauler PLUS a GL bill
        // (Dr Operating Expenses / Cr Supplier Payable, stamped to the hauler) so it
        // books the expense, shows on the hauler's statement, and settles via the
        // normal Record Payment flow. Keyed on the lot so re-edits reconcile.
        const lotId = parseInt(id, 10);
        const existingTp = await trx('payables').where({ source_table: 'lot_transport', source_id: lotId }).first();
        const paidSoFar = existingTp ? (parseFloat(existingTp.paid_amount) || 0) : 0;
        const wantBill = tc > 0 && haulerId;
        // Upsert the stored hauler payable (settles via the Record Payment flow).
        if (wantBill) {
          if (existingTp) {
            await trx('payables').where({ id: existingTp.id }).update({
              supplier_id: haulerId, category: 'Transport', original_amount: tc,
              outstanding: Math.max(0, uc.round2(tc - paidSoFar)),
              status: (tc - paidSoFar) <= 0.01 ? 'Paid' : (paidSoFar > 0 ? 'Partial' : 'Pending'),
              linked_ref: lot.lot_no, updated_at: trx.fn.now(),
            });
          } else {
            const payNo = await generatePayNo(trx);
            await trx('payables').insert({
              pay_no: payNo, entity: 'mill', payable_type: 'vendor', category: 'Transport',
              supplier_id: haulerId, linked_ref: lot.lot_no,
              source_table: 'lot_transport', source_id: lotId,
              original_amount: tc, paid_amount: 0, outstanding: tc, status: 'Pending',
              currency: 'PKR', notes: `Transport (hauler) for lot ${lot.lot_no}`,
            });
          }
        } else if (existingTp && paidSoFar <= 0.01) {
          await trx('payables').where({ id: existingTp.id }).del(); // cleared/unpaid → drop
        }

        // Re-accrue the GL with a single signed DELTA against the transport accrual
        // (Dr Operating Expenses / Cr Supplier Payable, swapped when it drops) — NOT
        // reverse+repost. The trial balance sums status='Posted' only while
        // reverseJournal marks the original 'Reversed' AND posts a 'Posted' contra,
        // so reverse+repost moves a Posted-only sum by -2x and piles up rows each
        // edit (see setLotPurchaseRate). Only while nothing is paid, so a settled
        // payment is never orphaned.
        if (paidSoFar <= 0.01) {
          const prevAp = await trx('journal_lines as jl')
            .join('journal_entries as je', 'je.id', 'jl.journal_id')
            .join('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
            .where({ 'je.ref_type': 'Lot Transport', 'je.ref_no': lot.lot_no, 'je.status': 'Posted' })
            .whereRaw("coa.code like '2%'")
            .select(trx.raw('coalesce(sum(jl.credit - jl.debit), 0) as net'));
          const oldBilled = parseFloat(prevAp?.[0]?.net) || 0;
          const newBilled = wantBill ? tc : 0;
          const tDelta = uc.round2(newBilled - oldBilled);
          const tHauler = haulerId || lot.transport_vendor_id || null;
          if (Math.abs(tDelta) > 0.01 && tHauler) {
            const rule = await trx('posting_rules')
              .where({ trigger_event: 'expense_recorded', is_active: true })
              .where(function () { this.where({ entity: 'mill' }).orWhereNull('entity'); })
              .first();
            if (rule) {
              const [expAcc, apAcc] = await Promise.all([
                trx('chart_of_accounts').where({ id: rule.debit_account_id }).first(),
                trx('chart_of_accounts').where({ id: rule.credit_account_id }).first(),
              ]);
              const amt = Math.abs(tDelta);
              const up = tDelta > 0; // more expense + more payable
              const lines = [
                { account_id: rule.debit_account_id, account: expAcc?.name || '',
                  debit: up ? amt : 0, credit: up ? 0 : amt,
                  narration: `${up ? 'DR' : 'CR'} ${expAcc ? expAcc.code + ' ' + expAcc.name : ''} — transport adj` },
                { account_id: rule.credit_account_id, account: apAcc?.name || '',
                  debit: up ? 0 : amt, credit: up ? amt : 0,
                  narration: `${up ? 'CR' : 'DR'} ${apAcc ? apAcc.code + ' ' + apAcc.name : ''} — transport adj` },
              ];
              const adj = await accountingService.createJournal(trx, {
                date: new Date().toISOString().slice(0, 10), entity: 'mill',
                refType: 'Lot Transport', refNo: lot.lot_no,
                description: `Lot ${lot.lot_no} transport adjustment (Rs ${tDelta >= 0 ? '+' : ''}${tDelta})`,
                lines, currency: 'PKR', isAuto: true, postingRuleId: rule.id,
                userId: req.user?.id, partyType: 'supplier', partyId: tHauler,
              });
              await accountingService.postJournal(trx, adj.id);
            }
          }
        }

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

  // ─── Edit a raw lot's PURCHASE RATE (the rice price) after recording ───
  // For when the agreed price differs at payment time. Re-prices on the lot's
  // immutable received weight, recomputes landed cost, updates the supplier's
  // Raw Material payable (so they owe the corrected amount), re-accrues the GL,
  // and cascades the cost into any batch that consumed the lot.
  async setLotPurchaseRate(req, res) {
    try {
      const { id } = req.params;
      const newRate = parseFloat(req.body.rate_per_kg);
      if (!Number.isFinite(newRate) || newRate <= 0) {
        return res.status(400).json({ success: false, message: 'rate_per_kg must be a positive number.' });
      }

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id }).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }
        await assertLotEditableByOperator(req, lot, trx);
        if (lot.type !== 'raw') { const e = new Error('Only raw purchase lots can be re-priced.'); e.status = 400; throw e; }

        const receivedKg = parseFloat(lot.received_net_weight_kg) || parseFloat(lot.net_weight_kg) || 0;
        if (receivedKg <= 0) { const e = new Error('Lot has no recorded weight to price.'); e.status = 400; throw e; }

        const newPurchaseAmount = uc.round2(receivedKg * newRate);
        const directCosts = (parseFloat(lot.labor_cost) || 0) + (parseFloat(lot.unloading_cost) || 0) + (parseFloat(lot.packing_cost) || 0) + (parseFloat(lot.other_cost) || 0);
        const totalBagCost = parseFloat(lot.total_bag_cost) || 0;
        const landedTotal = uc.round2(newPurchaseAmount + directCosts + totalBagCost);
        const landedPerKg = uc.round4(landedTotal / receivedKg);

        await trx('inventory_lots').where({ id }).update({
          rate_per_kg: newRate, purchase_amount: newPurchaseAmount,
          landed_cost_total: landedTotal, landed_cost_per_kg: landedPerKg,
          total_value: landedTotal, cost_per_unit: landedPerKg * 1000, updated_at: trx.fn.now(),
        });

        // Update the rice (Raw Material) payable for this lot — transport is its
        // own lot_transport payable and is left alone.
        let payableUpdated = false;
        const pay = await trx('payables').where({ linked_ref: lot.lot_no, category: 'Raw Material' })
          .where(function () { this.whereNull('source_table').orWhereNot('source_table', 'lot_transport'); }).first();
        if (pay) {
          const paid = parseFloat(pay.paid_amount) || 0;
          const outstanding = Math.max(0, uc.round2(landedTotal - paid));
          await trx('payables').where({ id: pay.id }).update({
            original_amount: landedTotal, outstanding,
            status: outstanding <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Pending'), updated_at: trx.fn.now(),
          });
          payableUpdated = true;
          // Re-accrue the GL by posting a single DELTA adjustment journal for the
          // change in landed cost — NOT reverse+repost. The trial balance sums
          // status='Posted' only, while reverseJournal marks the original
          // 'Reversed' AND posts a 'Posted' contra; that nets to -2× the accrual
          // in a Posted-only sum (double reversal) and accumulates rows on every
          // edit. A signed delta against the same purchase accounts leaves the
          // original accrual intact and moves the GL by exactly the change.
          const oldLanded = parseFloat(lot.landed_cost_total) || 0;
          const delta = uc.round2(landedTotal - oldLanded);
          if (Math.abs(delta) > 0.01 && lot.supplier_id) {
            const rule = await trx('posting_rules')
              .where({ trigger_event: 'purchase_invoice', is_active: true })
              .where(function () { this.where({ entity: 'mill' }).orWhereNull('entity'); })
              .first();
            if (rule) {
              const [stockAcc, apAcc] = await Promise.all([
                trx('chart_of_accounts').where({ id: rule.debit_account_id }).first(),
                trx('chart_of_accounts').where({ id: rule.credit_account_id }).first(),
              ]);
              const amt = Math.abs(delta);
              // delta > 0 → more stock + more payable (Dr stock / Cr AP);
              // delta < 0 → reverse direction (Dr AP / Cr stock).
              const up = delta > 0;
              const lines = [
                { account_id: rule.debit_account_id, account: stockAcc?.name || '',
                  debit: up ? amt : 0, credit: up ? 0 : amt,
                  narration: `${up ? 'DR' : 'CR'} ${stockAcc ? stockAcc.code + ' ' + stockAcc.name : ''} — price adj` },
                { account_id: rule.credit_account_id, account: apAcc?.name || '',
                  debit: up ? 0 : amt, credit: up ? amt : 0,
                  narration: `${up ? 'CR' : 'DR'} ${apAcc ? apAcc.code + ' ' + apAcc.name : ''} — price adj` },
              ];
              const adj = await accountingService.createJournal(trx, {
                date: new Date().toISOString().slice(0, 10), entity: 'mill',
                refType: 'Purchase Lot', refNo: lot.lot_no,
                description: `Lot ${lot.lot_no} price adjustment to Rs ${Math.round(newRate)}/kg (Rs ${delta >= 0 ? '+' : ''}${delta})`,
                lines, currency: 'PKR', isAuto: true, postingRuleId: rule.id,
                userId: req.user?.id, partyType: 'supplier', partyId: lot.supplier_id,
              });
              await accountingService.postJournal(trx, adj.id);
            }
          }
        }

        // Cascade into any batch that consumed this lot (batch_source_lots, raw
        // cost pool, output-lot costs, non-locked COGS / derived payables).
        const propagation = await inventoryService.propagateLotCostToBatches(trx, parseInt(id, 10), { userId: req.user?.id });
        const updated = await trx('inventory_lots').where({ id }).first();
        return { updated, payableUpdated, propagation };
      });

      return res.json({ success: true, data: { lot: enrichLot(result.updated), payableUpdated: result.payableUpdated, propagation: result.propagation } });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('setLotPurchaseRate error:', err);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // ─── Record the RECEIVED quantity on a raw lot (ordered vs received) ───
  //
  // A lot ordered for 14 MT but only 10 MT received: set received to the actual
  // amount; stock (net/available) drops to it, and the supplier bill re-bills to
  // received × rate + add-ons (the bill always follows what arrived). Over-receipt
  // (received > ordered) works the same way. Mirrors setLotPurchaseRate's payable +
  // signed-delta GL re-accrual. ordered_net_weight_kg is preserved (or optionally
  // corrected) so the short/over variance shows on the lot.
  async setLotReceivedQty(req, res) {
    try {
      const { id } = req.params;
      const newReceivedKg = parseFloat(req.body.received_net_weight_kg);
      if (!Number.isFinite(newReceivedKg) || newReceivedKg <= 0) {
        return res.status(400).json({ success: false, message: 'received_net_weight_kg must be a positive number (in kg).' });
      }
      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id }).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }
        await assertLotEditableByOperator(req, lot, trx);
        if (lot.type !== 'raw') { const e = new Error('Only raw purchase lots have a received quantity.'); e.status = 400; throw e; }

        const oldReceived = parseFloat(lot.received_net_weight_kg) || parseFloat(lot.net_weight_kg) || 0;
        const curNet = parseFloat(lot.net_weight_kg) || 0;
        const utilized = Math.max(0, uc.round2(oldReceived - curNet)); // already milled/sold/transferred out
        const reservedKg = (parseFloat(lot.reserved_qty) || 0) * 1000;
        const newNet = uc.round2(newReceivedKg - utilized);
        if (newNet < 0) { const e = new Error(`Received quantity is below what has already been used from this lot (${Math.round(utilized).toLocaleString()} kg).`); e.status = 409; throw e; }
        if (newNet < reservedKg - 0.01) { const e = new Error(`Received quantity is below the amount already reserved (${Math.round(reservedKg).toLocaleString()} kg). Release reservations first.`); e.status = 409; throw e; }

        const rate = parseFloat(lot.rate_per_kg) || 0;
        const newPurchaseAmount = uc.round2(newReceivedKg * rate);
        const directCosts = (parseFloat(lot.labor_cost) || 0) + (parseFloat(lot.unloading_cost) || 0) + (parseFloat(lot.packing_cost) || 0) + (parseFloat(lot.other_cost) || 0);
        const totalBagCost = parseFloat(lot.total_bag_cost) || 0;
        const landedTotal = uc.round2(newPurchaseAmount + directCosts + totalBagCost);
        const landedPerKg = newReceivedKg > 0 ? uc.round4(landedTotal / newReceivedKg) : 0;

        const orderedInput = req.body.ordered_net_weight_kg;
        const orderedKg = (orderedInput != null && orderedInput !== '')
          ? Math.max(0, parseFloat(orderedInput))
          : (parseFloat(lot.ordered_net_weight_kg) || oldReceived);

        await trx('inventory_lots').where({ id }).update({
          received_net_weight_kg: newReceivedKg,
          ordered_net_weight_kg: orderedKg,
          net_weight_kg: newNet, gross_weight_kg: newNet,
          qty: uc.kgToTon(newNet), available_qty: newNet / 1000,
          purchase_amount: newPurchaseAmount,
          landed_cost_total: landedTotal, landed_cost_per_kg: landedPerKg,
          total_value: landedTotal, cost_per_unit: landedPerKg * 1000,
          updated_at: trx.fn.now(),
        });

        // Re-bill the Raw Material payable + re-accrue the GL with a signed delta
        // (same as setLotPurchaseRate — never reverse+repost).
        let payableUpdated = false;
        const pay = await trx('payables').where({ linked_ref: lot.lot_no, category: 'Raw Material' })
          .where(function () { this.whereNull('source_table').orWhereNot('source_table', 'lot_transport'); }).first();
        if (pay) {
          const paid = parseFloat(pay.paid_amount) || 0;
          const outstanding = Math.max(0, uc.round2(landedTotal - paid));
          await trx('payables').where({ id: pay.id }).update({
            original_amount: landedTotal, outstanding,
            status: outstanding <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Pending'), updated_at: trx.fn.now(),
          });
          payableUpdated = true;
        }
        const oldLanded = parseFloat(lot.landed_cost_total) || 0;
        const delta = uc.round2(landedTotal - oldLanded);
        if (Math.abs(delta) > 0.01 && lot.supplier_id) {
          const rule = await trx('posting_rules')
            .where({ trigger_event: 'purchase_invoice', is_active: true })
            .where(function () { this.where({ entity: 'mill' }).orWhereNull('entity'); }).first();
          if (rule) {
            const [stockAcc, apAcc] = await Promise.all([
              trx('chart_of_accounts').where({ id: rule.debit_account_id }).first(),
              trx('chart_of_accounts').where({ id: rule.credit_account_id }).first(),
            ]);
            const amt = Math.abs(delta);
            const up = delta > 0;
            const lines = [
              { account_id: rule.debit_account_id, account: stockAcc?.name || '', debit: up ? amt : 0, credit: up ? 0 : amt, narration: `${up ? 'DR' : 'CR'} ${stockAcc ? stockAcc.code + ' ' + stockAcc.name : ''} — received qty adj` },
              { account_id: rule.credit_account_id, account: apAcc?.name || '', debit: up ? 0 : amt, credit: up ? amt : 0, narration: `${up ? 'CR' : 'DR'} ${apAcc ? apAcc.code + ' ' + apAcc.name : ''} — received qty adj` },
            ];
            const adj = await accountingService.createJournal(trx, {
              date: new Date().toISOString().slice(0, 10), entity: 'mill',
              refType: 'Purchase Lot', refNo: lot.lot_no,
              description: `Lot ${lot.lot_no} received qty set to ${Math.round(newReceivedKg).toLocaleString()} kg (bill Rs ${delta >= 0 ? '+' : ''}${delta})`,
              lines, currency: 'PKR', isAuto: true, postingRuleId: rule.id,
              userId: req.user?.id, partyType: 'supplier', partyId: lot.supplier_id,
            });
            await accountingService.postJournal(trx, adj.id);
          }
        }

        const propagation = await inventoryService.propagateLotCostToBatches(trx, parseInt(id, 10), { userId: req.user?.id });
        const updated = await trx('inventory_lots').where({ id }).first();
        return { updated, payableUpdated, propagation };
      });
      return res.json({ success: true, data: { lot: enrichLot(result.updated), payableUpdated: result.payableUpdated, propagation: result.propagation } });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('setLotReceivedQty error:', err);
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
      await assertLotEditableByOperator(req, lot, db);

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
      const status = err.status || 500;
      if (status === 500) console.error('updateLotQuality error:', err);
      return res.status(status).json({ success: false, message: err.message });
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
  // Transfer a finished mill lot's stock to the export entity
  // ═══════════════════════════════════════════════════════════════════
  // Deducts qty from THIS specific mill lot and creates a matching
  // export-entity lot (inventoryService.transferToExport). Unlike the
  // batch→order /internal-transfers flow this is lot-precise and validates
  // available stock up front, so it can never record a transfer that didn't
  // actually move inventory. Optionally links to an export order.
  async transferLotToExport(req, res) {
    try {
      const { id } = req.params;
      const { qty_mt, transfer_price_pkr, export_order_id, notes } = req.body || {};
      const qty = parseFloat(qty_mt);
      if (!qty || qty <= 0) {
        return res.status(400).json({ success: false, message: 'A positive qty_mt is required.' });
      }

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where('id', id).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }
        if (lot.entity !== 'mill') { const e = new Error('Only mill-entity lots can be transferred to export.'); e.status = 422; throw e; }
        if (!['finished', 'byproduct'].includes(lot.type)) { const e = new Error('Only finished or by-product lots can be transferred to export.'); e.status = 422; throw e; }

        const avail = parseFloat(lot.available_qty) || 0;
        if (qty > avail + 0.0001) {
          const e = new Error(`Insufficient stock: ${avail} MT available in ${lot.lot_no}, requested ${qty} MT.`); e.status = 422; throw e;
        }

        const pricePerMT = (transfer_price_pkr != null && transfer_price_pkr !== '')
          ? parseFloat(transfer_price_pkr)
          : (parseFloat(lot.cost_per_unit) || 0);
        const totalValue = pricePerMT * qty;

        // Traceability row (transfer_no IT-NNN). batch_id null — this is a
        // direct lot transfer, not a batch→order one.
        const last = await trx('internal_transfers').select('transfer_no').orderBy('created_at', 'desc').first();
        const seq = (last && last.transfer_no) ? (parseInt(String(last.transfer_no).replace('IT-', ''), 10) || 0) + 1 : 1;
        const transferNo = `IT-${String(seq).padStart(3, '0')}`;
        const [t] = await trx('internal_transfers').insert({
          transfer_no: transferNo,
          batch_id: null,
          export_order_id: export_order_id || null,
          product_name: lot.item_name,
          qty_mt: qty,
          transfer_price_pkr: pricePerMT,
          total_value_pkr: totalValue,
          pkr_rate: 280,
          dispatch_date: new Date().toISOString().slice(0, 10),
          status: 'Completed',
          created_by: req.user?.id || null,
        }).returning('*');

        // Move the stock: deduct this lot, create the export-entity lot.
        const moved = await inventoryService.transferToExport(trx, {
          transferId: t.id,
          lotId: lot.id,
          qtyMT: qty,
          productName: lot.item_name,
          orderId: export_order_id || null,
          transferPricePerMT: pricePerMT,
          totalValuePkr: totalValue,
          userId: req.user?.id,
        });

        // Dual-entity inter-company journals (best-effort — a posting failure
        // must not roll back the physical transfer).
        if (totalValue > 0) {
          try {
            await trx.transaction(async (sp) => {
              await accountingService.autoPost(sp, {
                triggerEvent: 'internal_transfer_mill', entity: 'mill', amount: totalValue, currency: 'PKR',
                refType: 'Internal Transfer', refNo: transferNo,
                description: `Stock transfer to export — ${lot.item_name}`, userId: req.user?.id,
              });
              await accountingService.autoPost(sp, {
                triggerEvent: 'internal_transfer_export', entity: 'export', amount: totalValue, currency: 'PKR',
                refType: 'Internal Transfer', refNo: transferNo,
                description: `Stock received from mill — ${lot.item_name}`, userId: req.user?.id,
              });
            });
          } catch (e) { console.warn('internal transfer journals failed (non-blocking):', e.message); }
        }

        return { transfer: t, exportLot: moved.exportLot, sourceLotNo: lot.lot_no };
      });

      return res.status(201).json({
        success: true,
        message: `Transferred ${qty} MT from ${result.sourceLotNo} to export lot ${result.exportLot.lot_no}.`,
        data: result,
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      console.error('transferLotToExport error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Transfer failed.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Transfer an export lot's stock back to the mill entity
  // ═══════════════════════════════════════════════════════════════════
  // Mirror of transferLotToExport. Deducts this export lot and creates a
  // mill-entity lot. Only the lot's AVAILABLE qty can move (reserved-for-order
  // stock is excluded by the availability check). No internal_transfers row /
  // journals here — that table + posting rules are mill→export oriented; the
  // lot ledger (transfer_out/in with entity_from=export, entity_to=mill) is the
  // record of the reverse move.
  async transferLotToMill(req, res) {
    try {
      const { id } = req.params;
      const { qty_mt, transfer_price_pkr } = req.body || {};
      const qty = parseFloat(qty_mt);
      if (!qty || qty <= 0) {
        return res.status(400).json({ success: false, message: 'A positive qty_mt is required.' });
      }

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where('id', id).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }
        if (lot.entity !== 'export') { const e = new Error('Only export-entity lots can be transferred back to mill.'); e.status = 422; throw e; }

        const avail = parseFloat(lot.available_qty) || 0;
        if (qty > avail + 0.0001) {
          const e = new Error(`Insufficient available stock: ${avail} MT in ${lot.lot_no}${parseFloat(lot.reserved_qty) > 0 ? ` (${lot.reserved_qty} MT reserved for an order)` : ''}, requested ${qty} MT.`);
          e.status = 422; throw e;
        }

        const moved = await inventoryService.transferToMill(trx, {
          transferId: null,
          lotId: lot.id,
          qtyMT: qty,
          productName: lot.item_name,
          transferPricePerMT: (transfer_price_pkr != null && transfer_price_pkr !== '') ? parseFloat(transfer_price_pkr) : null,
          userId: req.user?.id,
        });

        return { exportLotNo: lot.lot_no, millLot: moved.millLot };
      });

      return res.status(201).json({
        success: true,
        message: `Transferred ${qty} MT from ${result.exportLotNo} back to mill lot ${result.millLot.lot_no}.`,
        data: result,
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      console.error('transferLotToMill error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Transfer failed.' });
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
          // No auto milling fee — it's entered later in the batch Costing tab
          // (residual costing model). Default 0 instead of the old flat 5/kg.
          milling_fee_per_kg: milling_fee_per_kg != null ? parseFloat(milling_fee_per_kg) : 0,
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

        // If any carried-over truck has a per-truck price (quality_json.price_per_mt
        // captured at intake), drive the batch raw_rice cost from the trucks
        // (Σ weight × price). No-op when no truck is priced — the raw cost then
        // falls back to the lot's landed cost via ensureRawCostFromSourceLots.
        if (inheritedVehicles > 0) {
          await inventoryService.recomputeRawRiceCostFromVehicles(trx, batch.id, req.user?.id);
        }

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
