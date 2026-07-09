const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const controller = require('../../controllers/millingController');
const advancedController = require('../../controllers/millingAdvancedController');
const authorize = require('../../middleware/rbac');
const { authorizeRole, denyRoles } = require('../../middleware/rbac');
// Mill Operator is a production-only role with no finance visibility. A couple of
// milling endpoints expose cost/profit/cash, so they carry this guard (the same
// one the reporting + ai modules use) even though the rest of milling is fine.
const noFinanceForOperator = denyRoles('Mill Operator');
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
// Service-milling (toll/job-work) dashboard feed — gated by the dedicated
// service_milling.view perm (Milling/Inventory roles), not the generic milling perm.
router.get('/service-batches', authorize('service_milling', 'view'), controller.listServiceBatches);
router.get('/batches/:id', authorize('milling', 'view'), controller.getById);
router.put('/batches/:id', authorize('milling', 'edit'),
  auditAction('update_batch', 'milling_batch', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = /^\d+$/.test(req.params.id) ? parseInt(req.params.id)
        : (await db('milling_batches').where('batch_no', req.params.id).select('id').first())?.id;
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found' });

      const allowed = ['supplier_id', 'raw_qty_kg', 'planned_finished_kg', 'milling_fee_per_kg',
        'mill_id', 'machine_line', 'shift', 'notes', 'variance_status', 'status', 'batch_name'];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.batch_name != null) updates.batch_name = String(updates.batch_name).trim().slice(0, 200) || null;
      // Tags: accept an array or comma string → normalised jsonb array.
      if (req.body.custom_tags !== undefined) {
        const raw = req.body.custom_tags;
        const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
        updates.custom_tags = JSON.stringify([...new Set(arr.map((x) => String(x).trim()).filter(Boolean))]);
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
// Edit a truck arrival — manager/owner correction. Gated by milling.edit (same
// as delete), so mill operators see trucks read-only.
router.put(
  '/batches/:id/vehicles/:vehicleId',
  authorize('milling', 'edit'),
  auditAction('update_vehicle', 'milling_batch', (req) => req.params.id),
  controller.updateVehicle
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
        'va.weight_kg',
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
      const { aq_moisture, aq_broken, aq_price_per_mt, aq_price_per_kg, ...rest } = r;
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
    const totalWeight = rows.reduce((s, r) => s + (parseFloat(r.weight_kg) || 0), 0);
    const totalValue = rows.reduce((s, r) => {
      const w = parseFloat(r.weight_kg) || 0;
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

router.get('/cash-flow', authorize('milling', 'view'), noFinanceForOperator, advancedController.cashFlow);
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
router.get('/analytics/batch-profitability/:id', authorize('milling', 'view'), noFinanceForOperator, advancedController.analyticsBatchProfitability);

// =============================================================================
// Product Pricing — confirm byproduct prices per batch
// =============================================================================

router.get('/last-prices', authorize('milling', 'view'), async (req, res) => {
  try {
    // Get the most recent batch with confirmed prices
    const last = await db('milling_batches')
      .whereNotNull('finished_price_per_kg')
      .where('prices_confirmed', true)
      .orderBy('completed_at', 'desc')
      .select(
        'finished_price_per_kg', 'broken_price_per_kg',
        'bran_price_per_kg', 'husk_price_per_kg',
        'sortex_rejects_price_per_kg',
        'b1_price_per_kg', 'b2_price_per_kg', 'b3_price_per_kg',
        'csr_price_per_kg', 'short_grain_price_per_kg',
        'batch_no', 'completed_at'
      )
      .first();

    const brokenDefault = parseFloat(last?.broken_price_per_kg) || 38;
    return res.json({
      success: true,
      data: {
        lastPrices: last ? {
          finished:    parseFloat(last.finished_price_per_kg) || 72.8,
          broken:      brokenDefault,
          bran:        parseFloat(last.bran_price_per_kg) || 28,
          husk:        parseFloat(last.husk_price_per_kg) || 8.4,
          sortex:      parseFloat(last.sortex_rejects_price_per_kg) || 35,
          // Per-grade broken prices — fall back to the aggregate broken
          // price so old batches give the operator a sensible starting
          // value until they set grade-specific rates.
          b1:          parseFloat(last.b1_price_per_kg) || brokenDefault,
          b2:          parseFloat(last.b2_price_per_kg) || brokenDefault,
          b3:          parseFloat(last.b3_price_per_kg) || brokenDefault,
          csr:         parseFloat(last.csr_price_per_kg) || brokenDefault,
          short_grain: parseFloat(last.short_grain_price_per_kg) || brokenDefault,
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
        broken_price_per_kg,
        bran_price_per_kg, husk_price_per_kg,
        sortex_rejects_price_per_kg,
        b1_price_per_kg, b2_price_per_kg, b3_price_per_kg,
        csr_price_per_kg, short_grain_price_per_kg,
        powder_price_per_kg, sweeping_price_per_kg,
        choba_price_per_kg,
        // Residual costing inputs — operator-entered Milling Cost and Other
        // Expenses (PKR totals). Finished price is DERIVED, not accepted here.
        manual_milling_cost_pkr, manual_other_expenses_pkr,
      } = req.body;

      // 0 is a valid manual cost; only blank/invalid → null.
      const numOrNull = (v) => (v === '' || v == null || Number.isNaN(parseFloat(v))) ? null : parseFloat(v);

      const priceUpdate = {
        broken_price_per_kg: parseFloat(broken_price_per_kg) || null,
        bran_price_per_kg: parseFloat(bran_price_per_kg) || null,
        husk_price_per_kg: parseFloat(husk_price_per_kg) || null,
        sortex_rejects_price_per_kg: parseFloat(sortex_rejects_price_per_kg) || null,
        b1_price_per_kg: parseFloat(b1_price_per_kg) || null,
        b2_price_per_kg: parseFloat(b2_price_per_kg) || null,
        b3_price_per_kg: parseFloat(b3_price_per_kg) || null,
        csr_price_per_kg: parseFloat(csr_price_per_kg) || null,
        short_grain_price_per_kg: parseFloat(short_grain_price_per_kg) || null,
        powder_price_per_kg: parseFloat(powder_price_per_kg) || null,
        sweeping_price_per_kg: parseFloat(sweeping_price_per_kg) || null,
        choba_price_per_kg: parseFloat(choba_price_per_kg) || null,
        manual_milling_cost_pkr: numOrNull(manual_milling_cost_pkr),
        manual_other_expenses_pkr: numOrNull(manual_other_expenses_pkr),
        prices_confirmed: true,
      };

      // Persist prices + manual costs, then run the residual cost engine across
      // the batch's output lots (finished = Net Purchase − by-product value),
      // recomputing COGS for any non-locked order/sale. Stamp the derived
      // finished cost back onto finished_price_per_kg for display.
      const inventoryService = require('../inventory/inventory.service');
      const result = await db.transaction(async (trx) => {
        const [updated] = await trx('milling_batches').where({ id })
          .update({ ...priceUpdate, updated_at: trx.fn.now() }).returning('*');
        const realloc = await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, id, { userId: req.user?.id });
        if (realloc && realloc.finishedCostPerKg != null) {
          // Store PER-KG (not ×1000): every reader treats finished_price_per_kg
          // like its per-KG siblings (b1_price_per_kg, broken_price_per_kg, …) and
          // the yield-edit resync path writes it per-KG too. The ×1000 here made
          // confirmed-price finished outputs 1000× overvalued downstream.
          await trx('milling_batches').where({ id }).update({ finished_price_per_kg: realloc.finishedCostPerKg });
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
const accountingService = require('../accounting/accounting.service');
const automationService = require('../admin/automation.service');
const { resolveCashAccountId } = require('../../shared/cashAccounts');
// Shared payroll logic (also used by the scheduler) — compute + prepare.
const payrollService = require('./payroll.service');
const { computePayrollSummary, committedWorkerStatus, preparePayrollRun, nextPrepareDate, computeLeaveBalances } = payrollService;

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
  // Never leak the bcrypt portal PIN hash; expose only the enabled flag.
  return workers.map(({ portal_pin_hash, ...w }) => ({ ...w, advance_outstanding: map.get(w.id) || 0 }));
}

router.get('/workers', authorize('payroll', 'view'), async (req, res) => {
  try {
    // Head Office ('general') vs Mill ('mill') payroll scope. Omitted = all.
    const entity = req.query.entity === 'general' ? 'general' : req.query.entity === 'mill' ? 'mill' : null;
    const q = db('mill_workers').orderBy('is_active', 'desc').orderBy('name');
    if (entity) q.where('entity', entity);
    const workers = await q;
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

// True when a normalized pay change differs from the worker's current pay.
const payChanged = (w, pay) => String(w.pay_type) !== String(pay.pay_type)
  || (parseFloat(w.monthly_salary) || 0) !== (parseFloat(pay.monthly_salary) || 0)
  || (parseFloat(w.daily_wage) || 0) !== (parseFloat(pay.daily_wage) || 0);
// Record a salary-revision row (old→new) so pay changes are never silent.
async function recordSalaryRevision(qb, w, pay, { effective_date, reason, ot_rate, userId } = {}) {
  await qb('mill_salary_revisions').insert({
    worker_id: w.id, effective_date: effective_date || new Date().toISOString().slice(0, 10), reason: reason || null,
    prev_pay_type: w.pay_type, new_pay_type: pay.pay_type,
    prev_monthly_salary: w.monthly_salary, new_monthly_salary: pay.monthly_salary,
    prev_daily_wage: w.daily_wage, new_daily_wage: pay.daily_wage,
    prev_ot_rate: w.ot_rate_per_hour, new_ot_rate: ot_rate !== undefined ? ot_rate : w.ot_rate_per_hour,
    created_by: userId || null,
  });
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

router.post('/workers', authorize('payroll', 'create'), auditAction('create', 'mill_worker', (req, d) => d.data?.worker?.id), async (req, res) => {
  try {
    const { name, role, phone, cnic, joined_date, left_date, mill_id, notes, bank_name, bank_account_number, iban, department } = req.body;
    const entity = req.body.entity === 'general' ? 'general' : 'mill'; // Head Office vs Mill
    const { pay_type, monthly_salary, daily_wage } = normalizeWorkerPay(req.body);
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
    if (pay_type === 'monthly' && !(monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
    if (pay_type === 'daily' && !(daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
    const ot_rate_per_hour = req.body.ot_rate_per_hour != null && req.body.ot_rate_per_hour !== '' ? parseFloat(req.body.ot_rate_per_hour) : null;
    const [worker] = await db('mill_workers').insert({
      name, role: role || 'laborer', pay_type, monthly_salary, daily_wage,
      ot_rate_per_hour: ot_rate_per_hour > 0 ? ot_rate_per_hour : null,
      phone: phone || null, cnic: cnic || null,
      bank_name: bank_name || null, bank_account_number: bank_account_number || null, iban: iban || null,
      department: department || null,
      entity,
      joined_date: joined_date || new Date().toISOString().split('T')[0],
      left_date: left_date || null,
      mill_id: mill_id || null, notes: notes || null,
    }).returning('*');
    return res.json({ success: true, data: { worker } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Edit a worker — pay type/rate, contact, or activate/deactivate. Deactivating
// (is_active=false) keeps all history but drops them from the active payroll run.
router.put('/workers/:id', authorize('payroll', 'edit'), auditAction('update', 'mill_worker', (req) => req.params.id), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const updates = {};
    for (const f of ['name', 'role', 'phone', 'cnic', 'joined_date', 'left_date', 'notes', 'bank_name', 'bank_account_number', 'iban', 'department']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    if (req.body.ot_rate_per_hour !== undefined) {
      const v = req.body.ot_rate_per_hour !== '' ? parseFloat(req.body.ot_rate_per_hour) : null;
      updates.ot_rate_per_hour = v > 0 ? v : null;
    }
    if (req.body.is_active !== undefined) updates.is_active = !!req.body.is_active;
    if (req.body.entity !== undefined) updates.entity = req.body.entity === 'general' ? 'general' : 'mill';
    let payRevision = null;
    if (req.body.pay_type !== undefined || req.body.daily_wage !== undefined || req.body.monthly_salary !== undefined) {
      const pay = normalizeWorkerPay({ ...worker, ...req.body });
      if (pay.pay_type === 'monthly' && !(pay.monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
      if (pay.pay_type === 'daily' && !(pay.daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
      Object.assign(updates, pay);
      if (payChanged(worker, pay)) payRevision = pay; // log a revision so pay isn't silently overwritten
    }
    updates.updated_at = db.fn.now();
    const [updated] = await db.transaction(async (trx) => {
      if (payRevision) await recordSalaryRevision(trx, worker, payRevision, { reason: req.body.revision_reason || 'Edited via employee form', userId: req.user?.id });
      return trx('mill_workers').where('id', req.params.id).update(updates).returning('*');
    });
    return res.json({ success: true, data: { worker: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Dedicated "Revise salary" — records a revision (old→new) WITH an effective date
// + reason, then applies the new pay. (The generic PUT also auto-logs, but this
// is the proper increment flow that captures why + when.)
router.post('/workers/:id/salary-revision', authorize('payroll', 'edit'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const pay = normalizeWorkerPay({ ...worker, ...req.body });
    if (pay.pay_type === 'monthly' && !(pay.monthly_salary > 0)) return res.status(400).json({ success: false, message: 'monthly_salary required for salaried workers.' });
    if (pay.pay_type === 'daily' && !(pay.daily_wage > 0)) return res.status(400).json({ success: false, message: 'daily_wage required for daily-wage workers.' });
    if (!payChanged(worker, pay)) return res.status(400).json({ success: false, message: 'No pay change — the new figure matches the current salary.' });
    // The new salary takes effect IMMEDIATELY (there's no scheduler to apply a
    // future-dated raise later), so reject a future effective_date rather than
    // record one that would never actually take effect (M7).
    if (req.body.effective_date && String(req.body.effective_date).slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ success: false, message: 'Effective date cannot be in the future — the new salary takes effect immediately. Use today or an earlier date.' });
    }
    const otRate = req.body.ot_rate_per_hour !== undefined ? (req.body.ot_rate_per_hour !== '' ? parseFloat(req.body.ot_rate_per_hour) : null) : worker.ot_rate_per_hour;
    const updated = await db.transaction(async (trx) => {
      await recordSalaryRevision(trx, worker, pay, { effective_date: req.body.effective_date, reason: req.body.reason, ot_rate: otRate, userId: req.user?.id });
      const [w] = await trx('mill_workers').where('id', worker.id).update({ ...pay, ot_rate_per_hour: otRate && otRate > 0 ? otRate : null, updated_at: trx.fn.now() }).returning('*');
      return w;
    });
    return res.json({ success: true, data: { worker: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/workers/:id/salary-revisions', authorize('payroll', 'view'), async (req, res) => {
  try {
    const rows = await db('mill_salary_revisions as r').leftJoin('users as u', 'u.id', 'r.created_by')
      .where('r.worker_id', req.params.id).orderBy('r.effective_date', 'desc').orderBy('r.id', 'desc')
      .select('r.*', 'u.full_name as created_by_name');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Fully unwind a salary-advance cash-out (the business_expense it created, its
// payable, payment, bank movement and GL journals) — danger-zone hard-delete
// style, so deleting an advance or its worker leaves no orphan money behind.
// Post the statutory-withholding journal for a run (DR 6135 Salaries & Wages /
// CR each liability account, e.g. 2050 Tax Payable, 2055 EOBI Payable). The
// withheld amounts are still a salary cost but are owed to the authority rather
// than paid to the employee — so this is recognised at pay/accrue and stays as
// a standing liability until separately remitted. Ref `STAT-RUN-<id>` so the
// run DELETE can reverse it cleanly. No-op when nothing was withheld.
async function postRunStatutoryJournal(trx, run, userId, lines, refNo) {
  if (!lines) lines = await trx('mill_payroll_lines').where('run_id', run.id);
  refNo = refNo || `STAT-RUN-${run.id}`;
  const byAccount = {};
  for (const l of lines) {
    let arr = l.statutory_json;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      const acc = s.account || '2050';
      byAccount[acc] = (byAccount[acc] || 0) + (parseFloat(s.amount) || 0);
    }
  }
  const total = Object.values(byAccount).reduce((s, v) => s + v, 0);
  if (total <= 0) return;
  const dr = await trx('chart_of_accounts').where('code', '6135').first();
  if (!dr) return;
  const creditLines = [];
  for (const [code, amt] of Object.entries(byAccount)) {
    if (amt <= 0) continue;
    const acc = await trx('chart_of_accounts').where('code', code).first();
    if (!acc) continue;
    creditLines.push({ account_id: acc.id, account: acc.name, debit: 0, credit: amt, narration: `CR ${acc.code} ${acc.name} — statutory withheld ${run.period}` });
  }
  if (!creditLines.length) return;
  // createJournal does string date math — normalise a Date to YYYY-MM-DD.
  const payDate = run.pay_date instanceof Date ? run.pay_date.toISOString().slice(0, 10) : (run.pay_date || new Date().toISOString().slice(0, 10));
  const journal = await accountingService.createJournal(trx, {
    date: payDate, entity: run.entity === 'general' ? 'general' : 'mill', refType: 'Payroll Statutory', refNo,
    description: `Statutory deductions withheld — payroll ${run.period}`,
    currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
    lines: [
      { account_id: dr.id, account: dr.name, debit: total, credit: 0, narration: `DR ${dr.code} ${dr.name} — statutory withheld ${run.period}` },
      ...creditLines,
    ],
  });
  if (journal?.id) await accountingService.postJournal(trx, journal.id);
}

// Pay a specific set of (unpaid) payroll lines: create ONE salaries expense for
// their net (cash/bank + GL), recover their advances, post their statutory
// journal, mark those lines paid, and roll the run to 'paid' (all lines paid)
// or 'partially_paid' (some still unpaid). Shared by full and partial pay.
async function payLineBatch(run, lineRows, userId) {
  return db.transaction(async (trx) => {
    // Serialize against a concurrent pay/accrue on the same run (M1): lock the run
    // row, then re-assert it's still payable and the target lines are still unpaid
    // — otherwise two racing /pay calls could both post 6135 (double cash-out).
    const locked = await trx('mill_payroll_runs').where('id', run.id).forUpdate().first();
    if (!locked || !['approved', 'partially_paid'].includes(locked.status)) {
      const e = new Error(`This run is no longer payable (status ${locked?.status || 'missing'}).`); e.statusCode = 409; throw e;
    }
    const rows = await trx('mill_payroll_lines').whereIn('id', lineRows.map((l) => l.id)).whereNull('paid_at');
    if (!rows.length) { const e = new Error('These lines were already paid.'); e.statusCode = 409; throw e; }
    const net = rows.reduce((s, l) => s + (parseFloat(l.net_pay) || 0), 0);
    // Create the salaries expense (cash-out + 6135 GL) INSIDE this transaction so
    // it commits atomically with marking the lines paid + recovering advances. If
    // any step below fails the expense rolls back too — otherwise a committed
    // expense with unmarked lines would be re-paid (double cash-out) on retry.
    let expense = null;
    if (net > 0) {
      expense = await expensesService.create({
        // Route to the run's entity: 'general' → Head Office books + Office Petty
        // Cash, 'mill' → mill books + Mill Cash (expensesService maps type→entity+cash).
        expense_type: locked.entity === 'general' ? 'general' : 'mill', category: 'salaries', amount: net, currency: 'PKR',
        expense_date: locked.pay_date,
        description: `Salaries — payroll run ${locked.period}`,
        notes: `Payroll ${locked.period}: ${rows.length} employee(s) · net ${net}`,
        pay_now: true, bank_account_id: locked.bank_account_id, payment_method: locked.pay_method || 'cash',
      }, userId, trx);
    }
    for (const l of rows) {
      const ded = parseFloat(l.advance_deducted) || 0;
      if (ded > 0 && l.worker_id) await recoverAdvancesForWorker(trx, l.worker_id, ded, { period: locked.period, runId: locked.id, lineId: l.id });
      if (l.skip_reason && l.worker_id) await markPeriodSkipped(trx, l.worker_id, locked.period, l.skip_reason);
      await trx('mill_payroll_lines').where('id', l.id).update({ paid_at: trx.fn.now(), paid_by: userId || null, expense_id: expense?.id || null, updated_at: trx.fn.now() });
    }
    // Statutory journal scoped to THIS batch (ref tied to the expense so reversal
    // is precise even when a run pays in several batches). NOT swallowed (M2): a
    // posting failure must roll the whole batch back, not silently drop the leg.
    await postRunStatutoryJournal(trx, locked, userId, rows, expense ? `STAT-EXP-${expense.id}` : `STAT-RUN-${locked.id}`);
    const remaining = await trx('mill_payroll_lines').where('run_id', locked.id).whereNull('paid_at').count('id as c').first();
    const allPaid = (parseInt(remaining?.c, 10) || 0) === 0;
    const patch = allPaid
      ? { status: 'paid', paid_by: userId || null, paid_at: trx.fn.now(), updated_at: trx.fn.now() }
      : { status: 'partially_paid', updated_at: trx.fn.now() };
    if (!locked.expense_id && expense?.id) patch.expense_id = expense.id; // keep first expense on the run row
    const [r] = await trx('mill_payroll_runs').where('id', locked.id).update(patch).returning('*');
    return r;
  });
}

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
      await trx('bank_transactions').where('linked_payment_id', p.id).del();
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

// Set / reset / disable a worker's self-service portal PIN (Phase 19). A 4+ digit
// PIN is bcrypt-hashed; `enabled:false` (or no pin) turns the portal off.
router.post('/workers/:id/portal-pin', authorize('payroll', 'edit'), async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const enabled = req.body?.enabled !== false;
    const pin = req.body?.pin != null ? String(req.body.pin).trim() : '';
    const updates = { updated_at: db.fn.now() };
    if (!enabled) {
      updates.portal_enabled = false;
    } else {
      if (!worker.cnic) return res.status(400).json({ success: false, message: 'Add a CNIC first — the employee logs in with CNIC + PIN.' });
      if (pin) {
        if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ success: false, message: 'PIN must be 4–8 digits.' });
        updates.portal_pin_hash = await bcrypt.hash(pin, 10);
      } else if (!worker.portal_pin_hash) {
        return res.status(400).json({ success: false, message: 'Set a PIN to enable self-service.' });
      }
      updates.portal_enabled = true;
    }
    const [updated] = await db('mill_workers').where('id', worker.id).update(updates).returning(['id', 'portal_enabled']);
    return res.json({ success: true, data: { worker: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Employee self-service requests (admin side — Phase 20) ──
router.get('/worker-requests', authorize('payroll', 'view'), async (req, res) => {
  try {
    let q = db('mill_worker_requests as r').leftJoin('mill_workers as w', 'w.id', 'r.worker_id')
      .leftJoin('users as u', 'u.id', 'r.handled_by')
      .select('r.*', 'w.name as worker_name', 'w.role as worker_role', 'u.full_name as handled_by_name')
      .orderBy('r.created_at', 'desc');
    if (req.query.status) q = q.where('r.status', req.query.status);
    const rows = await q;
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/worker-requests/count', authorize('payroll', 'view'), async (req, res) => {
  try {
    const row = await db('mill_worker_requests').where('status', 'pending').count('id as c').first();
    return res.json({ success: true, data: { pending: parseInt(row?.c, 10) || 0 } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/worker-requests/:id/resolve', authorize('payroll', 'edit'), async (req, res) => {
  try {
    const r = await db('mill_worker_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Request not found.' });
    const status = ['approved', 'rejected', 'resolved'].includes(req.body?.status) ? req.body.status : 'resolved';
    const [updated] = await db('mill_worker_requests').where('id', r.id).update({
      status, response: req.body?.response || null, handled_by: req.user?.id || null, handled_at: db.fn.now(), updated_at: db.fn.now(),
    }).returning('*');
    return res.json({ success: true, data: updated });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Leave management (Phase 23) ──────────────────────────────────────────────
const inclusiveDays = (from, to) => {
  const a = Date.parse(String(from).slice(0, 10)); const b = Date.parse(String(to).slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
};
// Reflect approved leave on the attendance grid: upsert status='leave' for each
// date in the range (so it shows + prevents a present/leave double-pay), or
// remove those 'leave' rows when an approval is undone. Capped to a sane range.
async function markLeaveAttendance(workerId, fromDate, toDate, { remove = false, excludeRequestId = null } = {}) {
  // node-pg returns date columns as Date objects — String(Date) is not YYYY-MM-DD.
  const toYmd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const from = toYmd(fromDate); const to = toYmd(toDate);
  const a = Date.parse(from); const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a || (b - a) / 86400000 > 120) return;
  const dates = [];
  for (let d = a; d <= b; d += 86400000) dates.push(new Date(d).toISOString().slice(0, 10));
  if (remove) {
    // Only clear leave-days NOT still covered by ANOTHER approved leave request for
    // this worker — otherwise rejecting/deleting one leave wipes an overlapping
    // approved one's attendance (M6).
    const others = await db('mill_leave_requests').where('worker_id', workerId).where('status', 'approved')
      .modify((q) => { if (excludeRequestId) q.whereNot('id', excludeRequestId); })
      .select('from_date', 'to_date');
    const covered = new Set();
    for (const o of others) {
      const oa = Date.parse(toYmd(o.from_date)); const ob = Date.parse(toYmd(o.to_date));
      if (Number.isNaN(oa) || Number.isNaN(ob)) continue;
      for (let d = oa; d <= ob; d += 86400000) covered.add(new Date(d).toISOString().slice(0, 10));
    }
    const toClear = dates.filter((d) => !covered.has(d));
    if (toClear.length) await db('mill_attendance').where('worker_id', workerId).whereIn('date', toClear).where('status', 'leave').del();
    return;
  }
  for (const date of dates) {
    await db('mill_attendance').insert({ worker_id: workerId, date, status: 'leave', hours_worked: 0, overtime_hours: 0 })
      .onConflict(['worker_id', 'date']).merge(['status', 'hours_worked', 'updated_at']);
  }
}

router.get('/payroll/leave-types', authorize('payroll', 'view'), async (req, res) => {
  try { return res.json({ success: true, data: await db('mill_leave_types').orderBy('sort_order').orderBy('id') }); }
  catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-types', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, message: 'Name is required.' });
    const [row] = await db('mill_leave_types').insert({
      name: String(b.name).trim(), code: String(b.code || b.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30),
      paid: b.paid !== false, annual_quota: (b.annual_quota === '' || b.annual_quota == null) ? null : parseFloat(b.annual_quota),
      accrues: !!b.accrues, carry_forward: !!b.carry_forward,
      max_carry: (b.max_carry === '' || b.max_carry == null) ? null : parseFloat(b.max_carry),
      is_active: b.is_active !== false, sort_order: parseInt(b.sort_order, 10) || 0,
    }).returning('*');
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.put('/payroll/leave-types/:id', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const existing = await db('mill_leave_types').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, message: 'Leave type not found.' });
    const b = req.body || {}; const patch = { updated_at: db.fn.now() };
    if (b.name !== undefined) patch.name = String(b.name).trim();
    if (b.paid !== undefined) patch.paid = !!b.paid;
    if (b.annual_quota !== undefined) patch.annual_quota = (b.annual_quota === '' || b.annual_quota == null) ? null : parseFloat(b.annual_quota);
    if (b.accrues !== undefined) patch.accrues = !!b.accrues;
    if (b.carry_forward !== undefined) patch.carry_forward = !!b.carry_forward;
    if (b.max_carry !== undefined) patch.max_carry = (b.max_carry === '' || b.max_carry == null) ? null : parseFloat(b.max_carry);
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
    if (b.sort_order !== undefined) patch.sort_order = parseInt(b.sort_order, 10) || 0;
    const [row] = await db('mill_leave_types').where('id', existing.id).update(patch).returning('*');
    return res.json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.delete('/payroll/leave-types/:id', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const used = await db('mill_leave_requests').where('leave_type_id', req.params.id).first();
    if (used) { await db('mill_leave_types').where('id', req.params.id).update({ is_active: false, updated_at: db.fn.now() }); return res.json({ success: true, data: { deactivated: true } }); }
    await db('mill_leave_types').where('id', req.params.id).del();
    return res.json({ success: true, data: { deleted: req.params.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/payroll/leave-requests', authorize('payroll', 'view'), async (req, res) => {
  try {
    let q = db('mill_leave_requests as lr').leftJoin('mill_workers as w', 'w.id', 'lr.worker_id')
      .leftJoin('mill_leave_types as t', 't.id', 'lr.leave_type_id').leftJoin('users as u', 'u.id', 'lr.approved_by')
      .select('lr.*', 'w.name as worker_name', 'w.role as worker_role', 't.name as type_name', 'u.full_name as approved_by_name')
      .orderBy('lr.created_at', 'desc');
    if (req.query.status) q = q.where('lr.status', req.query.status);
    if (req.query.worker_id) q = q.where('lr.worker_id', parseInt(req.query.worker_id, 10));
    if (req.query.year) q = q.whereRaw("TO_CHAR(lr.from_date, 'YYYY') = ?", [String(req.query.year)]);
    return res.json({ success: true, data: await q });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.get('/payroll/leave-requests/count', authorize('payroll', 'view'), async (req, res) => {
  try { const r = await db('mill_leave_requests').where('status', 'pending').count('id as c').first(); return res.json({ success: true, data: { pending: parseInt(r?.c, 10) || 0 } }); }
  catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.get('/payroll/leave-balances', authorize('payroll', 'view'), async (req, res) => {
  try {
    if (!req.query.worker_id) return res.status(400).json({ success: false, message: 'worker_id required.' });
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : new Date().getUTCFullYear();
    return res.json({ success: true, data: await computeLeaveBalances(parseInt(req.query.worker_id, 10), year) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-requests', authorize('payroll', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.worker_id || !b.from_date || !b.to_date) return res.status(400).json({ success: false, message: 'worker, from and to dates are required.' });
    const type = b.leave_type_id ? await db('mill_leave_types').where('id', b.leave_type_id).first() : null;
    const days = inclusiveDays(b.from_date, b.to_date);
    if (days <= 0) return res.status(400).json({ success: false, message: 'Invalid date range.' });
    const [row] = await db('mill_leave_requests').insert({
      worker_id: b.worker_id, leave_type_id: b.leave_type_id || null, from_date: b.from_date, to_date: b.to_date,
      days, paid: type ? !!type.paid : false, reason: b.reason || null,
      status: b.status === 'approved' ? 'approved' : 'pending', approved_by: b.status === 'approved' ? (req.user?.id || null) : null, approved_at: b.status === 'approved' ? db.fn.now() : null,
    }).returning('*');
    if (row.status === 'approved') await markLeaveAttendance(row.worker_id, row.from_date, row.to_date);
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-requests/:id/approve', authorize('payroll', 'approve'), auditAction('approve', 'mill_leave_request', (req) => req.params.id), async (req, res) => {
  try {
    const r = await db('mill_leave_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    const [row] = await db('mill_leave_requests').where('id', r.id).update({ status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    await markLeaveAttendance(row.worker_id, row.from_date, row.to_date);
    return res.json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-requests/:id/reject', authorize('payroll', 'approve'), auditAction('reject', 'mill_leave_request', (req) => req.params.id), async (req, res) => {
  try {
    const r = await db('mill_leave_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    const [row] = await db('mill_leave_requests').where('id', r.id).update({ status: 'rejected', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    if (r.status === 'approved') await markLeaveAttendance(r.worker_id, r.from_date, r.to_date, { remove: true, excludeRequestId: r.id });
    return res.json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.delete('/payroll/leave-requests/:id', authorize('payroll', 'delete'), async (req, res) => {
  try {
    const r = await db('mill_leave_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (r.status === 'approved') await markLeaveAttendance(r.worker_id, r.from_date, r.to_date, { remove: true, excludeRequestId: r.id });
    await db('mill_leave_requests').where('id', r.id).del();
    return res.json({ success: true, data: { deleted: r.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Final settlement (Phase 25) ─────────────────────────────────────────────
const sYmd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));
// Compute the suggested settlement components for a worker (all admin-editable).
async function computeFinalSettlement(workerId) {
  const w = await db('mill_workers').where('id', workerId).first();
  if (!w) return null;
  const today = new Date().toISOString().slice(0, 10);
  const joined = sYmd(w.joined_date); const left = sYmd(w.left_date) || today;
  const serviceYears = joined ? Math.max(0, Math.round(((Date.parse(left) - Date.parse(joined)) / (365.25 * 86400000)) * 100) / 100) : 0;
  const monthly = parseFloat(w.monthly_salary) || 0; const dailyWage = parseFloat(w.daily_wage) || 0;
  const dailyRate = w.pay_type === 'monthly' ? monthly / 30 : dailyWage;
  // Final prorated salary for the month containing left_date (monthly only).
  let finalSalary = 0;
  if (w.pay_type === 'monthly') {
    const ld = new Date(`${left}T00:00:00Z`); const y = ld.getUTCFullYear(); const m = ld.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const empStart = joined && joined > monthStart ? joined : monthStart;
    const empDays = Math.max(0, Math.round((Date.parse(left) - Date.parse(empStart)) / 86400000) + 1);
    finalSalary = Math.round(monthly * Math.min(1, empDays / daysInMonth));
  }
  const balances = await computeLeaveBalances(workerId, new Date(`${left}T00:00:00Z`).getUTCFullYear(), `${left}T00:00:00Z`);
  const leaveLines = balances.filter((b) => b.paid && b.remaining > 0).map((b) => ({ name: b.name, days: b.remaining, amount: Math.round(b.remaining * dailyRate) }));
  const leaveEncashment = leaveLines.reduce((s, l) => s + l.amount, 0);
  const completedYears = Math.floor(serviceYears);
  const gratuity = Math.round(dailyRate * 30 * completedYears);
  const advRow = await db('mill_worker_advances').where('worker_id', workerId).where('status', 'outstanding').select(db.raw('COALESCE(SUM(amount - recovered_amount),0) as o')).first();
  const advancesOutstanding = Math.round(parseFloat(advRow.o) || 0);
  const suggestedNet = Math.max(0, finalSalary + leaveEncashment + gratuity - advancesOutstanding);
  return {
    worker: { id: w.id, name: w.name, role: w.role, cnic: w.cnic, payType: w.pay_type, joinedDate: joined, leftDate: sYmd(w.left_date), monthlySalary: monthly, dailyWage },
    today, left, serviceYears, completedYears, finalSalary, leaveEncashment, leaveLines, gratuity, advancesOutstanding, suggestedNet,
  };
}

router.get('/payroll/final-settlement/:workerId', authorize('payroll', 'view'), async (req, res) => {
  try {
    const data = await computeFinalSettlement(parseInt(req.params.workerId, 10));
    if (!data) return res.status(404).json({ success: false, message: 'Worker not found.' });
    return res.json({ success: true, data });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/payroll/final-settlements', authorize('payroll', 'view'), async (req, res) => {
  try {
    const rows = await db('mill_final_settlements as s').leftJoin('mill_workers as w', 'w.id', 's.worker_id')
      .select('s.*', 'w.name as worker_name', 'w.role as worker_role').orderBy('s.created_at', 'desc');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Payroll activity / audit (Phase 26) — a payroll-scoped slice of the audit
// trail, gated payroll.view (the global /api/audit-logs is admin-only). ──
const PAYROLL_AUDIT_ENTITIES = ['mill_payroll_run', 'statutory_remittance', 'mill_final_settlement', 'mill_leave_request', 'mill_leave_type', 'mill_worker', 'mill_worker_advance', 'mill_worker_request', 'mill_statutory_deduction'];
router.get('/payroll/audit', authorize('payroll', 'view'), async (req, res) => {
  try {
    const { action, user_id, entity_type, date_from, date_to } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    let q = db('audit_logs as a').leftJoin('users as u', 'a.user_id', 'u.id').whereIn('a.entity_type', PAYROLL_AUDIT_ENTITIES);
    if (action) q = q.where('a.action', action);
    if (user_id) q = q.where('a.user_id', user_id);
    if (entity_type) q = q.where('a.entity_type', entity_type);
    if (date_from) q = q.where('a.created_at', '>=', new Date(date_from));
    if (date_to) q = q.where('a.created_at', '<=', new Date(`${String(date_to).slice(0, 10)}T23:59:59`));
    const countRow = await q.clone().clearSelect().count('a.id as c').first();
    const logs = await q.select('a.id', 'a.action', 'a.entity_type', 'a.entity_id', 'a.details', 'a.created_at', 'a.user_id', 'u.full_name as user_name')
      .orderBy('a.created_at', 'desc').limit(limit).offset((page - 1) * limit);
    const actions = await db('audit_logs').whereIn('entity_type', PAYROLL_AUDIT_ENTITIES).distinct('action').orderBy('action').pluck('action');
    return res.json({ success: true, data: { logs, actions, total: parseInt(countRow?.c, 10) || 0, page, limit } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/payroll/final-settlement/:workerId', authorize('payroll', 'pay'),
  auditAction('settle', 'mill_final_settlement', (req) => req.params.workerId),
  async (req, res) => {
  try {
    const w = await db('mill_workers').where('id', req.params.workerId).first();
    if (!w) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const b = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    const finalSalary = Math.max(0, parseFloat(b.final_salary) || 0);
    const leaveEncash = Math.max(0, parseFloat(b.leave_encashment) || 0);
    const gratuity = Math.max(0, parseFloat(b.gratuity) || 0);
    const advances = Math.max(0, parseFloat(b.advances_deducted) || 0);
    const otherDed = Math.max(0, parseFloat(b.other_deductions) || 0);
    const net = Math.max(0, finalSalary + leaveEncash + gratuity - advances - otherDed);
    const method = b.pay_method === 'bank' ? 'bank' : 'cash';
    const settleDate = b.settlement_date || today;
    const leftDate = b.left_date || sYmd(w.left_date) || today;

    // 1) Pay the net out as a salaries expense (reuses 6135/cash GL).
    let expense = null;
    if (net > 0) {
      expense = await expensesService.create({
        expense_type: w.entity === 'general' ? 'general' : 'mill', category: 'salaries', amount: net, currency: 'PKR', expense_date: settleDate,
        description: `Final settlement — ${w.name}`, notes: b.notes || `Final settlement for ${w.name}`,
        pay_now: true, bank_account_id: method === 'bank' ? (b.bank_account_id || null) : null, payment_method: method,
      }, req.user?.id);
    }

    const settlement = await db.transaction(async (trx) => {
      // 2) Clear outstanding advances deducted here (snapshot prior state for reversal).
      const cleared = [];
      if (advances > 0) {
        const outs = await trx('mill_worker_advances').where('worker_id', w.id).where('status', 'outstanding');
        for (const a of outs) { cleared.push({ id: a.id, prior_recovered: parseFloat(a.recovered_amount) || 0, prior_status: a.status }); }
        await trx('mill_worker_advances').where('worker_id', w.id).where('status', 'outstanding')
          .update({ recovered_amount: trx.raw('amount'), status: 'recovered', updated_at: trx.fn.now() });
      }
      const breakdown = { leaveLines: b.breakdown?.leaveLines || null, advancesCleared: cleared };
      const [row] = await trx('mill_final_settlements').insert({
        worker_id: w.id, settlement_date: settleDate, left_date: leftDate, service_years: b.service_years || null,
        final_salary: finalSalary, leave_encashment: leaveEncash, gratuity, advances_deducted: advances, other_deductions: otherDed,
        net_amount: net, pay_method: method, bank_account_id: method === 'bank' ? (b.bank_account_id || null) : null,
        notes: b.notes || null, expense_id: expense?.id || null, breakdown: JSON.stringify(breakdown), created_by: req.user?.id || null,
      }).returning('*');
      // 3) Stamp left_date + deactivate the worker.
      await trx('mill_workers').where('id', w.id).update({ is_active: false, left_date: leftDate, updated_at: trx.fn.now() });
      return row;
    });
    return res.status(201).json({ success: true, data: settlement });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Reverse a settlement — unwind the payout, restore cleared advances, reactivate.
router.delete('/payroll/final-settlements/:id', authorize('payroll', 'pay'),
  auditAction('void', 'mill_final_settlement', (req) => req.params.id),
  async (req, res) => {
  try {
    const s = await db('mill_final_settlements').where('id', req.params.id).first();
    if (!s) return res.status(404).json({ success: false, message: 'Settlement not found.' });
    await db.transaction(async (trx) => {
      let bd = s.breakdown; if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch { bd = {}; } }
      for (const a of (bd?.advancesCleared || [])) {
        await trx('mill_worker_advances').where('id', a.id).update({ recovered_amount: a.prior_recovered, status: a.prior_status || 'outstanding', updated_at: trx.fn.now() });
      }
      if (s.expense_id) await unwindAdvanceExpense(trx, s.expense_id); // reverse cash-out + GL + payable
      await trx('mill_workers').where('id', s.worker_id).update({ is_active: true, updated_at: trx.fn.now() });
      await trx('mill_final_settlements').where('id', s.id).del();
    });
    return res.json({ success: true, data: { deleted: s.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Delete a worker permanently — unwinds every advance's cash-out, then cascades
// attendance + advances (FK onDelete CASCADE) and removes the worker.
router.delete('/workers/:id', authorize('payroll', 'delete'), auditAction('delete', 'mill_worker', (req) => req.params.id), async (req, res) => {
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

    // Only disbursed advances are real money — pending/approved/rejected requests
    // (Batch 6 · item 8) must not inflate the employee ledger.
    const advances = await db('mill_worker_advances').where({ worker_id: workerId, approval_status: 'paid' })
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

// Request a salary advance (Batch 6 · item 8). No cash moves here — an advance
// now needs Owner approval (POST /advances/:id/approve) before Finance disburses
// it (POST /advances/:id/pay). The recovery plan is captured up-front but the
// expense + schedule are created only at pay-time. `status` (the recovery
// lifecycle) stays 'pending' until paid, so recoverAdvancesForWorker and the
// settlement/suggested-deduction reads (which filter status='outstanding') never
// deduct an advance that hasn't been disbursed.
router.post('/workers/:id/advances', authorize('payroll', 'create'), auditAction('advance_requested', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'A positive advance amount is required.' });
    const advance_date = req.body.advance_date || new Date().toISOString().split('T')[0];
    let plan;
    try { plan = buildRecoveryPlan(req.body, amount, advance_date); }
    catch (e) { return res.status(400).json({ success: false, message: e.message }); }

    const [advance] = await db('mill_worker_advances').insert({
      worker_id: worker.id, advance_date, amount,
      recovered_amount: 0, status: 'pending', approval_status: 'pending',
      expense_id: null,
      notes: req.body.notes || null,
      created_by: req.user?.id || null,
      ...plan,
    }).returning('*');
    return res.json({ success: true, data: { advance } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Approve a pending advance — Owner only (ownerApproval gate: the Owner
// self-approves, anyone else must name the authorizing owner). No cash yet.
router.post('/advances/:id/approve', authorize('payroll', 'view'), ownerApproval('salary_advance'),
  auditAction('advance_approved', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const advance = await db('mill_worker_advances').where('id', req.params.id).first();
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });
    if (advance.approval_status !== 'pending') return res.status(409).json({ success: false, message: `Advance is already ${advance.approval_status}.` });
    const [updated] = await db('mill_worker_advances').where('id', advance.id).update({
      approval_status: 'approved', approved_by: req.ownerAuth?.ownerId || req.user?.id || null,
      approved_at: db.fn.now(), reject_reason: null, updated_at: db.fn.now(),
    }).returning('*');
    return res.json({ success: true, data: { advance: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Reject a pending advance (keeps the row for the audit trail; no cash).
router.post('/advances/:id/reject', authorize('payroll', 'approve'),
  auditAction('advance_rejected', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const advance = await db('mill_worker_advances').where('id', req.params.id).first();
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });
    if (advance.approval_status !== 'pending') return res.status(409).json({ success: false, message: `Only a pending advance can be rejected (this one is ${advance.approval_status}).` });
    const [updated] = await db('mill_worker_advances').where('id', advance.id).update({
      approval_status: 'rejected', reject_reason: req.body.reason || null, updated_at: db.fn.now(),
    }).returning('*');
    return res.json({ success: true, data: { advance: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Pay (disburse) an approved advance — Finance (payroll.pay). This is where the
// real cash-out happens: business_expense (category 'salaries', paid now → Money
// Out / GL) + the recovery schedule + flip the advance into the outstanding
// recovery lifecycle so payroll nets it off going forward.
router.post('/advances/:id/pay', authorize('payroll', 'pay'),
  auditAction('advance_paid', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const advance = await db('mill_worker_advances').where('id', req.params.id).first();
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });
    if (advance.approval_status === 'paid') return res.status(409).json({ success: false, message: 'Advance is already paid.' });
    if (advance.approval_status !== 'approved') return res.status(409).json({ success: false, message: 'Advance must be approved before it can be paid.' });
    const worker = await db('mill_workers').where('id', advance.worker_id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const expense = await expensesService.create({
      expense_type: worker.entity === 'general' ? 'general' : 'mill', category: 'salaries', amount: parseFloat(advance.amount), currency: 'PKR',
      expense_date: req.body.pay_date || advance.advance_date,
      description: `Salary advance — ${worker.name}`,
      notes: advance.notes || null,
      vendor_name: worker.name,
      pay_now: true,
      bank_account_id: req.body.bank_account_id || null,
      payment_method: req.body.payment_method || 'cash',
      payment_reference: req.body.payment_reference || null,
    }, req.user?.id);

    const updated = await db.transaction(async (trx) => {
      const [a] = await trx('mill_worker_advances').where('id', advance.id).update({
        approval_status: 'paid', status: 'outstanding', expense_id: expense?.id || null, updated_at: trx.fn.now(),
      }).returning('*');
      const rows = plannedScheduleRows(a);
      if (rows.length) await trx('mill_worker_advance_recovery_schedule').insert(rows);
      return a;
    });
    return res.json({ success: true, data: { advance: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Advance approvals inbox — pending + approved-not-yet-paid across all workers.
router.get('/advances/pending', authorize('payroll', 'view'), async (req, res) => {
  try {
    const rows = await db('mill_worker_advances as a')
      .leftJoin('mill_workers as w', 'w.id', 'a.worker_id')
      .whereIn('a.approval_status', ['pending', 'approved'])
      .orderBy('a.advance_date', 'desc').orderBy('a.id', 'desc')
      .select('a.*', 'w.name as worker_name', 'w.role as worker_role', 'w.entity as worker_entity');
    return res.json({ success: true, data: { advances: rows } });
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
router.delete('/advances/:id', authorize('payroll', 'delete'), auditAction('advance_delete', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
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

// ── Payroll adjustments (bonuses + deductions) ───────────────────────────────
// bonus → added to gross; deduction → subtracted from net. One-off (a period
// YYYY-MM) or recurring (every month). Applied in computePayrollSummary.
router.get('/workers/:id/adjustments', authorize('payroll', 'view'), async (req, res) => {
  try {
    const rows = await db('mill_worker_adjustments').where('worker_id', req.params.id)
      .orderBy('is_active', 'desc').orderBy('id', 'desc');
    return res.json({ success: true, data: { adjustments: rows } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/workers/:id/adjustments', authorize('payroll', 'create'), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const type = req.body.type === 'deduction' ? 'deduction' : 'bonus';
    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'A positive amount is required.' });
    if (!String(req.body.label || '').trim()) return res.status(400).json({ success: false, message: 'A label is required.' });
    const recurring = !!req.body.recurring;
    const period = !recurring && /^\d{4}-\d{2}$/.test(req.body.period || '') ? req.body.period : null;
    if (!recurring && !period) return res.status(400).json({ success: false, message: 'A month (YYYY-MM) is required for a one-off adjustment.' });
    const [adjustment] = await db('mill_worker_adjustments').insert({
      worker_id: worker.id, type, label: String(req.body.label).trim(), amount,
      period: recurring ? null : period, recurring, is_active: true,
      notes: req.body.notes || null, created_by: req.user?.id || null,
    }).returning('*');
    return res.json({ success: true, data: { adjustment } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/adjustments/:id', authorize('payroll', 'delete'), async (req, res) => {
  try {
    const adj = await db('mill_worker_adjustments').where('id', req.params.id).first();
    if (!adj) return res.status(404).json({ success: false, message: 'Adjustment not found.' });
    await db('mill_worker_adjustments').where('id', adj.id).del();
    return res.json({ success: true, data: { deleted: adj.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Statutory deduction RULES (org-level: income tax, EOBI, …) ──────────────
// Applied automatically to every eligible worker by computePayrollSummary.
// Managing rules is an approver/finance act (payroll.approve), not a per-run one.
router.get('/payroll/statutory-deductions', authorize('payroll', 'view'), async (req, res) => {
  try {
    const rows = await db('mill_statutory_deductions').orderBy('sort_order').orderBy('id');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/payroll/statutory-deductions', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, message: 'Name is required.' });
    const code = String(b.code || b.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
    const method = ['percent', 'fixed', 'slab'].includes(b.calc_method) ? b.calc_method : 'percent';
    const [row] = await db('mill_statutory_deductions').insert({
      name: String(b.name).trim(),
      code,
      calc_method: method,
      rate: method === 'percent' ? (parseFloat(b.rate) || 0) : 0,
      fixed_amount: method === 'fixed' ? (parseFloat(b.fixed_amount) || 0) : 0,
      base: b.base === 'basic' ? 'basic' : 'gross',
      slabs: method === 'slab' && Array.isArray(b.slabs) ? JSON.stringify(b.slabs) : null,
      min_gross: parseFloat(b.min_gross) || 0,
      applies_to: ['all', 'monthly', 'daily'].includes(b.applies_to) ? b.applies_to : 'all',
      liability_account_code: String(b.liability_account_code || '2050').slice(0, 20),
      is_active: b.is_active === undefined ? true : !!b.is_active,
      sort_order: parseInt(b.sort_order, 10) || 0,
      notes: b.notes || null,
      created_by: req.user?.id || null,
    }).returning('*');
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.put('/payroll/statutory-deductions/:id', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const existing = await db('mill_statutory_deductions').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, message: 'Rule not found.' });
    const b = req.body || {};
    const method = ['percent', 'fixed', 'slab'].includes(b.calc_method) ? b.calc_method : existing.calc_method;
    const patch = { updated_at: db.fn.now() };
    if (b.name !== undefined) patch.name = String(b.name).trim();
    patch.calc_method = method;
    patch.rate = method === 'percent' ? (parseFloat(b.rate) || 0) : 0;
    patch.fixed_amount = method === 'fixed' ? (parseFloat(b.fixed_amount) || 0) : 0;
    if (b.base !== undefined) patch.base = b.base === 'basic' ? 'basic' : 'gross';
    patch.slabs = method === 'slab' && Array.isArray(b.slabs) ? JSON.stringify(b.slabs) : (method === 'slab' ? existing.slabs : null);
    if (b.min_gross !== undefined) patch.min_gross = parseFloat(b.min_gross) || 0;
    if (b.applies_to !== undefined) patch.applies_to = ['all', 'monthly', 'daily'].includes(b.applies_to) ? b.applies_to : 'all';
    if (b.liability_account_code !== undefined) patch.liability_account_code = String(b.liability_account_code || '2050').slice(0, 20);
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
    if (b.sort_order !== undefined) patch.sort_order = parseInt(b.sort_order, 10) || 0;
    if (b.notes !== undefined) patch.notes = b.notes || null;
    const [row] = await db('mill_statutory_deductions').where('id', existing.id).update(patch).returning('*');
    return res.json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/payroll/statutory-deductions/:id', authorize('payroll', 'approve'), async (req, res) => {
  try {
    const row = await db('mill_statutory_deductions').where('id', req.params.id).first();
    if (!row) return res.status(404).json({ success: false, message: 'Rule not found.' });
    await db('mill_statutory_deductions').where('id', row.id).del();
    return res.json({ success: true, data: { deleted: row.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Statutory liability REMITTANCE (pay withheld tax/EOBI to the authority) ──
// Outstanding = the GL balance of each statutory liability account (Σcredit −
// Σdebit on Posted journals): Phase 12 credits these at payroll; remittance
// debits them back when the money is paid to FBR/EOBI.
async function statutoryAccountOutstanding(code, entity = 'mill') {
  const acc = await db('chart_of_accounts').where('code', code).first();
  if (!acc) return null;
  // Head Office ('general') vs Mill ('mill') — the liability accrues per entity
  // (payroll statutory journals post to the run's entity), so scope by je.entity.
  const t = await db('journal_lines as jl').join('journal_entries as je', 'jl.journal_id', 'je.id')
    .where('jl.account_id', acc.id).where('je.status', 'Posted').where('je.entity', entity)
    .select(db.raw('COALESCE(SUM(jl.credit),0)::numeric as cr'), db.raw('COALESCE(SUM(jl.debit),0)::numeric as dr')).first();
  const outstanding = (parseFloat(t.cr) || 0) - (parseFloat(t.dr) || 0);
  return { code, name: acc.name, accountId: acc.id, outstanding: Math.round(outstanding * 100) / 100 };
}

router.get('/payroll/statutory-liabilities', authorize('payroll', 'view'), async (req, res) => {
  try {
    const entity = req.query.entity === 'general' ? 'general' : 'mill';
    const rules = await db('mill_statutory_deductions').select('liability_account_code');
    const codes = Array.from(new Set([...rules.map((r) => r.liability_account_code || '2050'), '2050', '2055']));
    const out = [];
    for (const c of codes) { const r = await statutoryAccountOutstanding(c, entity); if (r) out.push(r); }
    return res.json({ success: true, data: out });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/payroll/statutory-remittances', authorize('payroll', 'view'), async (req, res) => {
  try {
    const entity = req.query.entity === 'general' ? 'general' : req.query.entity === 'mill' ? 'mill' : null;
    const rq = db('mill_statutory_remittances as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .leftJoin('chart_of_accounts as coa', 'r.account_id', 'coa.id')
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .select('r.*', 'ba.name as bank_name', 'coa.name as account_name', 'u.full_name as created_by_name')
      .orderBy('r.remit_date', 'desc').orderBy('r.id', 'desc');
    if (entity) rq.where('r.entity', entity);
    const rows = await rq;
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/payroll/statutory-remittances', authorize('payroll', 'pay'),
  auditAction('remit', 'statutory_remittance', (req, data) => data.data?.id),
  async (req, res) => {
  try {
    const b = req.body || {};
    const entity = b.entity === 'general' ? 'general' : 'mill'; // Head Office vs Mill
    const code = String(b.liability_account_code || '2050');
    const amount = parseFloat(b.amount) || 0;
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    const acc = await db('chart_of_accounts').where('code', code).first();
    if (!acc) return res.status(400).json({ success: false, message: `Unknown liability account ${code}.` });
    const cash = await db('chart_of_accounts').where('code', '1000').first();
    if (!cash) return res.status(400).json({ success: false, message: 'Cash & Bank control account (1000) missing.' });
    const method = b.pay_method === 'bank' ? 'bank' : 'cash';
    const remitDate = b.remit_date || new Date().toISOString().slice(0, 10);

    const row = await db.transaction(async (trx) => {
      // Don't let a remittance exceed the outstanding liability (M4) — that would
      // drive 2050/2055 net-debit (the authority "owing" us). Compute Σcredit −
      // Σdebit over Posted entries for this account inside the trx.
      const bal = await trx('journal_lines as jl').join('journal_entries as je', 'jl.journal_id', 'je.id')
        .where('jl.account_id', acc.id).where('je.status', 'Posted').where('je.entity', entity)
        .select(db.raw('COALESCE(SUM(jl.credit),0)::numeric as cr'), db.raw('COALESCE(SUM(jl.debit),0)::numeric as dr')).first();
      const outstanding = Math.round(((parseFloat(bal.cr) || 0) - (parseFloat(bal.dr) || 0)) * 100) / 100;
      if (amount - outstanding > 0.01) {
        const e = new Error(`Amount ${amount} exceeds the outstanding ${acc.name} liability of ${outstanding}.`); e.statusCode = 400; throw e;
      }
      const acctId = method === 'bank' ? (b.bank_account_id || null) : await resolveCashAccountId(trx, { entity });
      // Collision-safe STR number (M3): MAX trailing-digit + 1, not MAX(id)+1 —
      // the latter regenerates an existing number after a delete (see nextDocNo).
      const remitNo = await nextDocNo(trx, { table: 'mill_statutory_remittances', column: 'remittance_no', prefix: 'STR-', pad: 4 });
      const [r] = await trx('mill_statutory_remittances').insert({
        remittance_no: remitNo, liability_account_code: code, account_id: acc.id, amount, entity,
        pay_method: method, bank_account_id: acctId, remit_date: remitDate,
        reference: b.reference || null, authority: b.authority || null,
        period_from: b.period_from || null, period_to: b.period_to || null,
        notes: b.notes || null, created_by: req.user?.id || null,
      }).returning('*');

      // GL: DR liability / CR Cash & Bank.
      const journal = await accountingService.createJournal(trx, {
        date: remitDate, entity, refType: 'Statutory Remittance', refNo: remitNo,
        description: `Remit ${acc.name}${b.authority ? ` to ${b.authority}` : ''}${b.reference ? ` (${b.reference})` : ''}`,
        currency: 'PKR', fxRate: 1, isAuto: true, userId: req.user?.id || null,
        lines: [
          { account_id: acc.id, account: acc.name, debit: amount, credit: 0, narration: `DR ${acc.code} ${acc.name} — remittance ${remitNo}` },
          { account_id: cash.id, account: cash.name, debit: 0, credit: amount, narration: `CR ${cash.code} ${cash.name} — remittance ${remitNo}` },
        ],
      });
      if (journal?.id) await accountingService.postJournal(trx, journal.id);

      // Move the cash/bank account + record the outflow on its ledger.
      if (acctId) {
        await trx('bank_accounts').where('id', acctId).update({ current_balance: trx.raw('current_balance - ?', [amount]), updated_at: trx.fn.now() });
        const acctRow = await trx('bank_accounts').where('id', acctId).first();
        const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-' });
        await trx('bank_transactions').insert({
          transaction_no: btNo, bank_account_id: acctId, type: 'debit', amount, currency: 'PKR',
          status: 'posted', transaction_date: remitDate, reference: remitNo,
          notes: `Statutory remittance ${remitNo}${b.authority ? ` — ${b.authority}` : ''}`,
          source: 'statutory_remittance', running_balance: acctRow ? acctRow.current_balance : null,
          category: 'statutory', counterparty: b.authority || null, created_by: req.user?.id || null,
        });
      }
      await trx('mill_statutory_remittances').where('id', r.id).update({ journal_id: journal?.id || null });
      return { ...r, journal_id: journal?.id || null };
    });
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});

// Reverse a remittance — undo the GL, restore the bank balance, drop the bank
// transaction, and delete the record.
router.delete('/payroll/statutory-remittances/:id', authorize('payroll', 'pay'),
  auditAction('void', 'statutory_remittance', (req) => req.params.id),
  async (req, res) => {
  try {
    const row = await db('mill_statutory_remittances').where('id', req.params.id).first();
    if (!row) return res.status(404).json({ success: false, message: 'Remittance not found.' });
    await db.transaction(async (trx) => {
      if (row.bank_account_id) await trx('bank_accounts').where('id', row.bank_account_id).increment('current_balance', parseFloat(row.amount) || 0);
      await trx('bank_transactions').where({ reference: row.remittance_no, source: 'statutory_remittance' }).del();
      await trx('journal_lines').whereIn('journal_id', trx('journal_entries').where('ref_no', row.remittance_no).select('id')).del();
      await trx('journal_entries').where('ref_no', row.remittance_no).del();
      await trx('mill_statutory_remittances').where('id', row.id).del();
    });
    return res.json({ success: true, data: { deleted: row.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Year-end tax statement (Pakistani tax year: Jul Y – Jun Y+1) ────────────
// Per-employee annual salary + tax-withheld summary built from the PAID payroll
// line snapshots, for the salary / tax-deduction certificate (u/s 149).
router.get('/payroll/tax-statement', authorize('payroll', 'view'), async (req, res) => {
  try {
    // Resolve the tax year — "2025-26" / "2025" / (default) the current FY.
    let startYear;
    const m = String(req.query.tax_year || '').match(/(\d{4})/);
    if (m) startYear = parseInt(m[1], 10);
    else { const now = new Date(); startYear = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; }
    const periodFrom = `${startYear}-07`;
    const periodTo = `${startYear + 1}-06`;
    const taxYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

    const entity = req.query.entity === 'general' ? 'general' : 'mill'; // Head Office vs Mill
    const lines = await db('mill_payroll_lines as pl')
      .join('mill_payroll_runs as r', 'pl.run_id', 'r.id')
      .leftJoin('mill_workers as w', 'pl.worker_id', 'w.id')
      // Paid lines only — counts an employee's pay once it's actually paid, incl.
      // the paid portion of a partially_paid run.
      .where(function () { this.whereNotNull('pl.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .whereNotNull('pl.worker_id')
      .where('r.entity', entity)
      .where('r.period', '>=', periodFrom).where('r.period', '<=', periodTo)
      .select('pl.*', 'r.period', 'r.pay_date',
        'w.cnic', 'w.phone', 'w.joined_date', 'w.pay_type as w_pay_type', 'w.name as w_name', 'w.role as w_role');

    const byWorker = new Map();
    for (const l of lines) {
      let e = byWorker.get(l.worker_id);
      if (!e) {
        e = { workerId: l.worker_id, name: l.w_name || l.worker_name, cnic: l.cnic || null, phone: l.phone || null, role: l.w_role || l.role || null, payType: l.w_pay_type || l.pay_type || null, joinedDate: l.joined_date || null, months: [], totals: { gross: 0, statutory: 0, advance: 0, net: 0, byStatutory: {} } };
        byWorker.set(l.worker_id, e);
      }
      const gross = (parseFloat(l.gross_pay) || 0) + (parseFloat(l.bonus_total) || 0);
      const stat = parseFloat(l.statutory_total) || 0;
      const adv = parseFloat(l.advance_deducted) || 0;
      const net = parseFloat(l.net_pay) || 0;
      let sj = l.statutory_json; if (typeof sj === 'string') { try { sj = JSON.parse(sj); } catch { sj = []; } } if (!Array.isArray(sj)) sj = [];
      const mBreak = {};
      for (const s of sj) { const nm = s.name || 'Statutory'; mBreak[nm] = (mBreak[nm] || 0) + (parseFloat(s.amount) || 0); e.totals.byStatutory[nm] = (e.totals.byStatutory[nm] || 0) + (parseFloat(s.amount) || 0); }
      e.months.push({ period: l.period, payDate: l.pay_date, gross: Math.round(gross), statutory: Math.round(stat), statutoryBreakdown: mBreak, advance: Math.round(adv), net: Math.round(net) });
      e.totals.gross += gross; e.totals.statutory += stat; e.totals.advance += adv; e.totals.net += net;
    }
    const employees = [...byWorker.values()].map((e) => {
      e.months.sort((a, b) => (a.period < b.period ? -1 : 1));
      ['gross', 'statutory', 'advance', 'net'].forEach((k) => { e.totals[k] = Math.round(e.totals[k]); });
      Object.keys(e.totals.byStatutory).forEach((k) => { e.totals.byStatutory[k] = Math.round(e.totals.byStatutory[k]); });
      e.totals.monthsPaid = e.months.length;
      return e;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const grand = employees.reduce((g, e) => ({ gross: g.gross + e.totals.gross, statutory: g.statutory + e.totals.statutory, advance: g.advance + e.totals.advance, net: g.net + e.totals.net }), { gross: 0, statutory: 0, advance: 0, net: 0 });
    return res.json({ success: true, data: { taxYear, periodFrom, periodTo, employees, grand } });
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

// Bulk CSV attendance import (Phase 21). Unlike /attendance/bulk (which forces a
// single status across a day and zeroes OT), this upserts status + hours + OVER-
// TIME per row — for importing a whole month from a biometric/timesheet export.
// The FE resolves CNIC/name → worker_id and validates; the server re-validates.
router.post('/attendance/import', authorize('payroll', 'create'), async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || !records.length) return res.status(400).json({ success: false, message: 'records[] required.' });
    if (records.length > 5000) return res.status(400).json({ success: false, message: 'Too many rows (max 5000 per import).' });
    const validIds = new Set((await db('mill_workers').select('id')).map((r) => r.id));
    let imported = 0; const errors = [];
    await db.transaction(async (trx) => {
      for (let i = 0; i < records.length; i += 1) {
        const r = records[i] || {};
        const wid = parseInt(r.worker_id, 10);
        const date = String(r.date || '').slice(0, 10);
        const status = String(r.status || '').toLowerCase();
        const ot = Math.max(0, parseFloat(r.overtime_hours) || 0);
        if (!validIds.has(wid)) { errors.push({ row: r.row || i + 1, reason: 'Unknown worker' }); continue; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ row: r.row || i + 1, reason: 'Invalid date' }); continue; }
        if (!VALID_ATTENDANCE.includes(status)) { errors.push({ row: r.row || i + 1, reason: `Invalid status "${r.status}"` }); continue; }
        await trx('mill_attendance').insert({ worker_id: wid, date, status, hours_worked: attHours(status), overtime_hours: ot })
          .onConflict(['worker_id', 'date']).merge(['status', 'hours_worked', 'overtime_hours', 'updated_at']);
        imported += 1;
      }
    });
    return res.json({ success: true, data: { imported, skipped: errors.length, errors: errors.slice(0, 50) } });
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
    const entity = req.query.entity === 'general' ? 'general' : 'mill';
    const data = await computePayrollSummary(req.query.month, entity);
    const status = await committedWorkerStatus(req.query.month, entity);
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
  const workers = await db('mill_workers').whereIn('id', ids).select('id', 'cnic', 'phone', 'joined_date', 'bank_name', 'bank_account_number', 'iban');
  const wMap = new Map(workers.map((w) => [w.id, w]));
  const advRows = await db('mill_worker_advances').whereIn('worker_id', ids).where('status', 'outstanding')
    .groupBy('worker_id').select('worker_id', db.raw('COALESCE(SUM(amount - recovered_amount),0) as outstanding'));
  const advMap = new Map(advRows.map((r) => [r.worker_id, parseFloat(r.outstanding) || 0]));
  return lines.map((l) => ({
    ...l,
    cnic: (wMap.get(l.worker_id) || {}).cnic || null,
    phone: (wMap.get(l.worker_id) || {}).phone || null,
    joined_date: (wMap.get(l.worker_id) || {}).joined_date || null,
    bank_name: (wMap.get(l.worker_id) || {}).bank_name || null,
    bank_account_number: (wMap.get(l.worker_id) || {}).bank_account_number || null,
    iban: (wMap.get(l.worker_id) || {}).iban || null,
    advance_outstanding: advMap.get(l.worker_id) || 0,
  }));
}

router.get('/payroll/runs', authorize('payroll', 'view'), async (req, res) => {
  try {
    const entity = req.query.entity === 'general' ? 'general' : req.query.entity === 'mill' ? 'mill' : null;
    const q = db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .leftJoin('users as up', 'up.id', 'r.created_by')
      .leftJoin('users as ua', 'ua.id', 'r.approved_by')
      .leftJoin('users as upd', 'upd.id', 'r.paid_by')
      .leftJoin('users as uac', 'uac.id', 'r.accrued_by')
      .select('r.*', 'ba.name as bank_name', 'up.full_name as prepared_by_name', 'ua.full_name as approved_by_name', 'upd.full_name as paid_by_name', 'uac.full_name as accrued_by_name')
      .orderBy('r.period', 'desc').orderBy('r.id', 'desc');
    if (entity) q.where('r.entity', entity);
    const runs = await q;
    return res.json({ success: true, data: { runs } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Payroll report — every run (optionally within a from..to period range) with
// its payslip lines nested, plus grand totals. One pass over runs + lines.
router.get('/payroll/report', authorize('payroll', 'view'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const entity = req.query.entity === 'general' ? 'general' : req.query.entity === 'mill' ? 'mill' : null;
    let q = db('mill_payroll_runs as r')
      .leftJoin('bank_accounts as ba', 'r.bank_account_id', 'ba.id')
      .select('r.*', 'ba.name as bank_name')
      .orderBy('r.period', 'desc').orderBy('r.id', 'desc');
    if (from) q = q.where('r.period', '>=', from);
    if (to) q = q.where('r.period', '<=', to);
    if (entity) q = q.where('r.entity', entity);
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
      .leftJoin('users as uac', 'uac.id', 'r.accrued_by')
      .select('r.*', 'ba.name as bank_name', 'up.full_name as prepared_by_name', 'ua.full_name as approved_by_name', 'upd.full_name as paid_by_name', 'uac.full_name as accrued_by_name')
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
    const { month, pay_method, bank_account_id, pay_date, notes, lines, entity } = req.body;
    const run = await preparePayrollRun({ month, lines, pay_method, bank_account_id, pay_date, notes, entity }, req.user?.id);
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
    if (!['approved', 'partially_paid'].includes(run.status)) return res.status(409).json({ success: false, message: `Only an Approved or Partially-Paid run can be paid (this run is ${run.status}).` });

    // Target the UNPAID lines — all of them, or just the selected `line_ids`
    // (partial payment). Paying with no selection settles whatever remains.
    const allLines = await db('mill_payroll_lines').where('run_id', run.id);
    const unpaid = allLines.filter((l) => !l.paid_at);
    let target = unpaid;
    const ids = Array.isArray(req.body?.line_ids) ? req.body.line_ids.map(Number).filter(Boolean) : null;
    if (ids && ids.length) {
      const set = new Set(ids);
      target = unpaid.filter((l) => set.has(l.id));
      if (!target.length) return res.status(400).json({ success: false, message: 'None of the selected employees are unpaid.' });
    }
    if (!target.length) return res.status(409).json({ success: false, message: 'Every employee in this run is already paid.' });

    const updated = await payLineBatch(run, target, req.user?.id);
    return res.json({ success: true, data: { run: updated, paidCount: target.length } });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});

// ACCRUE an approved run (alternative to immediate Pay) — books the salary
// EXPENSE + LIABILITY now (DR 6135 Salaries & Wages / CR 2040 Salaries Payable)
// and recovers advances, but moves NO cash. The run sits as 'accrued' until it
// is Settled. Gate: payroll.approve (committing the liability is an approver act).
router.post('/payroll/runs/:id/accrue', authorize('payroll', 'approve'),
  auditAction('accrue', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const pre = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!pre) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (pre.status !== 'approved') return res.status(409).json({ success: false, message: `Only an Approved run can be accrued (this run is ${pre.status}).` });

    // Do everything in ONE locked transaction so the accrued expense + advance
    // recovery + statutory journal + run flip commit atomically, and a concurrent
    // accrue/pay can't double-book (M1). The expense is created inside the trx (so
    // a later failure rolls it back too), and statutory is not swallowed (M2).
    const updated = await db.transaction(async (trx) => {
      const run = await trx('mill_payroll_runs').where('id', req.params.id).forUpdate().first();
      if (!run || run.status !== 'approved') {
        const e = new Error(`Only an Approved run can be accrued (status ${run?.status || 'missing'}).`); e.statusCode = 409; throw e;
      }
      const lines = await trx('mill_payroll_lines').where('run_id', run.id);
      const netTotal = parseFloat(run.net_total) || 0;

      let expense = null;
      if (netTotal > 0) {
        expense = await expensesService.create({
          expense_type: run.entity === 'general' ? 'general' : 'mill', category: 'salaries', amount: netTotal, currency: 'PKR',
          expense_date: run.pay_date,
          description: `Salaries (accrued) — payroll run ${run.period}`,
          notes: run.notes || `Payroll ${run.period}: ${run.employee_count} employee(s) · net ${netTotal} (accrued)`,
          pay_now: false,
        }, req.user?.id, trx);
      }

      for (const l of lines) {
        const ded = parseFloat(l.advance_deducted) || 0;
        if (ded > 0 && l.worker_id) await recoverAdvancesForWorker(trx, l.worker_id, ded, { period: run.period, runId: run.id, lineId: l.id });
        if (l.skip_reason && l.worker_id) await markPeriodSkipped(trx, l.worker_id, run.period, l.skip_reason);
      }
      await postRunStatutoryJournal(trx, run, req.user?.id, lines, expense ? `STAT-EXP-${expense.id}` : `STAT-RUN-${run.id}`);
      const [r] = await trx('mill_payroll_runs').where('id', run.id)
        .update({ status: 'accrued', expense_id: expense?.id || null, accrued_by: req.user?.id || null, accrued_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*');
      return r;
    });
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});

// SETTLE an accrued run — NOW the cash moves: pay the pending salaries payable
// (DR 2040 Salaries Payable / CR Cash & Bank) via the run's stored pay method/
// account. Advances were already recovered at accrual. Gate: payroll.pay.
router.post('/payroll/runs/:id/settle', authorize('payroll', 'pay'),
  auditAction('settle', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (run.status !== 'accrued') return res.status(409).json({ success: false, message: `Only an Accrued run can be settled (this run is ${run.status}).` });

    // Settle the accrued payable (no-op if a zero-net run had no expense).
    if (run.expense_id) {
      await expensesService.markPaid(run.expense_id, {
        bank_account_id: run.bank_account_id || null,
        payment_method: run.pay_method || 'cash',
        paid_date: run.pay_date,
      }, req.user?.id);
    }
    const [updated] = await db('mill_payroll_runs').where('id', run.id)
      .update({ status: 'paid', paid_by: req.user?.id || null, paid_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
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
    // just delete it (lines cascade). Paid/posted/accrued AND partially_paid
    // (one or more cash batches) runs need full reversal.
    if (!['paid', 'posted', 'accrued', 'partially_paid'].includes(run.status)) {
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
          // Only un-recover lines whose advance was actually recovered: a paid line
          // (recovery happens at pay), or any line on an accrued/settled run
          // (recovery happens at accrue). An unpaid line on a partially-paid run
          // never recovered, so don't reverse it (L1). NOTE: settle writes run
          // status 'paid' (stamping paid_at on the RUN, not the lines), so an
          // accrued→settled run reads as 'paid' with line.paid_at NULL — include
          // 'paid' here so voiding it still un-recovers (was the dead 'settled').
          const wasRecovered = l.paid_at || ['accrued', 'paid', 'posted'].includes(run.status);
          if (parseFloat(l.advance_deducted) > 0 && l.worker_id && wasRecovered) {
            await unrecoverAdvancesForWorker(trx, l.worker_id, l.advance_deducted);
          }
        }
      }
      // Reverse EVERY salaries expense the run created (one per pay batch +
      // run.expense_id for accrued/legacy single-batch runs) and each batch's
      // statutory journal (ref STAT-EXP-<expenseId>).
      const expIds = new Set();
      if (run.expense_id) expIds.add(run.expense_id);
      const lineExp = await trx('mill_payroll_lines').where('run_id', run.id).whereNotNull('expense_id').distinct('expense_id');
      for (const r of lineExp) expIds.add(r.expense_id);
      for (const expId of expIds) {
        await unwindAdvanceExpense(trx, expId); // reverse cash-out + GL + payable
        await trx('journal_lines').whereIn('journal_id', trx('journal_entries').where('ref_no', `STAT-EXP-${expId}`).select('id')).del();
        await trx('journal_entries').where('ref_no', `STAT-EXP-${expId}`).del();
      }
      // Legacy / accrued statutory journal (DR 6135 / CR liabilities).
      await trx('journal_lines').whereIn('journal_id', trx('journal_entries').where('ref_no', `STAT-RUN-${run.id}`).select('id')).del();
      await trx('journal_entries').where('ref_no', `STAT-RUN-${run.id}`).del();
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
