const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const controller = require('../../controllers/millingController');
const advancedController = require('../../controllers/millingAdvancedController');
const authorize = require('../../middleware/rbac');
const { authorizeRole } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const aiService = require('../ai/ai.service');

// =============================================================================
// Existing Batch Routes
// =============================================================================

router.get('/batches', authorize('milling', 'view'), controller.list);
router.get('/batches/:id', authorize('milling', 'view'), controller.getById);
router.put('/batches/:id', authorize('milling', 'edit'),
  auditAction('update_batch', 'milling_batch', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = /^\d+$/.test(req.params.id) ? parseInt(req.params.id)
        : (await db('milling_batches').where('batch_no', req.params.id).select('id').first())?.id;
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found' });

      const allowed = ['supplier_id', 'raw_qty_mt', 'planned_finished_mt', 'milling_fee_per_kg',
        'mill_id', 'machine_line', 'shift', 'notes', 'variance_status', 'status'];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      // Also update supplier_name if supplier_id is set
      if (updates.supplier_id) {
        const supplier = await db('suppliers').where('id', updates.supplier_id).first();
        if (supplier) updates.supplier_name = supplier.name;
      }
      updates.updated_at = db.fn.now();

      const [batch] = await db('milling_batches').where({ id }).update(updates).returning('*');
      return res.json({ success: true, data: { batch } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);
router.post(
  '/batches',
  authorize('milling', 'create'),
  validate(schemas.createBatch),
  auditAction('create', 'milling_batch', (req, data) => data.data && data.data.batch ? data.data.batch.id : null),
  controller.create
);
router.put(
  '/batches/:id',
  authorize('milling', 'edit'),
  auditAction('update', 'milling_batch', (req) => req.params.id),
  controller.update
);
router.post(
  '/batches/:id/quality',
  authorize('milling', 'approve_quality'),
  auditAction('approve_quality', 'milling_batch', (req) => req.params.id),
  controller.saveQuality
);
router.post(
  '/batches/:id/yield',
  authorize('milling', 'record_yield'),
  auditAction('record_yield', 'milling_batch', (req) => req.params.id),
  controller.recordYield
);
router.post(
  '/batches/:id/costs',
  authorize('milling', 'manage_costs'),
  auditAction('add_cost', 'milling_batch', (req) => req.params.id),
  controller.addCost
);
router.post(
  '/batches/:id/vehicles',
  authorize('milling', 'add_vehicle'),
  auditAction('add_vehicle', 'milling_batch', (req) => req.params.id),
  controller.addVehicle
);

// High-level rice purchase entry: auto-finds/creates today's open batch
// for (supplier, variety) so multiple trucks land in ONE batch + ONE lot.
router.post(
  '/rice-receipts',
  authorize('milling', 'add_vehicle'),
  auditAction('receive_rice', 'milling_vehicle_arrival', (req, data) => data.data?.vehicle?.id),
  controller.receiveRice
);

// Rice Purchases ledger — one row per vehicle arrival, joined to
// supplier, batch, variety, lot. Filters: from_date, to_date,
// supplier_id, product_id.
router.get('/rice-purchases', authorize('milling', 'view'), async (req, res) => {
  try {
    const { from_date, to_date, supplier_id, product_id, limit = 500 } = req.query;
    let q = db('milling_vehicle_arrivals as va')
      .leftJoin('milling_batches as mb', 'va.batch_id', 'mb.id')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .leftJoin('products as p', 'mb.product_id', 'p.id')
      // The raw rice lot for this batch (one per batch with our new
      // merge logic) — picked deterministically.
      .leftJoin(
        db('inventory_lots')
          .select('lot_no', 'batch_ref', 'id as lot_id')
          .where({ type: 'raw', entity: 'mill' })
          .as('lot'),
        'lot.batch_ref', db.raw("'batch-' || mb.id")
      )
      // Arrival analysis carries the agreed price/MT + moisture/broken for the
      // batch (entered after the truck arrives). The ledger surfaces these —
      // they live in milling_quality_samples, not the vehicle row's quality_json.
      .leftJoin(
        db.raw(`(SELECT DISTINCT ON (batch_id) batch_id, moisture, broken, price_per_kg, price_per_mt
                 FROM milling_quality_samples WHERE analysis_type = 'arrival'
                 ORDER BY batch_id, created_at DESC) as aq`),
        'aq.batch_id', 'mb.id'
      )
      .select(
        'va.id',
        'va.vehicle_no',
        'va.driver_name',
        'va.driver_phone',
        'va.weight_mt',
        'va.bag_size_kg',
        'va.total_bags',
        'va.arrival_date',
        'va.quality_json',
        'va.notes',
        'va.created_at',
        'mb.id as batch_id',
        'mb.batch_no',
        'mb.status as batch_status',
        's.id as supplier_id',
        's.name as supplier_name',
        'p.id as product_id',
        'p.code as product_code',
        'p.name as product_name',
        'lot.lot_no',
        'lot.lot_id',
        'aq.moisture as aq_moisture',
        'aq.broken as aq_broken',
        'aq.price_per_kg as aq_price_per_kg',
        'aq.price_per_mt as aq_price_per_mt'
      )
      .orderBy('va.arrival_date', 'desc')
      .orderBy('va.created_at', 'desc')
      .limit(Math.min(parseInt(limit, 10) || 500, 2000));

    if (from_date) q = q.where('va.arrival_date', '>=', from_date);
    if (to_date) q = q.where('va.arrival_date', '<=', to_date);
    if (supplier_id) q = q.where('mb.supplier_id', supplier_id);
    if (product_id) q = q.where('mb.product_id', product_id);

    const rawRows = await q;
    // Merge the arrival analysis (price/MT, moisture, broken) into quality_json so
    // the ledger's Price/MT, Value and Moisture columns populate. A value already
    // on the vehicle row's own quality_json wins.
    const rows = rawRows.map((r) => {
      const qj = r.quality_json || {};
      const { aq_moisture, aq_broken, aq_price_per_kg, aq_price_per_mt, ...rest } = r;
      return {
        ...rest,
        quality_json: {
          ...qj,
          price_per_mt: qj.price_per_mt ?? (aq_price_per_mt != null ? parseFloat(aq_price_per_mt) : null),
          price_per_kg: qj.price_per_kg ?? (aq_price_per_kg != null ? parseFloat(aq_price_per_kg) : null),
          moisture: qj.moisture ?? (aq_moisture != null ? parseFloat(aq_moisture) : null),
          broken: qj.broken ?? (aq_broken != null ? parseFloat(aq_broken) : null),
        },
      };
    });

    // Summary totals
    const totalWeight = rows.reduce((s, r) => s + (parseFloat(r.weight_mt) || 0), 0);
    const totalValue = rows.reduce((s, r) => {
      const w = parseFloat(r.weight_mt) || 0;
      const p = r.quality_json && r.quality_json.price_per_mt
        ? parseFloat(r.quality_json.price_per_mt) : 0;
      return s + (w * p);
    }, 0);

    return res.json({
      success: true,
      data: {
        purchases: rows,
        summary: {
          count: rows.length,
          totalWeightMT: totalWeight,
          totalValuePKR: totalValue,
        },
      },
    });
  } catch (err) {
    console.error('Rice purchases ledger error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
router.delete(
  '/batches/:id/vehicles/:vehicleId',
  authorize('milling', 'edit'),
  auditAction('delete_vehicle', 'milling_batch', (req) => req.params.id),
  controller.deleteVehicle
);
router.delete(
  '/batches/:id',
  authorizeRole('Super Admin', 'Mill Manager'),
  auditAction('delete', 'milling_batch', (req) => req.params.id),
  controller.deleteBatch
);

// =============================================================================
// Production Planning
// =============================================================================

router.get('/plans', authorize('milling', 'view'), advancedController.listPlans);
router.post(
  '/plans',
  authorize('milling', 'create'),
  auditAction('create', 'production_plan', (req, data) => data.data && data.data.plan ? data.data.plan.id : null),
  advancedController.createPlan
);
router.put(
  '/plans/:id/start',
  authorize('milling', 'edit'),
  auditAction('start_production', 'production_plan', (req) => req.params.id),
  advancedController.startPlan
);
router.put(
  '/plans/:id/complete',
  authorize('milling', 'edit'),
  auditAction('complete_production', 'production_plan', (req) => req.params.id),
  advancedController.completePlan
);

// =============================================================================
// Source Lots (Batch-level)
// =============================================================================

router.get('/cash-flow', authorize('milling', 'view'), advancedController.cashFlow);
router.get('/batches/:id/source-lots', authorize('milling', 'view'), advancedController.listSourceLots);
router.post(
  '/batches/:id/source-lots',
  authorize('milling', 'edit'),
  auditAction('add_source_lot', 'milling_batch', (req) => req.params.id),
  advancedController.addSourceLot
);

// =============================================================================
// Post-Milling Quality (Batch-level)
// =============================================================================

router.get('/batches/:id/post-quality', authorize('milling', 'view'), advancedController.listPostQuality);
router.post(
  '/batches/:id/post-quality',
  authorize('milling', 'approve_quality'),
  auditAction('record_post_quality', 'milling_batch', (req) => req.params.id),
  advancedController.recordPostQuality
);

// =============================================================================
// Recovery Benchmark Comparison (Batch-level)
// =============================================================================

router.get('/batches/:id/benchmark-comparison', authorize('milling', 'view'), advancedController.compareBenchmark);

// =============================================================================
// Reprocessing
// =============================================================================

router.get('/reprocessing', authorize('milling', 'view'), advancedController.listReprocessing);
router.post(
  '/reprocessing',
  authorize('milling', 'create'),
  auditAction('create', 'reprocessing_batch', (req, data) => data.data && data.data.reprocessing ? data.data.reprocessing.id : null),
  advancedController.createReprocessing
);
router.put(
  '/reprocessing/:id/complete',
  authorize('milling', 'edit'),
  auditAction('complete_reprocessing', 'reprocessing_batch', (req) => req.params.id),
  advancedController.completeReprocessing
);

// =============================================================================
// Machine Downtime
// =============================================================================

router.get('/downtime', authorize('milling', 'view'), advancedController.listDowntime);
router.post(
  '/downtime',
  authorize('milling', 'create'),
  auditAction('record', 'machine_downtime', (req, data) => data.data && data.data.downtime ? data.data.downtime.id : null),
  advancedController.recordDowntime
);
router.put(
  '/downtime/:id/resolve',
  authorize('milling', 'edit'),
  auditAction('resolve', 'machine_downtime', (req) => req.params.id),
  advancedController.resolveDowntime
);

// =============================================================================
// Utility Consumption
// =============================================================================

router.get('/utilities', authorize('milling', 'view'), advancedController.listUtilities);
router.post(
  '/utilities',
  authorize('milling', 'create'),
  auditAction('record', 'utility_consumption', (req, data) => data.data && data.data.utility ? data.data.utility.id : null),
  advancedController.recordUtility
);

// =============================================================================
// Recovery Benchmarks (Master Data)
// =============================================================================

router.get('/benchmarks', authorize('milling', 'view'), advancedController.listBenchmarks);
router.post(
  '/benchmarks',
  authorize('milling', 'create'),
  auditAction('create', 'recovery_benchmark', (req, data) => data.data && data.data.benchmark ? data.data.benchmark.id : null),
  advancedController.createBenchmark
);
router.put(
  '/benchmarks/:id',
  authorize('milling', 'edit'),
  auditAction('update', 'recovery_benchmark', (req) => req.params.id),
  advancedController.updateBenchmark
);

// =============================================================================
// Mills (Master Data)
// =============================================================================

router.get('/mills', authorize('milling', 'view'), advancedController.listMills);
router.post(
  '/mills',
  authorize('milling', 'create'),
  auditAction('create', 'mill', (req, data) => data.data && data.data.mill ? data.data.mill.id : null),
  advancedController.createMill
);
router.put(
  '/mills/:id',
  authorize('milling', 'edit'),
  auditAction('update', 'mill', (req) => req.params.id),
  advancedController.updateMill
);
router.delete(
  '/mills/:id',
  authorize('milling', 'edit'),
  auditAction('delete', 'mill', (req) => req.params.id),
  advancedController.deleteMill
);

// =============================================================================
// Analytics
// =============================================================================

router.get('/analytics/utilization', authorize('milling', 'view'), advancedController.analyticsUtilization);
router.get('/analytics/recovery-trends', authorize('milling', 'view'), advancedController.analyticsRecoveryTrends);
router.get('/analytics/supplier-comparison', authorize('milling', 'view'), advancedController.analyticsSupplierComparison);
router.get('/analytics/operator-productivity', authorize('milling', 'view'), advancedController.analyticsOperatorProductivity);
router.get('/analytics/moisture-analysis', authorize('milling', 'view'), advancedController.analyticsMoistureAnalysis);
router.get('/analytics/batch-profitability/:id', authorize('milling', 'view'), advancedController.analyticsBatchProfitability);

// =============================================================================
// Product Pricing — confirm byproduct prices per batch
// =============================================================================

router.get('/last-prices', authorize('milling', 'view'), async (req, res) => {
  try {
    // Get the most recent batch with confirmed prices
    const last = await db('milling_batches')
      .whereNotNull('finished_price_per_mt')
      .where('prices_confirmed', true)
      .orderBy('completed_at', 'desc')
      .select(
        'finished_price_per_mt', 'broken_price_per_mt',
        'bran_price_per_mt', 'husk_price_per_mt',
        'sortex_rejects_price_per_mt',
        'b1_price_per_mt', 'b2_price_per_mt', 'b3_price_per_mt',
        'csr_price_per_mt', 'short_grain_price_per_mt',
        'batch_no', 'completed_at'
      )
      .first();

    const brokenDefault = parseFloat(last?.broken_price_per_mt) || 38000;
    return res.json({
      success: true,
      data: {
        lastPrices: last ? {
          finished:    parseFloat(last.finished_price_per_mt) || 72800,
          broken:      brokenDefault,
          bran:        parseFloat(last.bran_price_per_mt) || 28000,
          husk:        parseFloat(last.husk_price_per_mt) || 8400,
          sortex:      parseFloat(last.sortex_rejects_price_per_mt) || 35000,
          // Per-grade broken prices — fall back to the aggregate broken
          // price so old batches give the operator a sensible starting
          // value until they set grade-specific rates.
          b1:          parseFloat(last.b1_price_per_mt) || brokenDefault,
          b2:          parseFloat(last.b2_price_per_mt) || brokenDefault,
          b3:          parseFloat(last.b3_price_per_mt) || brokenDefault,
          csr:         parseFloat(last.csr_price_per_mt) || brokenDefault,
          short_grain: parseFloat(last.short_grain_price_per_mt) || brokenDefault,
          fromBatch:   last.batch_no,
          date:        last.completed_at,
        } : {
          finished: 72800, broken: 38000, bran: 28000, husk: 8400, sortex: 35000,
          b1: 38000, b2: 38000, b3: 38000, csr: 38000, short_grain: 38000,
          fromBatch: null, date: null,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/batches/:id/prices', authorize('milling', 'edit'),
  auditAction('confirm_prices', 'milling_batch', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = await controller.resolveBatchId ? await controller.resolveBatchId(req.params.id) : parseInt(req.params.id);
      const {
        broken_price_per_mt,
        bran_price_per_mt, husk_price_per_mt,
        sortex_rejects_price_per_mt,
        b1_price_per_mt, b2_price_per_mt, b3_price_per_mt,
        csr_price_per_mt, short_grain_price_per_mt,
        powder_price_per_mt, sweeping_price_per_mt,
        // Residual costing inputs — operator-entered Milling Cost and Other
        // Expenses (PKR totals). Finished price is DERIVED, not accepted here.
        manual_milling_cost_pkr, manual_other_expenses_pkr,
      } = req.body;

      // 0 is a valid manual cost; only blank/invalid → null.
      const numOrNull = (v) => (v === '' || v == null || Number.isNaN(parseFloat(v))) ? null : parseFloat(v);

      const priceUpdate = {
        broken_price_per_mt: parseFloat(broken_price_per_mt) || null,
        bran_price_per_mt: parseFloat(bran_price_per_mt) || null,
        husk_price_per_mt: parseFloat(husk_price_per_mt) || null,
        sortex_rejects_price_per_mt: parseFloat(sortex_rejects_price_per_mt) || null,
        b1_price_per_mt: parseFloat(b1_price_per_mt) || null,
        b2_price_per_mt: parseFloat(b2_price_per_mt) || null,
        b3_price_per_mt: parseFloat(b3_price_per_mt) || null,
        csr_price_per_mt: parseFloat(csr_price_per_mt) || null,
        short_grain_price_per_mt: parseFloat(short_grain_price_per_mt) || null,
        powder_price_per_mt: parseFloat(powder_price_per_mt) || null,
        sweeping_price_per_mt: parseFloat(sweeping_price_per_mt) || null,
        manual_milling_cost_pkr: numOrNull(manual_milling_cost_pkr),
        manual_other_expenses_pkr: numOrNull(manual_other_expenses_pkr),
        prices_confirmed: true,
      };

      // Persist prices + manual costs, then run the residual cost engine across
      // the batch's output lots (finished = Net Purchase − by-product value),
      // recomputing COGS for any non-locked order/sale. Stamp the derived
      // finished cost back onto finished_price_per_mt for display.
      const inventoryService = require('../inventory/inventory.service');
      const result = await db.transaction(async (trx) => {
        const [updated] = await trx('milling_batches').where({ id })
          .update({ ...priceUpdate, updated_at: trx.fn.now() }).returning('*');
        const realloc = await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, id, { userId: req.user?.id });
        if (realloc && realloc.finishedCostPerKg != null) {
          await trx('milling_batches').where({ id }).update({ finished_price_per_mt: realloc.finishedCostPerKg * 1000 });
        }
        return { updated, realloc };
      });

      return res.json({ success: true, data: { batch: result.updated, reallocation: result.realloc } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================================================================
// Mill Expenses (Overheads: salaries, rent, utilities, etc.)
// =============================================================================

// Mill expenses are stored in the unified `business_expenses` table with
// expense_type='mill', so they also create payables + journal entries via
// expensesService.create — visible on the main Finance dashboard, Money
// Out tab, and Accounting ledger. The legacy `mill_expenses` table is
// no longer written to. (mill_expenses was empty at the time of the cut-over.)
const expensesService = require('../expenses/expenses.service');
const automationService = require('../admin/automation.service');

router.get('/expenses', authorize('milling', 'view'), async (req, res) => {
  try {
    const { limit = 100, period } = req.query;
    let query = db('business_expenses as e')
      .where('e.expense_type', 'mill')
      .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
      .select(
        'e.id', 'e.expense_no', 'e.category', 'e.subcategory', 'e.description',
        db.raw('e.amount_pkr as amount'),
        'e.expense_date',
        'e.invoice_reference as reference',
        'e.payment_method',
        'e.payment_status',
        'e.vendor_name', 'e.is_recurring', 'e.recurrence', 'e.employee_id',
        'e.notes', 'e.created_at', 'e.created_by',
        db.raw("TO_CHAR(e.expense_date, 'YYYY-MM') as period"),
        's.name as supplier_name', 'w.name as employee_name'
      )
      .leftJoin('mill_workers as w', 'w.id', 'e.employee_id')
      // Newest first; created_at tie-breaks rows on the same date so the
      // most recently-saved bill is always at the top.
      .orderBy('e.expense_date', 'desc')
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(parseInt(limit));
    if (period) query = query.whereRaw("TO_CHAR(e.expense_date, 'YYYY-MM') = ?", [period]);
    const expenses = await query;
    const summary = await db('business_expenses')
      .where('expense_type', 'mill')
      .select('category')
      .sum('amount_pkr as total')
      .groupBy('category')
      .orderBy('total', 'desc');
    return res.json({ success: true, data: { expenses, summary } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/expenses', authorize('milling', 'create'),
  auditAction('create', 'mill_expense', (req, data) => data.data?.expense?.id),
  async (req, res) => {
    try {
      const { category, subcategory, description, amount, expense_date, payment_method, reference, notes, supplier_id, vendor_name, pay_now, bank_account_id, employee_id, is_recurring, recurrence } = req.body;
      if (!category || !amount || !expense_date) {
        return res.status(400).json({ success: false, message: 'category, amount, and expense_date are required.' });
      }

      // Payroll-run idempotency: when the Mill Finance "Post Payroll Run"
      // action fires, it pre-fills description='Mill payroll for YYYY-MM'.
      // Block a second post for the same month to avoid double-counting
      // salaries. User can override by editing the description.
      const payrollMatch = category === 'salaries' && /^Mill payroll for (\d{4}-\d{2})/.test(description || '');
      if (payrollMatch) {
        const m = description.match(/^Mill payroll for (\d{4}-\d{2})/);
        const month = m[1];
        const dup = await db('business_expenses')
          .where('expense_type', 'mill')
          .where('category', 'salaries')
          .where('description', 'like', `Mill payroll for ${month}%`)
          .first('expense_no');
        if (dup) {
          return res.status(409).json({
            success: false,
            message: `Mill payroll for ${month} has already been posted as ${dup.expense_no}. Edit the description (e.g. "Mill payroll for ${month} — correction") if you need to post an additional run.`,
          });
        }
      }

      const expense = await expensesService.create({
        expense_type: 'mill',
        category,
        subcategory: subcategory || null,
        amount: parseFloat(amount),
        currency: 'PKR',
        expense_date,
        description: description || null,
        notes: notes || null,
        invoice_reference: reference || null,
        supplier_id: supplier_id || null,
        vendor_name: vendor_name || null,
        employee_id: employee_id || null,
        is_recurring: !!is_recurring,
        recurrence: recurrence || null,
        pay_now: !!pay_now,
        bank_account_id: bank_account_id || null,
        payment_method: payment_method || null,
        payment_reference: reference || null,
      }, req.user?.id);
      return res.json({ success: true, data: { expense } });
    } catch (err) {
      console.error('Mill expense create error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================================================================
// Recurring expenses — a recurring business_expense is a template; the next
// occurrence is due at last_date + cadence. The Recurring tab lists each series
// with its next-due date and lets you materialize (post) the due ones.
// =============================================================================
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
function addInterval(dateStr, recurrence) {
  const dt = new Date(`${isoDate(dateStr)}T00:00:00Z`);
  if (recurrence === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (recurrence === 'quarterly') dt.setUTCMonth(dt.getUTCMonth() + 3);
  else if (recurrence === 'yearly') dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else dt.setUTCMonth(dt.getUTCMonth() + 1); // monthly (default)
  return dt.toISOString().slice(0, 10);
}
const seriesKey = (e) => `${e.category}|${e.employee_id || e.vendor_name || ''}|${e.recurrence || 'monthly'}`;

router.get('/expenses/recurring', authorize('milling', 'view'), async (req, res) => {
  try {
    const rows = await db('business_expenses as e')
      .leftJoin('mill_workers as w', 'w.id', 'e.employee_id')
      .where('e.expense_type', 'mill').where('e.is_recurring', true)
      .select('e.id', 'e.expense_no', 'e.category', 'e.subcategory', 'e.vendor_name', 'e.employee_id',
        'w.name as employee_name', 'e.recurrence', db.raw('e.amount_pkr as amount'), 'e.expense_date', 'e.description')
      .orderBy('e.expense_date', 'desc');
    // Latest occurrence per series (rows are date-desc, so first seen wins).
    const latest = {}; const counts = {};
    for (const e of rows) {
      const k = seriesKey(e);
      counts[k] = (counts[k] || 0) + 1;
      if (!latest[k]) latest[k] = e;
    }
    const today = new Date().toISOString().slice(0, 10);
    const recurring = Object.entries(latest).map(([k, e]) => {
      const nextDue = addInterval(e.expense_date, e.recurrence);
      return {
        ...e, last_date: isoDate(e.expense_date), next_due: nextDue,
        due: nextDue <= today, occurrences: counts[k],
        payee: e.employee_name || e.vendor_name || null,
      };
    }).sort((a, b) => (a.next_due < b.next_due ? -1 : 1));
    return res.json({ success: true, data: { recurring, dueCount: recurring.filter((r) => r.due).length } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Auto-post EVERY due recurring series in one shot (the same routine the hourly
// scheduler runs). Lets the user trigger the catch-up on demand from the UI.
router.post('/expenses/recurring/run-due', authorize('milling', 'create'), async (req, res) => {
  try {
    const result = await automationService.materializeDueRecurringExpenses();
    return res.json({ success: true, data: result });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Materialize the next occurrence of a recurring series (the :id is its latest
// occurrence / template). Copies its fields with expense_date = next due date.
router.post('/expenses/recurring/:id/materialize', authorize('milling', 'create'), async (req, res) => {
  try {
    const tmpl = await db('business_expenses').where('id', req.params.id).where('expense_type', 'mill').first();
    if (!tmpl) return res.status(404).json({ success: false, message: 'Recurring expense not found.' });
    if (!tmpl.is_recurring) return res.status(400).json({ success: false, message: 'That expense is not recurring.' });
    const nextDue = addInterval(tmpl.expense_date, tmpl.recurrence);
    const expense = await expensesService.create({
      expense_type: 'mill', category: tmpl.category, subcategory: tmpl.subcategory,
      amount: parseFloat(tmpl.amount), currency: 'PKR', expense_date: nextDue,
      description: tmpl.description || null, vendor_name: tmpl.vendor_name || null,
      supplier_id: tmpl.supplier_id || null, employee_id: tmpl.employee_id || null,
      is_recurring: true, recurrence: tmpl.recurrence,
      notes: `Recurring (${tmpl.recurrence}) from ${tmpl.expense_no}`,
      pay_now: !!req.body.pay_now, bank_account_id: req.body.bank_account_id || null,
      payment_method: req.body.payment_method || null, payment_reference: req.body.reference || null,
    }, req.user?.id);
    return res.json({ success: true, data: { expense, next_due: nextDue } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// =============================================================================
// Mill Workers & Payroll
// =============================================================================

// Each worker carries its outstanding-advance total so the UI can show it and
// the payroll run can net it off. Computed in one grouped query, not N+1.
async function attachAdvances(workers) {
  const ids = workers.map((w) => w.id);
  if (!ids.length) return workers;
  const rows = await db('mill_worker_advances')
    .whereIn('worker_id', ids).where('status', 'outstanding')
    .groupBy('worker_id')
    .select('worker_id', db.raw('COALESCE(SUM(amount - recovered_amount), 0) as outstanding'));
  const map = new Map(rows.map((r) => [r.worker_id, parseFloat(r.outstanding) || 0]));
  return workers.map((w) => ({ ...w, advance_outstanding: map.get(w.id) || 0 }));
}

router.get('/workers', authorize('milling', 'view'), async (req, res) => {
  try {
    const workers = await db('mill_workers').orderBy('is_active', 'desc').orderBy('name');
    return res.json({ success: true, data: { workers: await attachAdvances(workers) } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// pay_type 'monthly' needs monthly_salary; 'daily' needs daily_wage. We always
// store a daily_wage (derived from salary/26 for monthly staff) so overtime and
// any day-based math keep working regardless of pay type.
function normalizeWorkerPay(body) {
  const pay_type = body.pay_type === 'monthly' ? 'monthly' : 'daily';
  const monthly_salary = pay_type === 'monthly' ? parseFloat(body.monthly_salary) : null;
  let daily_wage = body.daily_wage != null && body.daily_wage !== '' ? parseFloat(body.daily_wage) : null;
  if (pay_type === 'monthly' && (!daily_wage || Number.isNaN(daily_wage))) {
    daily_wage = monthly_salary ? Math.round((monthly_salary / 26) * 100) / 100 : 0;
  }
  return { pay_type, monthly_salary, daily_wage };
}

router.post('/workers', authorize('milling', 'create'), async (req, res) => {
  try {
    const { name, role, phone, cnic, joined_date, mill_id, notes } = req.body;
    const { pay_type, monthly_salary, daily_wage } = normalizeWorkerPay(req.body);
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
    if (pay_type === 'monthly' && !(monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
    if (pay_type === 'daily' && !(daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
    const [worker] = await db('mill_workers').insert({
      name, role: role || 'laborer', pay_type, monthly_salary, daily_wage,
      phone: phone || null, cnic: cnic || null,
      joined_date: joined_date || new Date().toISOString().split('T')[0],
      mill_id: mill_id || null, notes: notes || null,
    }).returning('*');
    return res.json({ success: true, data: { worker } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Edit a worker — pay type/rate, contact, or activate/deactivate. Deactivating
// (is_active=false) keeps all history but drops them from the active payroll run.
router.put('/workers/:id', authorize('milling', 'edit'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const updates = {};
    for (const f of ['name', 'role', 'phone', 'cnic', 'joined_date', 'notes']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    if (req.body.is_active !== undefined) updates.is_active = !!req.body.is_active;
    if (req.body.pay_type !== undefined || req.body.daily_wage !== undefined || req.body.monthly_salary !== undefined) {
      const pay = normalizeWorkerPay({ ...worker, ...req.body });
      if (pay.pay_type === 'monthly' && !(pay.monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
      if (pay.pay_type === 'daily' && !(pay.daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
      Object.assign(updates, pay);
    }
    updates.updated_at = db.fn.now();
    const [updated] = await db('mill_workers').where('id', req.params.id).update(updates).returning('*');
    return res.json({ success: true, data: { worker: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Fully unwind a salary-advance cash-out (the business_expense it created, its
// payable, payment, bank movement and GL journals) — danger-zone hard-delete
// style, so deleting an advance or its worker leaves no orphan money behind.
async function unwindAdvanceExpense(trx, expenseId) {
  if (!expenseId) return;
  const exp = await trx('business_expenses').where('id', expenseId).first();
  if (!exp) return;
  const payables = await trx('payables').where({ source_table: 'business_expenses', source_id: expenseId }).select('id');
  const payableIds = payables.map((p) => p.id);
  if (payableIds.length) {
    const pays = await trx('payments').whereIn('linked_payable_id', payableIds).select('id', 'payment_no', 'bank_account_id', 'amount');
    for (const p of pays) {
      if (p.bank_account_id) await trx('bank_accounts').where('id', p.bank_account_id).increment('current_balance', parseFloat(p.amount) || 0);
      await trx('journal_lines').whereIn('journal_id', trx('journal_entries').where('ref_no', p.payment_no).select('id')).del();
      await trx('journal_entries').where('ref_no', p.payment_no).del();
    }
    await trx('payments').whereIn('linked_payable_id', payableIds).del();
    await trx('payables').whereIn('id', payableIds).del();
  }
  await trx('journal_lines').whereIn('journal_id', trx('journal_entries').where('ref_no', exp.expense_no).select('id')).del();
  await trx('journal_entries').where('ref_no', exp.expense_no).del();
  await trx('business_expenses').where('id', expenseId).del();
}

// Delete a worker permanently — unwinds every advance's cash-out, then cascades
// attendance + advances (FK onDelete CASCADE) and removes the worker.
router.delete('/workers/:id', authorize('milling', 'delete'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    await db.transaction(async (trx) => {
      const advances = await trx('mill_worker_advances').where('worker_id', worker.id).select('expense_id');
      for (const a of advances) await unwindAdvanceExpense(trx, a.expense_id);
      await trx('mill_workers').where('id', worker.id).del(); // attendance + advances cascade
    });
    return res.json({ success: true, data: { deleted: worker.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// List a worker's advances (most recent first).
router.get('/workers/:id/advances', authorize('milling', 'view'), async (req, res) => {
  try {
    const advances = await db('mill_worker_advances').where('worker_id', req.params.id).orderBy('advance_date', 'desc').orderBy('id', 'desc');
    return res.json({ success: true, data: { advances } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Record a salary advance: real cash-out (business_expense, category 'salaries',
// paid now → Money Out / GL) PLUS a tracked advance row that nets off payroll.
router.post('/workers/:id/advances', authorize('milling', 'create'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'A positive advance amount is required.' });
    const advance_date = req.body.advance_date || new Date().toISOString().split('T')[0];
    const expense = await expensesService.create({
      expense_type: 'mill', category: 'salaries', amount, currency: 'PKR',
      expense_date: advance_date,
      description: `Salary advance — ${worker.name}`,
      notes: req.body.notes || null,
      vendor_name: worker.name,
      pay_now: true,
      bank_account_id: req.body.bank_account_id || null,
      payment_method: req.body.payment_method || 'cash',
      payment_reference: req.body.payment_reference || null,
    }, req.user?.id);
    const [advance] = await db('mill_worker_advances').insert({
      worker_id: worker.id, advance_date, amount,
      recovered_amount: 0, status: 'outstanding',
      expense_id: expense?.id || null,
      notes: req.body.notes || null,
      created_by: req.user?.id || null,
    }).returning('*');
    return res.json({ success: true, data: { advance } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Delete an advance — unwinds its cash-out and removes the record.
router.delete('/advances/:id', authorize('milling', 'delete'), async (req, res) => {
  try {
    const advance = await db('mill_worker_advances').where('id', req.params.id).first();
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });
    await db.transaction(async (trx) => {
      await unwindAdvanceExpense(trx, advance.expense_id);
      await trx('mill_worker_advances').where('id', advance.id).del();
    });
    return res.json({ success: true, data: { deleted: advance.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/attendance', authorize('milling', 'view'), async (req, res) => {
  try {
    const { month, worker_id } = req.query;
    let query = db('mill_attendance as a')
      .leftJoin('mill_workers as w', 'a.worker_id', 'w.id')
      .select('a.*', 'w.name as worker_name', 'w.daily_wage')
      .orderBy('a.date', 'desc');
    // Match the calendar month directly — `${month}-32` is an invalid date and
    // Postgres throws "date/time field value out of range".
    if (month) query = query.whereRaw("TO_CHAR(a.date, 'YYYY-MM') = ?", [month]);
    if (worker_id) query = query.where('a.worker_id', worker_id);
    const records = await query.limit(500);
    return res.json({ success: true, data: { attendance: records } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

const VALID_ATTENDANCE = ['present', 'absent', 'half_day', 'leave', 'off'];
const attHours = (status) => (status === 'half_day' ? 4 : status === 'present' ? 8 : 0);

router.post('/attendance', authorize('milling', 'create'), async (req, res) => {
  try {
    const { worker_id, date, status, hours_worked, overtime_hours, notes } = req.body;
    if (!worker_id || !date) return res.status(400).json({ success: false, message: 'worker_id and date required.' });
    if (status && !VALID_ATTENDANCE.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_ATTENDANCE.join(', ')}.` });
    }
    const [record] = await db('mill_attendance').insert({
      worker_id, date, status: status || 'present',
      hours_worked: hours_worked ?? attHours(status || 'present'), overtime_hours: overtime_hours || 0,
      notes: notes || null,
    }).returning('*').onConflict(['worker_id', 'date']).merge();
    return res.json({ success: true, data: { attendance: record } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Bulk attendance — set many (worker, date) cells at once (Sundays off, holidays,
// company-wide leave, a range). status 'clear' deletes the cell. One transaction.
router.post('/attendance/bulk', authorize('milling', 'create'), async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || !records.length) return res.status(400).json({ success: false, message: 'records[] required.' });
    let applied = 0;
    await db.transaction(async (trx) => {
      for (const r of records) {
        if (!r.worker_id || !r.date) continue;
        if (r.status === 'clear' || r.status === null) {
          await trx('mill_attendance').where({ worker_id: r.worker_id, date: r.date }).del();
          applied += 1;
        } else if (VALID_ATTENDANCE.includes(r.status)) {
          await trx('mill_attendance').insert({
            worker_id: r.worker_id, date: r.date, status: r.status,
            hours_worked: attHours(r.status), overtime_hours: 0,
          }).onConflict(['worker_id', 'date']).merge();
          applied += 1;
        }
      }
    });
    return res.json({ success: true, data: { applied } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Pakistan federal (gazetted) public holidays for a year. Fixed-date holidays are
// exact; the Islamic ones depend on moon-sighting so they're flagged approximate
// and the supervisor confirms before applying. (No live AI/API is wired in the
// backend — this is a baked-in calendar; it can be swapped for an AI/API source
// later by setting an API key and replacing this helper.)
function pakistanFederalHolidays(year) {
  const fixed = [
    [`${year}-02-05`, 'Kashmir Solidarity Day'],
    [`${year}-03-23`, 'Pakistan Day'],
    [`${year}-05-01`, 'Labour Day'],
    [`${year}-08-14`, 'Independence Day'],
    [`${year}-11-09`, 'Iqbal Day'],
    [`${year}-12-25`, 'Quaid-e-Azam Day / Christmas'],
  ].map(([date, name]) => ({ date, name, approximate: false }));
  // Government-announced Islamic holidays (moon-sighting → approximate).
  const islamic = {
    2025: [
      ['2025-03-31', 'Eid-ul-Fitr'], ['2025-04-01', 'Eid-ul-Fitr'], ['2025-04-02', 'Eid-ul-Fitr'],
      ['2025-06-07', 'Eid-ul-Azha'], ['2025-06-08', 'Eid-ul-Azha'], ['2025-06-09', 'Eid-ul-Azha'],
      ['2025-07-05', 'Ashura (9 Muharram)'], ['2025-07-06', 'Ashura (10 Muharram)'],
      ['2025-09-05', 'Eid Milad-un-Nabi'],
    ],
    2026: [
      ['2026-03-20', 'Eid-ul-Fitr'], ['2026-03-21', 'Eid-ul-Fitr'], ['2026-03-22', 'Eid-ul-Fitr'],
      ['2026-05-27', 'Eid-ul-Azha'], ['2026-05-28', 'Eid-ul-Azha'], ['2026-05-29', 'Eid-ul-Azha'],
      ['2026-06-25', 'Ashura (9 Muharram)'], ['2026-06-26', 'Ashura (10 Muharram)'],
      ['2026-08-25', 'Eid Milad-un-Nabi'],
    ],
    2027: [
      ['2027-03-10', 'Eid-ul-Fitr'], ['2027-03-11', 'Eid-ul-Fitr'], ['2027-03-12', 'Eid-ul-Fitr'],
      ['2027-05-17', 'Eid-ul-Azha'], ['2027-05-18', 'Eid-ul-Azha'], ['2027-05-19', 'Eid-ul-Azha'],
      ['2027-06-15', 'Ashura (9 Muharram)'], ['2027-06-16', 'Ashura (10 Muharram)'],
      ['2027-08-15', 'Eid Milad-un-Nabi'],
    ],
  };
  const isl = (islamic[year] || []).map(([date, name]) => ({ date, name, approximate: true }));
  return [...fixed, ...isl].sort((a, b) => a.date.localeCompare(b.date));
}

router.get('/attendance/holidays', authorize('milling', 'view'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ success: false, message: 'month (YYYY-MM) required.' });
    // Baked-in calendar is the reliable default and the fallback.
    let holidays = pakistanFederalHolidays(Number(month.slice(0, 4))).filter((h) => h.date.slice(0, 7) === month);
    let source = 'calendar';
    // If an AI key is configured, ask the model for that month's Pakistan federal
    // holidays (more current for moon-sighting dates). Validate hard; any problem
    // silently falls back to the calendar so attendance never breaks.
    if (aiService.enabled()) {
      try {
        const out = await aiService.complete({
          system: 'You are a precise calendar assistant for Pakistan. Reply with JSON only.',
          prompt: `List the official Pakistan FEDERAL public (gazetted) holidays that fall in the month ${month} (format YYYY-MM). `
            + `Return JSON: {"holidays":[{"date":"YYYY-MM-DD","name":"string","approximate":boolean}]}. `
            + `Set "approximate": true for Islamic/moon-sighting holidays (Eid, Ashura, Eid Milad-un-Nabi), false for fixed-date ones. `
            + `Only include dates within ${month}. If none, return an empty array.`,
          json: true,
        });
        const aiH = (out?.holidays || [])
          .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h?.date) && h.date.slice(0, 7) === month && h?.name)
          .map((h) => ({ date: h.date, name: String(h.name).slice(0, 80), approximate: !!h.approximate }));
        if (aiH.length) { holidays = aiH; source = 'ai'; }
      } catch (e) {
        console.warn('AI holidays failed, using calendar:', e.message);
      }
    }
    return res.json({ success: true, data: { holidays, source, aiEnabled: aiService.enabled() } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Compute the month's payroll for every ACTIVE employee — the single source of
// truth shared by GET /payroll/summary and POST /payroll/run (so a run can never
// post a figure that disagrees with what the screen showed).
async function computePayrollSummary(month) {
  const startDate = month ? `${month}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  // Last day of the month — `${month}-31` is an invalid date for 30-day months
  // and February. Date.UTC(year, monthNum, 0) rolls back to the month's last day.
  const endDate = month
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const workers = await db('mill_workers').where('is_active', true).orderBy('name');
  const attendance = await db('mill_attendance')
    .where('date', '>=', startDate).where('date', '<=', endDate);
  // Outstanding advances net off net pay (the cash already went out when given).
  const advRows = workers.length ? await db('mill_worker_advances')
    .whereIn('worker_id', workers.map((w) => w.id)).where('status', 'outstanding')
    .groupBy('worker_id')
    .select('worker_id', db.raw('COALESCE(SUM(amount - recovered_amount), 0) as outstanding')) : [];
  const advMap = new Map(advRows.map((r) => [r.worker_id, parseFloat(r.outstanding) || 0]));

  const summary = workers.map(w => {
    const records = attendance.filter(a => a.worker_id === w.id);
    const daysPresent = records.filter(a => a.status === 'present').length;
    const halfDays = records.filter(a => a.status === 'half_day').length;
    const totalOT = records.reduce((s, a) => s + (parseFloat(a.overtime_hours) || 0), 0);
    const effectiveDays = daysPresent + (halfDays * 0.5);
    const dailyWage = parseFloat(w.daily_wage) || 0;
    // Salaried staff earn their flat monthly figure; daily-wage staff earn per
    // effective day worked. Overtime (if logged) pays 1.5× the daily hourly rate.
    const basicPay = w.pay_type === 'monthly'
      ? (parseFloat(w.monthly_salary) || 0)
      : effectiveDays * dailyWage;
    const otPay = totalOT * (dailyWage / 8 * 1.5);
    const gross = basicPay + otPay;
    const advanceOutstanding = advMap.get(w.id) || 0;
    // Recover advances against this run's gross, but never below zero.
    const advanceDeduction = Math.min(advanceOutstanding, gross);
    return {
      ...w, daysPresent, halfDays, effectiveDays, totalOT,
      basicPay: Math.round(basicPay), otPay: Math.round(otPay),
      grossPay: Math.round(gross),
      advanceOutstanding: Math.round(advanceOutstanding),
      advanceDeduction: Math.round(advanceDeduction),
      netPay: Math.round(gross - advanceDeduction),
      totalPay: Math.round(gross - advanceDeduction), // back-compat alias
    };
  });

  const grandGross = summary.reduce((s, w) => s + w.grossPay, 0);
  const grandAdvance = summary.reduce((s, w) => s + w.advanceDeduction, 0);
  const grandTotal = summary.reduce((s, w) => s + w.netPay, 0);
  return { summary, grandGross, grandAdvance, grandTotal, period: { startDate, endDate } };
}

// Apply `amount` of recovery to a worker's outstanding advances, oldest first —
// so a posted payroll run closes out the advances it deducted (otherwise the
// same advance would be deducted again every following month).
async function recoverAdvancesForWorker(trx, workerId, amount) {
  let remaining = parseFloat(amount) || 0;
  if (remaining <= 0) return;
  const advs = await trx('mill_worker_advances')
    .where({ worker_id: workerId, status: 'outstanding' })
    .orderBy('advance_date', 'asc').orderBy('id', 'asc');
  for (const a of advs) {
    if (remaining <= 0) break;
    const out = (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0);
    const applied = Math.min(out, remaining);
    const newRecovered = (parseFloat(a.recovered_amount) || 0) + applied;
    await trx('mill_worker_advances').where('id', a.id).update({
      recovered_amount: newRecovered,
      status: newRecovered >= (parseFloat(a.amount) || 0) - 0.01 ? 'recovered' : 'outstanding',
      updated_at: trx.fn.now(),
    });
    remaining -= applied;
  }
}

// Reverse `amount` of recovery (when a run is deleted) — newest recovery first.
async function unrecoverAdvancesForWorker(trx, workerId, amount) {
  let remaining = parseFloat(amount) || 0;
  if (remaining <= 0) return;
  const advs = await trx('mill_worker_advances')
    .where('worker_id', workerId).where('recovered_amount', '>', 0)
    .orderBy('advance_date', 'desc').orderBy('id', 'desc');
  for (const a of advs) {
    if (remaining <= 0) break;
    const rec = parseFloat(a.recovered_amount) || 0;
    const applied = Math.min(rec, remaining);
    const newRec = rec - applied;
    await trx('mill_worker_advances').where('id', a.id).update({
      recovered_amount: newRec,
      status: newRec >= (parseFloat(a.amount) || 0) - 0.01 ? 'recovered' : 'outstanding',
      updated_at: trx.fn.now(),
    });
    remaining -= applied;
  }
}

// Employees already paid in a posted run for this period (so a second run can't
// pay them again, and the UI can show a Paid badge).
async function paidWorkerIdsForPeriod(month) {
  const rows = await db('mill_payroll_lines as pl')
    .join('mill_payroll_runs as r', 'pl.run_id', 'r.id')
    .where('r.period', month).whereNotNull('pl.worker_id')
    .distinct('pl.worker_id').select('pl.worker_id');
  return new Set(rows.map((r) => r.worker_id));
}

router.get('/payroll/summary', authorize('milling', 'view'), async (req, res) => {
  try {
    const data = await computePayrollSummary(req.query.month);
    const paid = await paidWorkerIdsForPeriod(req.query.month);
    data.summary = data.summary.map((w) => ({ ...w, paid: paid.has(w.id) }));
    // Net still owed = only employees not yet paid this period.
    data.unpaidNet = data.summary.filter((w) => !w.paid).reduce((s, w) => s + w.netPay, 0);
    data.paidCount = data.summary.filter((w) => w.paid).length;
    return res.json({ success: true, data });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// List posted payroll runs (history) + the linked expense's bank.
router.get('/payroll/runs', authorize('milling', 'view'), async (req, res) => {
  try {
    const runs = await db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .select('r.*', 'ba.name as bank_name')
      .orderBy('r.period', 'desc');
    return res.json({ success: true, data: { runs } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Payroll report — every run (optionally within a from..to period range) with
// its payslip lines nested, plus grand totals. One pass over runs + lines.
router.get('/payroll/report', authorize('milling', 'view'), async (req, res) => {
  try {
    const { from, to } = req.query;
    let q = db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .select('r.*', 'ba.name as bank_name')
      .orderBy('r.period', 'desc').orderBy('r.id', 'desc');
    if (from) q = q.where('r.period', '>=', from);
    if (to) q = q.where('r.period', '<=', to);
    const runs = await q;
    const runIds = runs.map((r) => r.id);
    const lines = runIds.length
      ? await db('mill_payroll_lines').whereIn('run_id', runIds).orderBy('worker_name')
      : [];
    const byRun = {};
    for (const l of lines) (byRun[l.run_id] = byRun[l.run_id] || []).push(l);
    const withLines = runs.map((r) => ({ ...r, lines: byRun[r.id] || [] }));
    const totals = {
      runs: runs.length,
      employees: lines.length,
      grossTotal: runs.reduce((s, r) => s + parseFloat(r.gross_total || 0), 0),
      advanceTotal: runs.reduce((s, r) => s + parseFloat(r.advance_total || 0), 0),
      netTotal: runs.reduce((s, r) => s + parseFloat(r.net_total || 0), 0),
    };
    return res.json({ success: true, data: { runs: withLines, totals } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// A single run with its per-employee payslip lines.
router.get('/payroll/runs/:id', authorize('milling', 'view'), async (req, res) => {
  try {
    const run = await db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .select('r.*', 'ba.name as bank_name')
      .where('r.id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    const lines = await db('mill_payroll_lines').where('run_id', run.id).orderBy('worker_name');
    return res.json({ success: true, data: { run, lines } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Post a payroll run: pay SELECTED employees their net salary (cash/bank + GL via
// a paid business_expense), snapshot each one's payslip line, and recover the
// advance each chose to clear. The client may pass per-employee `lines`
// ({worker_id, net_pay, advance_deducted}) to override the computed defaults and
// pick exactly who to pay; with no lines, every not-yet-paid active employee is
// paid at the computed net. The server always recomputes gross/basic from
// attendance, clamps the advance to what's outstanding, and blocks anyone already
// paid this period — so the saved numbers stay trustworthy.
router.post('/payroll/run', authorize('milling', 'create'), async (req, res) => {
  try {
    const { month, pay_method, bank_account_id, pay_date, notes, lines } = req.body;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ success: false, message: 'A valid month (YYYY-MM) is required.' });

    const { summary } = await computePayrollSummary(month);
    const byId = new Map(summary.map((w) => [w.id, w]));
    const alreadyPaid = await paidWorkerIdsForPeriod(month);

    // Resolve which employees to pay + how much.
    let toPay;
    if (Array.isArray(lines) && lines.length) {
      toPay = [];
      for (const ln of lines) {
        const w = byId.get(ln.worker_id);
        if (!w) continue; // not an active employee this month
        if (alreadyPaid.has(w.id)) return res.status(409).json({ success: false, message: `${w.name} has already been paid for ${month}.` });
        const advanceDeducted = Math.max(0, Math.min(parseFloat(ln.advance_deducted) || 0, w.advanceOutstanding));
        const netPay = ln.net_pay != null && ln.net_pay !== ''
          ? Math.max(0, Math.round(parseFloat(ln.net_pay)))
          : Math.max(0, w.grossPay - advanceDeducted);
        toPay.push({ ...w, advanceDeduction: advanceDeducted, netPay });
      }
    } else {
      toPay = summary.filter((w) => !alreadyPaid.has(w.id));
    }
    if (!toPay.length) return res.status(400).json({ success: false, message: 'No employees selected to pay (or everyone is already paid for this month).' });

    const grossTotal = toPay.reduce((s, w) => s + w.grossPay, 0);
    const advanceTotal = toPay.reduce((s, w) => s + w.advanceDeduction, 0);
    const netTotal = toPay.reduce((s, w) => s + w.netPay, 0);

    const method = pay_method === 'bank' ? 'bank' : 'cash';
    const payDate = pay_date || new Date().toISOString().split('T')[0];
    // Cash payments move the Office Petty Cash account if one exists; bank
    // payments use the chosen account.
    let acctId = method === 'bank' ? (bank_account_id || null) : null;
    if (method === 'cash' && !acctId) {
      acctId = (await db('bank_accounts').where('type', 'cash').first('id'))?.id || null;
    }

    // 1) Pay out the net total as a paid salaries expense (cash/bank + GL).
    let expense = null;
    if (netTotal > 0) {
      expense = await expensesService.create({
        expense_type: 'mill', category: 'salaries', amount: netTotal, currency: 'PKR',
        expense_date: payDate,
        description: `Salaries — payroll run ${month}`,
        notes: notes || `Payroll ${month}: ${toPay.length} employee(s) · gross ${grossTotal} · advances ${advanceTotal} · net ${netTotal}`,
        pay_now: true, bank_account_id: acctId,
        payment_method: method,
      }, req.user?.id);
    }

    // 2) Record the run + payslip lines, and recover deducted advances.
    const run = await db.transaction(async (trx) => {
      const [r] = await trx('mill_payroll_runs').insert({
        period: month, pay_date: payDate, pay_method: method, bank_account_id: acctId,
        gross_total: grossTotal, advance_total: advanceTotal, net_total: netTotal,
        employee_count: toPay.length, expense_id: expense?.id || null,
        status: 'posted', notes: notes || null, created_by: req.user?.id || null,
      }).returning('*');
      for (const w of toPay) {
        await trx('mill_payroll_lines').insert({
          run_id: r.id, worker_id: w.id, worker_name: w.name, role: w.role, pay_type: w.pay_type,
          effective_days: w.effectiveDays || 0, ot_hours: w.totalOT || 0,
          basic_pay: w.basicPay, ot_pay: w.otPay, gross_pay: w.grossPay,
          advance_deducted: w.advanceDeduction, net_pay: w.netPay,
        });
        if (w.advanceDeduction > 0) await recoverAdvancesForWorker(trx, w.id, w.advanceDeduction);
      }
      return r;
    });
    return res.json({ success: true, data: { run } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Undo a payroll run — reverse its cash-out (+ GL), restore the advances it
// recovered to outstanding, and delete the run (lines cascade).
router.delete('/payroll/runs/:id', authorize('milling', 'delete'), async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    await db.transaction(async (trx) => {
      const lines = await trx('mill_payroll_lines').where('run_id', run.id);
      for (const l of lines) {
        if (parseFloat(l.advance_deducted) > 0 && l.worker_id) {
          await unrecoverAdvancesForWorker(trx, l.worker_id, l.advance_deducted);
        }
      }
      await unwindAdvanceExpense(trx, run.expense_id); // reverse cash-out + GL
      await trx('mill_payroll_runs').where('id', run.id).del(); // lines cascade
    });
    return res.json({ success: true, data: { deleted: run.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// =============================================================================
// Batch Approval (Owner / Super Admin only)
// =============================================================================
router.put(
  '/batches/:id/approve',
  authorizeRole('Owner', 'Super Admin'),
  auditAction('approve_batch', 'milling_batch', (req) => req.params.id),
  controller.approveBatch
);
router.put(
  '/batches/:id/reject',
  authorizeRole('Owner', 'Super Admin'),
  auditAction('reject_batch', 'milling_batch', (req) => req.params.id),
  controller.rejectBatch
);

// =============================================================================
// Mill Store — Batch Consumption (from millStore module)
// =============================================================================
const consumptionCtrl = require('../millStore/consumption.controller');

router.post(
  '/batches/:id/consumption/suggest',
  authorize('mill_store', 'record_consumption'),
  consumptionCtrl.suggest
);
router.post(
  '/batches/:id/consumption',
  authorize('mill_store', 'record_consumption'),
  auditAction('consume_stock', 'milling_batch', (req) => req.params.id),
  consumptionCtrl.confirm
);
router.get(
  '/batches/:id/consumption',
  authorize('mill_store', 'view'),
  consumptionCtrl.history
);

// =============================================================================
// Mill Store — Batch Packing (bag the finished rice; records bag weight)
// =============================================================================
const packingCtrl = require('../millStore/packing.controller');

router.post(
  '/batches/:id/packing',
  authorize('mill_store', 'record_consumption'),
  auditAction('pack_batch', 'milling_batch', (req) => req.params.id),
  packingCtrl.pack
);
router.get(
  '/batches/:id/packing',
  authorize('mill_store', 'view'),
  packingCtrl.history
);
router.get('/batches/:id/katta', authorize('milling', 'view'), controller.getBatchKatta);

module.exports = router;
