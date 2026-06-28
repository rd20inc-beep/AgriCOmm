const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const controller = require('../../controllers/millingController');
const advancedController = require('../../controllers/millingAdvancedController');
const authorize = require('../../middleware/rbac');
const { authorizeRole } = require('../../middleware/rbac');
// Payroll routes are gated by the dedicated `payroll.*` permission module
// (migration 203). Mill Operator holds no payroll permissions, so the old
// denyRoles('Mill Operator') guard is no longer needed.
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const ownerApproval = require('../../middleware/ownerApproval');
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
const { resolveCashAccountId } = require('../../shared/cashAccounts');
// Shared payroll logic (also used by the scheduler) — compute + prepare.
const payrollService = require('./payroll.service');
const { computePayrollSummary, committedWorkerStatus, preparePayrollRun, nextPrepareDate } = payrollService;

router.get('/expenses', authorize('milling', 'view'), async (req, res) => {
  try {
    const { limit = 100, period } = req.query;
    let query = db('business_expenses as e')
      .where('e.expense_type', 'mill')
      .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
      // The 1:1 payable for this expense (source_table='business_expenses') —
      // lets the UI pay it through the same payable/Money-Out drawer (with the
      // voucher/invoice), and shows live paid/outstanding.
      .leftJoin('payables as pa', function () {
        this.on('pa.source_table', db.raw("'business_expenses'")).andOn('pa.source_id', 'e.id');
      })
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
        's.name as supplier_name', 'w.name as employee_name',
        'pa.id as payable_id', 'pa.pay_no', 'pa.original_amount as payable_original',
        'pa.paid_amount as payable_paid', 'pa.outstanding as payable_outstanding',
        'pa.status as payable_status', 'pa.linked_ref', 'pa.currency as payable_currency',
        'pa.entity as payable_entity', 'pa.supplier_id as payable_supplier_id'
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

      // Per-employee salary: block a second salary for the same worker in the
      // same month — whether the first was a salary expense OR a payroll run.
      if (category === 'salaries' && employee_id) {
        const month = String(expense_date).slice(0, 7);
        const dupExp = await db('business_expenses')
          .where('expense_type', 'mill').where('category', 'salaries').where('employee_id', employee_id)
          .whereRaw("TO_CHAR(expense_date, 'YYYY-MM') = ?", [month]).first('expense_no');
        const runLine = await db('mill_payroll_lines as pl')
          .join('mill_payroll_runs as r', 'r.id', 'pl.run_id')
          .where('r.period', month).where('pl.worker_id', employee_id).first('pl.id');
        if (dupExp || runLine) {
          const w = await db('mill_workers').where('id', employee_id).first('name');
          return res.status(409).json({
            success: false,
            message: `${w?.name || 'This employee'}'s salary for ${month} has already been paid${dupExp ? ` (${dupExp.expense_no})` : ' via a payroll run'}. Edit the existing record instead of paying again.`,
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

router.get('/workers', authorize('payroll', 'view'), async (req, res) => {
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

// ── Advance recovery plan ───────────────────────────────────────────────────
const RECOVERY_METHODS = ['full_next_salary', 'fixed_installment', 'salary_percentage', 'manual'];

// month string (YYYY-MM) helpers
function addMonths(period, n) {
  const y = Number(period.slice(0, 4)); const m = Number(period.slice(5, 7));
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthOf(dateStr) { return String(dateStr || '').slice(0, 7); }

// Normalize the recovery plan from the advance form. Back-compatible default is
// full_next_salary (= reproduce the legacy "deduct next salary" behaviour).
function buildRecoveryPlan(body, amount, advanceDate) {
  let method = RECOVERY_METHODS.includes(body.recovery_method) ? body.recovery_method : 'full_next_salary';
  // Recovery starts the month AFTER the advance unless the admin set a month.
  const defaultStart = addMonths(monthOf(advanceDate) || new Date().toISOString().slice(0, 7), 1);
  let recovery_start_period = /^\d{4}-\d{2}$/.test(body.recovery_start_period || '') ? body.recovery_start_period : defaultStart;
  let installment_amount = body.installment_amount != null && body.installment_amount !== '' ? parseFloat(body.installment_amount) : null;
  let installment_count = body.installment_count != null && body.installment_count !== '' ? parseInt(body.installment_count, 10) : null;
  let deduction_percent = body.deduction_percent != null && body.deduction_percent !== '' ? parseFloat(body.deduction_percent) : null;
  let auto_deduct = body.auto_deduct !== undefined ? !!body.auto_deduct : true;

  if (method === 'fixed_installment') {
    if (!(installment_amount > 0) && installment_count > 0) installment_amount = Math.round((amount / installment_count) * 100) / 100;
    if (!(installment_amount > 0)) throw new Error('Fixed installment recovery needs a positive installment amount.');
    if (!(installment_count > 0)) installment_count = Math.max(1, Math.ceil(amount / installment_amount));
    deduction_percent = null;
  } else if (method === 'salary_percentage') {
    if (!(deduction_percent > 0 && deduction_percent <= 100)) throw new Error('Percentage recovery needs a deduction percent between 0 and 100.');
    installment_amount = null; installment_count = null;
  } else if (method === 'manual') {
    auto_deduct = false; installment_amount = null; installment_count = null; deduction_percent = null; recovery_start_period = null;
  } else { // full_next_salary
    installment_amount = null; installment_count = null; deduction_percent = null; recovery_start_period = null;
  }
  return { recovery_method: method, recovery_start_period, installment_amount, installment_count, deduction_percent, auto_deduct };
}

// Pre-generate the planned installment rows for a fixed_installment advance so
// the admin can see exactly which month recovers which amount. The last row
// carries any rounding remainder so the rows sum to the advance amount.
function plannedScheduleRows(advance) {
  if (advance.recovery_method !== 'fixed_installment') return [];
  const amount = parseFloat(advance.amount) || 0;
  const inst = parseFloat(advance.installment_amount) || 0;
  const count = parseInt(advance.installment_count, 10) || (inst > 0 ? Math.ceil(amount / inst) : 1);
  const rows = []; let remaining = amount; let period = advance.recovery_start_period || addMonths(monthOf(advance.advance_date), 1);
  for (let i = 0; i < count && remaining > 0.001; i += 1) {
    const sched = i === count - 1 ? remaining : Math.min(inst, remaining);
    rows.push({ advance_id: advance.id, worker_id: advance.worker_id, period, scheduled_amount: Math.round(sched * 100) / 100, status: 'pending' });
    remaining = Math.round((remaining - sched) * 100) / 100;
    period = addMonths(period, 1);
  }
  return rows;
}

router.post('/workers', authorize('payroll', 'create'), async (req, res) => {
  try {
    const { name, role, phone, cnic, joined_date, mill_id, notes } = req.body;
    const { pay_type, monthly_salary, daily_wage } = normalizeWorkerPay(req.body);
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
    if (pay_type === 'monthly' && !(monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
    if (pay_type === 'daily' && !(daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
    const ot_rate_per_hour = req.body.ot_rate_per_hour != null && req.body.ot_rate_per_hour !== '' ? parseFloat(req.body.ot_rate_per_hour) : null;
    const [worker] = await db('mill_workers').insert({
      name, role: role || 'laborer', pay_type, monthly_salary, daily_wage,
      ot_rate_per_hour: ot_rate_per_hour > 0 ? ot_rate_per_hour : null,
      phone: phone || null, cnic: cnic || null,
      joined_date: joined_date || new Date().toISOString().split('T')[0],
      mill_id: mill_id || null, notes: notes || null,
    }).returning('*');
    return res.json({ success: true, data: { worker } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Edit a worker — pay type/rate, contact, or activate/deactivate. Deactivating
// (is_active=false) keeps all history but drops them from the active payroll run.
router.put('/workers/:id', authorize('payroll', 'edit'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const updates = {};
    for (const f of ['name', 'role', 'phone', 'cnic', 'joined_date', 'notes']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    if (req.body.ot_rate_per_hour !== undefined) {
      const v = req.body.ot_rate_per_hour !== '' ? parseFloat(req.body.ot_rate_per_hour) : null;
      updates.ot_rate_per_hour = v > 0 ? v : null;
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
router.delete('/workers/:id', authorize('payroll', 'delete'), async (req, res) => {
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
router.get('/workers/:id/advances', authorize('payroll', 'view'), async (req, res) => {
  try {
    const advances = await db('mill_worker_advances').where('worker_id', req.params.id).orderBy('advance_date', 'desc').orderBy('id', 'desc');
    return res.json({ success: true, data: { advances } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Per-employee LEDGER — every amount given to a worker, across:
//   • salary advances (mill_worker_advances)
//   • payroll net pay (mill_payroll_lines → run.pay_date)
//   • any other salary disbursement booked directly against them
//     (business_expenses.employee_id, excluding the advances' own cash-outs so
//      they aren't double-counted).
router.get('/workers/:id/ledger', authorize('payroll', 'view'), async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    const worker = await db('mill_workers').where('id', workerId).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const advances = await db('mill_worker_advances').where('worker_id', workerId)
      .select('id', 'advance_date', 'amount', 'recovered_amount', 'status', 'expense_id', 'notes');
    const advanceExpenseIds = advances.map((a) => a.expense_id).filter(Boolean);

    const payLines = await db('mill_payroll_lines as l')
      .join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where('l.worker_id', workerId)
      .select('l.id', 'r.period', 'r.pay_date', 'r.pay_method', 'l.gross_pay', 'l.advance_deducted', 'l.net_pay');

    let otherExpQ = db('business_expenses').where('employee_id', workerId);
    if (advanceExpenseIds.length) otherExpQ = otherExpQ.whereNotIn('id', advanceExpenseIds);
    const otherExp = await otherExpQ.select('id', 'expense_no', 'expense_date', 'amount', 'amount_pkr', 'description', 'category');

    // Double-entry employee ledger from the COMPANY's view of net liability to
    // the worker. credit = we owe them (salary earned); debit = we paid them
    // (advance given, salary paid). Running balance > 0 → salary still payable;
    // balance < 0 → worker owes us (outstanding advance not yet recovered).
    const raw = [
      ...advances.map((a) => ({
        date: a.advance_date, ord: 1, type: 'advance', label: 'Advance given',
        reference: a.expense_id ? `ADV-${a.id}` : null, note: a.notes || null,
        debit: parseFloat(a.amount) || 0, credit: 0,
        // legacy alias kept so older UI keeps rendering
        amount: parseFloat(a.amount) || 0, status: a.status, recovered: parseFloat(a.recovered_amount) || 0,
      })),
      ...payLines.flatMap((p) => {
        const gross = parseFloat(p.gross_pay) || 0; const net = parseFloat(p.net_pay) || 0; const adv = parseFloat(p.advance_deducted) || 0;
        return [
          { date: p.pay_date, ord: 0, type: 'salary_earned', label: `Salary earned ${p.period}`, reference: p.period, debit: 0, credit: gross, amount: gross, note: 'Gross salary' },
          { date: p.pay_date, ord: 2, type: 'salary_paid', label: `Salary paid ${p.period}`, reference: p.period, debit: net, credit: 0, amount: net, note: `${adv > 0 ? `incl. advance recovered ${Math.round(adv).toLocaleString()} · ` : ''}via ${p.pay_method || 'cash'}` },
        ];
      }),
      ...otherExp.map((e) => ({
        date: e.expense_date, ord: 1, type: 'other', label: e.description || 'Disbursement',
        reference: e.expense_no, note: e.category, debit: parseFloat(e.amount_pkr) || parseFloat(e.amount) || 0, credit: 0,
        amount: parseFloat(e.amount_pkr) || parseFloat(e.amount) || 0,
      })),
    ].sort((a, b) => (new Date(a.date) - new Date(b.date)) || (a.ord - b.ord));

    let bal = 0;
    const entries = raw.map((e) => { bal += (e.credit || 0) - (e.debit || 0); return { ...e, balance: Math.round(bal) }; });

    const summary = {
      salaryEarned: Math.round(payLines.reduce((s, p) => s + (parseFloat(p.gross_pay) || 0), 0)),
      advancesTaken: Math.round(advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0)),
      advanceDeducted: Math.round(payLines.reduce((s, p) => s + (parseFloat(p.advance_deducted) || 0), 0)),
      salaryPaid: Math.round(payLines.reduce((s, p) => s + (parseFloat(p.net_pay) || 0), 0)),
      advanceOutstanding: Math.round(advances.reduce((s, a) => s + Math.max(0, (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0)), 0)),
      currentBalance: Math.round(bal),
    };
    // entries displayed newest-first; balance already computed chronologically
    const displayEntries = [...entries].reverse();

    return res.json({ success: true, data: { worker, entries: displayEntries, summary, total: summary.salaryPaid, advanceOutstanding: summary.advanceOutstanding, currentBalance: summary.currentBalance, count: entries.length } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Record a salary advance: real cash-out (business_expense, category 'salaries',
// paid now → Money Out / GL) PLUS a tracked advance row that nets off payroll.
router.post('/workers/:id/advances', authorize('payroll', 'create'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'A positive advance amount is required.' });
    const advance_date = req.body.advance_date || new Date().toISOString().split('T')[0];
    let plan;
    try { plan = buildRecoveryPlan(req.body, amount, advance_date); }
    catch (e) { return res.status(400).json({ success: false, message: e.message }); }

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

    const advance = await db.transaction(async (trx) => {
      const [a] = await trx('mill_worker_advances').insert({
        worker_id: worker.id, advance_date, amount,
        recovered_amount: 0, status: 'outstanding',
        expense_id: expense?.id || null,
        notes: req.body.notes || null,
        created_by: req.user?.id || null,
        ...plan,
      }).returning('*');
      const rows = plannedScheduleRows(a);
      if (rows.length) await trx('mill_worker_advance_recovery_schedule').insert(rows);
      return a;
    });
    return res.json({ success: true, data: { advance } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Advance ledger — one advance, its recovery plan, its schedule rows and a
// debit/credit transaction view (advance given = debit; each recovery = credit).
router.get('/advances/:id/ledger', authorize('payroll', 'view'), async (req, res) => {
  try {
    const advance = await db('mill_worker_advances as a')
      .leftJoin('mill_workers as w', 'w.id', 'a.worker_id')
      .where('a.id', req.params.id)
      .select('a.*', 'w.name as worker_name', 'w.role as worker_role').first();
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });
    const schedule = await db('mill_worker_advance_recovery_schedule as s')
      .leftJoin('mill_payroll_runs as r', 'r.id', 's.payroll_run_id')
      .where('s.advance_id', advance.id)
      .orderBy('s.period', 'asc').orderBy('s.id', 'asc')
      .select('s.*', 'r.pay_date as run_pay_date');
    const amount = parseFloat(advance.amount) || 0;
    const recovered = parseFloat(advance.recovered_amount) || 0;
    // Debit/credit ledger: advance given (debit), each recovery (credit). Balance = remaining advance.
    const entries = [{ date: advance.advance_date, description: 'Advance given', ref: advance.expense_id ? `ADV-${advance.id}` : null, debit: amount, credit: 0 }];
    for (const s of schedule) {
      if (parseFloat(s.recovered_amount) > 0) {
        entries.push({ date: s.recovered_at || s.run_pay_date || `${s.period}-28`, description: `Payroll deduction ${s.period}`, ref: s.payroll_run_id ? `PR-${s.payroll_run_id}` : null, debit: 0, credit: parseFloat(s.recovered_amount) || 0 });
      }
    }
    entries.sort((a, b) => new Date(a.date) - new Date(b.date) || 0);
    let bal = 0; for (const e of entries) { bal += e.debit - e.credit; e.balance = Math.round(bal); }
    return res.json({ success: true, data: { advance, schedule, entries, outstanding: Math.max(0, Math.round(amount - recovered)) } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Delete an advance — unwinds its cash-out and removes the record.
router.delete('/advances/:id', authorize('payroll', 'delete'), async (req, res) => {
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

router.get('/attendance', authorize('payroll', 'view'), async (req, res) => {
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

router.post('/attendance', authorize('payroll', 'create'), async (req, res) => {
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
router.post('/attendance/bulk', authorize('payroll', 'create'), async (req, res) => {
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
          // Merge only status + hours_worked so any overtime already logged on the
          // cell is preserved (don't clobber OT when bulk-setting Sundays/holidays).
          await trx('mill_attendance').insert({
            worker_id: r.worker_id, date: r.date, status: r.status,
            hours_worked: attHours(r.status), overtime_hours: 0,
          }).onConflict(['worker_id', 'date']).merge(['status', 'hours_worked', 'updated_at']);
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

router.get('/attendance/holidays', authorize('payroll', 'view'), async (req, res) => {
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

// computePayrollSummary moved to ./payroll.service.js (shared with the scheduler).

// Apply `amount` of recovery to a worker's outstanding advances, oldest first —
// so a posted payroll run closes out the advances it deducted (otherwise the
// same advance would be deducted again every following month).
async function recoverAdvancesForWorker(trx, workerId, amount, ctx = {}) {
  let remaining = parseFloat(amount) || 0;
  if (remaining <= 0) return;
  const { period, runId = null, lineId = null } = ctx;
  const advs = await trx('mill_worker_advances')
    .where({ worker_id: workerId, status: 'outstanding' })
    .orderBy('advance_date', 'asc').orderBy('id', 'asc');
  for (const a of advs) {
    if (remaining <= 0) break;
    const out = (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0);
    if (out <= 0) continue;
    const applied = Math.min(out, remaining);
    const newRecovered = (parseFloat(a.recovered_amount) || 0) + applied;
    await trx('mill_worker_advances').where('id', a.id).update({
      recovered_amount: newRecovered,
      status: newRecovered >= (parseFloat(a.amount) || 0) - 0.01 ? 'recovered' : 'outstanding',
      updated_at: trx.fn.now(),
    });
    if (period) await applyRecoveryToSchedule(trx, a, period, applied, runId, lineId);
    remaining -= applied;
  }
}

// Reflect a recovery on the advance's schedule. fixed_installment consumes its
// pre-generated pending rows (period asc); other methods get an actual-recovery
// row stamped with the run, so every recovery is visible and reversible.
async function applyRecoveryToSchedule(trx, advance, period, applied, runId, lineId) {
  let left = parseFloat(applied) || 0;
  if (left <= 0) return;
  if (advance.recovery_method === 'fixed_installment') {
    const rows = await trx('mill_worker_advance_recovery_schedule')
      .where('advance_id', advance.id).whereIn('status', ['pending', 'partially_recovered'])
      .where('period', '<=', period).orderBy('period', 'asc').orderBy('id', 'asc');
    for (const r of rows) {
      if (left <= 0) break;
      const due = (parseFloat(r.scheduled_amount) || 0) - (parseFloat(r.recovered_amount) || 0);
      const take = Math.min(due, left);
      const newRec = (parseFloat(r.recovered_amount) || 0) + take;
      await trx('mill_worker_advance_recovery_schedule').where('id', r.id).update({
        recovered_amount: newRec,
        status: newRec >= (parseFloat(r.scheduled_amount) || 0) - 0.01 ? 'recovered' : 'partially_recovered',
        payroll_run_id: runId, payroll_line_id: lineId, recovered_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
      left -= take;
    }
  }
  // For non-fixed methods (full/percentage/manual) the recovery has no planned
  // row, so record an actual-recovery row stamped with the run. (fixed_installment
  // only ever consumes its planned rows above, so reversal stays unambiguous.)
  if (left > 0.001 && advance.recovery_method !== 'fixed_installment') {
    await trx('mill_worker_advance_recovery_schedule').insert({
      advance_id: advance.id, worker_id: advance.worker_id, period,
      scheduled_amount: Math.round(left * 100) / 100, recovered_amount: Math.round(left * 100) / 100,
      status: 'recovered', payroll_run_id: runId, payroll_line_id: lineId, recovered_at: trx.fn.now(),
    });
  }
}

// Mark this period's still-pending fixed-installment rows as skipped (admin
// reduced/skipped the deduction with a reason). Leaves the advance outstanding.
async function markPeriodSkipped(trx, workerId, period, reason) {
  await trx('mill_worker_advance_recovery_schedule as s')
    .whereIn('s.advance_id', trx('mill_worker_advances').where('worker_id', workerId).select('id'))
    .where('s.period', period).whereIn('s.status', ['pending', 'partially_recovered'])
    .update({ status: 'skipped', skip_reason: reason || 'Skipped during payroll run', updated_at: trx.fn.now() });
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
// Employees already PAID for a month — counts BOTH a payroll-run line AND a
// per-employee salary expense (business_expenses category 'salaries' tagged to
// the employee). This stops a salary being paid twice across the two flows
// (e.g. a manual salary expense and then a payroll run for the same month).
// committedWorkerStatus moved to ./payroll.service.js (shared with the scheduler).

router.get('/payroll/summary', authorize('payroll', 'view'), async (req, res) => {
  try {
    const data = await computePayrollSummary(req.query.month);
    const status = await committedWorkerStatus(req.query.month);
    data.summary = data.summary.map((w) => ({ ...w, paid: status.get(w.id) === 'paid', committed: status.has(w.id), runStatus: status.get(w.id) || null }));
    // Net still owed = employees not yet in any run this period.
    data.unpaidNet = data.summary.filter((w) => !w.committed).reduce((s, w) => s + w.netPay, 0);
    data.paidCount = data.summary.filter((w) => w.paid).length;
    return res.json({ success: true, data });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// List posted payroll runs (history) + the linked expense's bank.
// Enrich payslip lines for printing: worker contact (cnic/phone) + the worker's
// CURRENT outstanding advance balance (so a payslip can show "advance remaining").
async function enrichPayslipLines(lines) {
  const ids = [...new Set(lines.map((l) => l.worker_id).filter(Boolean))];
  if (!ids.length) return lines.map((l) => ({ ...l, cnic: null, phone: null, advance_outstanding: 0 }));
  const workers = await db('mill_workers').whereIn('id', ids).select('id', 'cnic', 'phone', 'joined_date');
  const wMap = new Map(workers.map((w) => [w.id, w]));
  const advRows = await db('mill_worker_advances').whereIn('worker_id', ids).where('status', 'outstanding')
    .groupBy('worker_id').select('worker_id', db.raw('COALESCE(SUM(amount - recovered_amount),0) as outstanding'));
  const advMap = new Map(advRows.map((r) => [r.worker_id, parseFloat(r.outstanding) || 0]));
  return lines.map((l) => ({
    ...l,
    cnic: (wMap.get(l.worker_id) || {}).cnic || null,
    phone: (wMap.get(l.worker_id) || {}).phone || null,
    joined_date: (wMap.get(l.worker_id) || {}).joined_date || null,
    advance_outstanding: advMap.get(l.worker_id) || 0,
  }));
}

router.get('/payroll/runs', authorize('payroll', 'view'), async (req, res) => {
  try {
    const runs = await db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .leftJoin('users as up', 'up.id', 'r.created_by')
      .leftJoin('users as ua', 'ua.id', 'r.approved_by')
      .leftJoin('users as upd', 'upd.id', 'r.paid_by')
      .select('r.*', 'ba.name as bank_name', 'up.full_name as prepared_by_name', 'ua.full_name as approved_by_name', 'upd.full_name as paid_by_name')
      .orderBy('r.period', 'desc').orderBy('r.id', 'desc');
    return res.json({ success: true, data: { runs } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Payroll report — every run (optionally within a from..to period range) with
// its payslip lines nested, plus grand totals. One pass over runs + lines.
router.get('/payroll/report', authorize('payroll', 'view'), async (req, res) => {
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
      ? await enrichPayslipLines(await db('mill_payroll_lines').whereIn('run_id', runIds).orderBy('worker_name'))
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
router.get('/payroll/runs/:id', authorize('payroll', 'view'), async (req, res) => {
  try {
    const run = await db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .leftJoin('users as up', 'up.id', 'r.created_by')
      .leftJoin('users as ua', 'ua.id', 'r.approved_by')
      .leftJoin('users as upd', 'upd.id', 'r.paid_by')
      .select('r.*', 'ba.name as bank_name', 'up.full_name as prepared_by_name', 'ua.full_name as approved_by_name', 'upd.full_name as paid_by_name')
      .where('r.id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    const lines = await enrichPayslipLines(await db('mill_payroll_lines').where('run_id', run.id).orderBy('worker_name'));
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
// PREPARE a payroll run (approval workflow step 1). Computes + snapshots the
// payslip lines and creates the run as 'prepared' — NO cash/GL posting and NO
// advance recovery yet (both happen at /pay). The run must then be Approved and
// Paid. (Gate: milling.create, not Mill Operator — preparers are Mill Manager/
// admins; finance/owner approve & pay below.)
router.post('/payroll/run', authorize('payroll', 'create'),
  auditAction('prepare', 'mill_payroll_run', (req, data) => data.data?.run?.id),
  async (req, res) => {
  try {
    const { month, pay_method, bank_account_id, pay_date, notes, lines } = req.body;
    const run = await preparePayrollRun({ month, lines, pay_method, bank_account_id, pay_date, notes }, req.user?.id);
    return res.json({ success: true, data: { run } });
  } catch (err) { return res.status(err.httpStatus || 500).json({ success: false, message: err.message }); }
});

// ── Scheduled / recurring monthly payroll ────────────────────────────────────
// One mill payroll auto-prepare schedule, stored as a scheduled_tasks row
// (task_type 'payroll_prepare'). The hourly scheduler auto-PREPARES a run on the
// chosen day each month; it never auto-approves or auto-pays (approval stays
// human). config = { pay_method, day_of_month, notes }.
const PAYROLL_TASK = 'payroll_prepare';
function parseTaskConfig(t) { try { return typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {}); } catch (e) { return {}; } }

router.get('/payroll/schedule', authorize('payroll', 'view'), async (req, res) => {
  try {
    const task = await db('scheduled_tasks').where('task_type', PAYROLL_TASK).orderBy('id', 'desc').first();
    if (!task) return res.json({ success: true, data: { schedule: null } });
    const cfg = parseTaskConfig(task);
    return res.json({ success: true, data: { schedule: {
      id: task.id, active: !!task.is_active, payMethod: cfg.pay_method || 'cash',
      dayOfMonth: cfg.day_of_month || 28, notes: cfg.notes || null,
      nextRun: task.next_run, lastRun: task.last_run, lastStatus: task.last_status,
    } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Create/update the schedule. Finance/Owner only (they own payroll spend).
router.put('/payroll/schedule', authorize('payroll', 'approve'),
  auditAction('schedule', 'mill_payroll_run', () => null), async (req, res) => {
  try {
    const active = req.body.active !== false;
    const dayOfMonth = Math.min(28, Math.max(1, parseInt(req.body.day_of_month, 10) || 28));
    const payMethod = req.body.pay_method === 'bank' ? 'bank' : 'cash';
    const config = JSON.stringify({ pay_method: payMethod, day_of_month: dayOfMonth, notes: req.body.notes || null });
    const nextRun = nextPrepareDate(dayOfMonth).toISOString();
    const existing = await db('scheduled_tasks').where('task_type', PAYROLL_TASK).orderBy('id', 'desc').first();
    let task;
    if (existing) {
      [task] = await db('scheduled_tasks').where('id', existing.id)
        .update({ is_active: active, config, cron_expression: 'monthly', next_run: nextRun, updated_at: db.fn.now() }).returning('*');
    } else {
      [task] = await db('scheduled_tasks').insert({
        name: 'Monthly payroll auto-prepare', task_type: PAYROLL_TASK,
        cron_expression: 'monthly', is_active: active, config, next_run: nextRun,
      }).returning('*');
    }
    const cfg = parseTaskConfig(task);
    return res.json({ success: true, data: { schedule: { id: task.id, active: !!task.is_active, payMethod: cfg.pay_method, dayOfMonth: cfg.day_of_month, notes: cfg.notes, nextRun: task.next_run } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Manually trigger the scheduled prepare now (prepares the CURRENT month for all
// not-yet-committed employees). Preparers (Mill Manager/admins), not operators.
router.post('/payroll/schedule/run-now', authorize('payroll', 'create'),
  auditAction('prepare', 'mill_payroll_run', (req, data) => data.data?.run?.id), async (req, res) => {
  try {
    const month = (req.body.month && /^\d{4}-\d{2}$/.test(req.body.month)) ? req.body.month : new Date().toISOString().slice(0, 7);
    const task = await db('scheduled_tasks').where('task_type', PAYROLL_TASK).orderBy('id', 'desc').first();
    const cfg = task ? parseTaskConfig(task) : {};
    try {
      const run = await preparePayrollRun({ month, pay_method: cfg.pay_method || 'cash', notes: `Payroll auto-prepared for ${month}` }, req.user?.id);
      return res.json({ success: true, data: { run, prepared: true } });
    } catch (e) {
      if (e.code === 'NONE') return res.json({ success: true, data: { run: null, prepared: false, message: 'All active employees are already in a run for this month.' } });
      throw e;
    }
  } catch (err) { return res.status(err.httpStatus || 500).json({ success: false, message: err.message }); }
});

// APPROVE a prepared run (step 2). Finance/Owner only. No money moves yet.
router.post('/payroll/runs/:id/approve', authorize('payroll', 'approve'),
  auditAction('approve', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (run.status !== 'prepared') return res.status(409).json({ success: false, message: `Only a Prepared run can be approved (this run is ${run.status}).` });
    const [updated] = await db('mill_payroll_runs').where('id', run.id)
      .update({ status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// PAY an approved run (step 3) — NOW the cash/GL posting + advance recovery
// happen. Finance/Owner only. Must be Approved first.
router.post('/payroll/runs/:id/pay', authorize('payroll', 'pay'),
  auditAction('pay', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (run.status !== 'approved') return res.status(409).json({ success: false, message: `Only an Approved run can be paid (this run is ${run.status}).` });
    const lines = await db('mill_payroll_lines').where('run_id', run.id);
    const netTotal = parseFloat(run.net_total) || 0;

    // 1) Pay out the net total as a paid salaries expense (cash/bank + GL).
    let expense = null;
    if (netTotal > 0) {
      expense = await expensesService.create({
        expense_type: 'mill', category: 'salaries', amount: netTotal, currency: 'PKR',
        expense_date: run.pay_date,
        description: `Salaries — payroll run ${run.period}`,
        notes: run.notes || `Payroll ${run.period}: ${run.employee_count} employee(s) · net ${netTotal}`,
        pay_now: true, bank_account_id: run.bank_account_id,
        payment_method: run.pay_method || 'cash',
      }, req.user?.id);
    }

    // 2) Recover the advances each line cleared + mark the run Paid.
    const updated = await db.transaction(async (trx) => {
      for (const l of lines) {
        const ded = parseFloat(l.advance_deducted) || 0;
        if (ded > 0 && l.worker_id) await recoverAdvancesForWorker(trx, l.worker_id, ded, { period: run.period, runId: run.id, lineId: l.id });
        if (l.skip_reason && l.worker_id) await markPeriodSkipped(trx, l.worker_id, run.period, l.skip_reason);
      }
      const [r] = await trx('mill_payroll_runs').where('id', run.id)
        .update({ status: 'paid', expense_id: expense?.id || null, paid_by: req.user?.id || null, paid_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*');
      return r;
    });
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// VOID a Prepared/Approved run (before payment). Nothing posted yet, so just
// mark it voided — frees its workers for a new run. (Paid runs use DELETE.)
router.post('/payroll/runs/:id/void', authorize('payroll', 'approve'),
  auditAction('void', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (!['prepared', 'approved'].includes(run.status)) return res.status(409).json({ success: false, message: `Only a Prepared/Approved run can be voided (this run is ${run.status}). Use delete to reverse a paid run.` });
    const [updated] = await db('mill_payroll_runs').where('id', run.id)
      .update({ status: 'voided', voided_by: req.user?.id || null, voided_at: db.fn.now(), void_reason: req.body?.reason || null, updated_at: db.fn.now() }).returning('*');
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Undo a payroll run — reverse its cash-out (+ GL), restore the advances it
// recovered to outstanding, and delete the run (lines cascade).
router.delete('/payroll/runs/:id', authorize('payroll', 'delete'), async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    // A Prepared/Approved/Voided run never posted money or recovered advances —
    // just delete it (lines cascade). Only paid/posted runs need reversal.
    if (!['paid', 'posted'].includes(run.status)) {
      await db('mill_payroll_runs').where('id', run.id).del();
      return res.json({ success: true, data: { deleted: run.id } });
    }
    await db.transaction(async (trx) => {
      // Precise reversal via the schedule rows this run recovered (new runs);
      // fall back to amount-based reversal for legacy runs without schedule rows.
      const schedRows = await trx('mill_worker_advance_recovery_schedule').where('payroll_run_id', run.id);
      if (schedRows.length) {
        for (const s of schedRows) {
          const rec = parseFloat(s.recovered_amount) || 0;
          const adv = await trx('mill_worker_advances').where('id', s.advance_id).first();
          if (adv && rec > 0) {
            const newRec = Math.max(0, (parseFloat(adv.recovered_amount) || 0) - rec);
            await trx('mill_worker_advances').where('id', adv.id).update({
              recovered_amount: newRec,
              status: newRec >= (parseFloat(adv.amount) || 0) - 0.01 ? 'recovered' : 'outstanding',
              updated_at: trx.fn.now(),
            });
          }
          if (adv && adv.recovery_method === 'fixed_installment') {
            await trx('mill_worker_advance_recovery_schedule').where('id', s.id).update({
              recovered_amount: 0, status: 'pending', payroll_run_id: null, payroll_line_id: null, recovered_at: null, updated_at: trx.fn.now(),
            });
          } else {
            await trx('mill_worker_advance_recovery_schedule').where('id', s.id).del();
          }
        }
      } else {
        const lines = await trx('mill_payroll_lines').where('run_id', run.id);
        for (const l of lines) {
          if (parseFloat(l.advance_deducted) > 0 && l.worker_id) {
            await unrecoverAdvancesForWorker(trx, l.worker_id, l.advance_deducted);
          }
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
