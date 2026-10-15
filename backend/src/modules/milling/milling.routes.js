const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const controller = require('../../controllers/millingController');
const advancedController = require('../../controllers/millingAdvancedController');
const authorize = require('../../middleware/rbac');
const { authorizeRole } = require('../../middleware/rbac');
const retired = require('../../middleware/retired');
const { lacksFinancePayment } = require('../../shared/millPayer');
// The mill's money — expenses, the rice-purchase (rate) ledger, the mill cash
// account and batch profitability — needs reports.view_cost or finance.view.
// The Mill Operator holds view_cost since mig 314 (owner decision 2026-10-05:
// "see everything regarding the mill"); the QC Analyst / Inventory Officer /
// Documentation Officer do not, so they never see it. Company-wide finance is
// closed to the Mill Operator by role in the reporting + ai modules, not here:
// nothing in this router is company-wide.
const { requireCostVisibility, redactCostInResponses } = require('../../utils/costVisibility');
// Payroll routes are gated by the dedicated `payroll.*` permission module
// (migration 203). Mill Operator holds no payroll permissions, so the old
// denyRoles('Mill Operator') guard is no longer needed.
const auditAction = require('../../middleware/audit');
const auditService = require('../admin/audit.service');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const ownerApproval = require('../../middleware/ownerApproval');
const aiService = require('../ai/ai.service');
const { pickBatchEdits } = require('./batchLifecycle');
const { listRicePurchases } = require('./ricePurchasesLedger');
const { listQualityComparison } = require('./qualityVariance');
const { batchYielded, ricePurchaseBooked, assertBatchOutputsUnsold } = require('./costEditLocks');
const { reverseExpenseTrail, reverseStatutoryJournal, remittedStatutoryForRun, mirrorJournals } = require('./payrollReversal');
// One rule for paid / earned / pending payslip lines in every payroll report (P4-08).
const payrollLineStatus = require('./payrollLineStatus');
const { buildLastPrices, findImplausiblePrices, implausiblePriceMessage } = require('./byproductPrices');

// =============================================================================
// Existing Batch Routes
// =============================================================================

router.get('/batches', authorize('milling', 'view'), controller.list);
// Quality Comparison: every batch's latest sample / arrival analysis and its
// stored variance in one call (was 50 parallel detail fetches, MIL-36).
// Agreed prices are nulled for cost-blind roles (e.g. the QC Analyst).
router.get('/quality-comparison', authorize('milling', 'view'), redactCostInResponses(), async (req, res) => {
  try {
    const batches = await listQualityComparison(db, req.query);
    return res.json({ success: true, data: { batches } });
  } catch (err) {
    console.error('Quality comparison list error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
// Service-milling (toll/job-work) dashboard feed — gated by the dedicated
// service_milling.view perm (Milling/Inventory roles), not the generic milling perm.
router.get('/service-batches', authorize('service_milling', 'view'), controller.listServiceBatches);
router.get('/batches/:id', authorize('milling', 'view'), controller.getById);
router.put('/batches/:id', authorize('milling', 'edit'),
  validate(schemas.updateBatch),
  auditAction('update_batch', 'milling_batch', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = /^\d+$/.test(req.params.id) ? parseInt(req.params.id)
        : (await db('milling_batches').where('batch_no', req.params.id).select('id').first())?.id;
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found' });

      // 'status' is NOT editable here — milling.edit (which Mill Operator
      // holds) could otherwise complete a batch without yield or reopen one.
      // Status moves through /hold, /resume, /cancel, /approve, /reject, /yield.
      const updates = pickBatchEdits(req.body);
      // Once the yield is recorded, the raw qty is what the yield was measured
      // against, the supplier is who the purchase was booked to and the fee is
      // in the capitalised cost — changing them here re-wrote a posted batch
      // with no payable / GL change (P2-08 / MIL-38). Unchanged values pass.
      const current = await db('milling_batches').where({ id }).first();
      if (!current) return res.status(404).json({ success: false, message: 'Batch not found' });
      const LOCKED_AFTER_YIELD = ['raw_qty_kg', 'supplier_id', 'milling_fee_per_kg'];
      const changed = LOCKED_AFTER_YIELD.filter((k) => updates[k] !== undefined
        && String(updates[k] ?? '') !== String(current[k] ?? '')
        && !(updates[k] != null && current[k] != null && Math.abs(Number(updates[k]) - Number(current[k])) < 1e-6));
      // A reversed yield (P3-03) keeps its booked rice purchase, so the
      // figures it was booked at stay locked too.
      if (changed.length && (await batchYielded(db, current) || await ricePurchaseBooked(db, current))) {
        return res.status(409).json({
          success: false,
          message: `Batch ${current.batch_no} already has its yield recorded — its ${changed.map((k) => ({ raw_qty_kg: 'raw quantity', supplier_id: 'supplier', milling_fee_per_kg: 'milling fee' }[k])).join(', ')} can no longer be changed.`,
        });
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
  // A service (toll) lot also needs the dedicated service-milling permission.
  (req, res, next) => (req.body && req.body.is_service_milling
    ? authorize('service_milling', 'create_batch')(req, res, next)
    : next()),
  auditAction('create', 'milling_batch', (req, data) => data.data && data.data.batch ? data.data.batch.id : null),
  controller.create
);
router.post(
  '/batches/:id/hold',
  authorize('milling', 'edit'),
  auditAction('hold_batch', 'milling_batch', (req) => req.params.id),
  controller.holdBatch
);
router.post(
  '/batches/:id/resume',
  authorize('milling', 'edit'),
  auditAction('resume_batch', 'milling_batch', (req) => req.params.id),
  controller.resumeBatch
);
// Cancel releases the source-lot holds; refused (409) once yield exists.
router.post(
  '/batches/:id/cancel',
  authorize('milling', 'edit'),
  auditAction('cancel_batch', 'milling_batch', (req) => req.params.id),
  controller.cancelBatch
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
// Reverse a recorded yield (P3-03 / MIL-20): Owner approval + a mandatory
// reason; refused once any output has been sold, reserved, moved or (service)
// dispatched / invoiced. Nothing is deleted — every step is a new movement or
// a signed-delta journal.
router.post(
  '/batches/:id/reverse-yield',
  authorize('milling', 'record_yield'),
  ownerApproval('milling_yield_reversal'),
  validate(schemas.reverseYield),
  auditAction('reverse_yield', 'milling_batch', (req) => req.params.id),
  controller.reverseYield
);
router.post(
  '/batches/:id/costs',
  authorize('milling', 'manage_costs'),
  auditAction('add_cost', 'milling_batch', (req) => req.params.id),
  controller.addCost
);
// The whole Costs drawer in ONE transaction (P3-07 / MIL-35).
router.post(
  '/batches/:id/costs/bulk',
  authorize('milling', 'manage_costs'),
  validate(schemas.millingCostsBulk),
  auditAction('add_costs_bulk', 'milling_batch', (req) => req.params.id),
  controller.addCostsBulk
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
// Operator declares how much of a service lot to mill (rest stays unmilled).
// A production decision — gated by record_yield, which mill operators hold.
router.put(
  '/batches/:id/milled-qty',
  authorize('milling', 'record_yield'),
  auditAction('set_milled_qty', 'milling_batch', (req) => req.params.id),
  controller.setMilledQty
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
router.get('/rice-purchases', authorize('milling', 'view'), requireCostVisibility, async (req, res) => {
  try {
    // KG × Rs/kg; lot-first trucks resolve supplier / variety via their lot
    // (P3-14). See ricePurchasesLedger.js.
    const data = await listRicePurchases(db, req.query);
    return res.json({ success: true, data });
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
// milling.delete (mig 339): Super Admin + Mill Manager as before, and the Owner.
router.delete(
  '/batches/:id',
  authorize('milling', 'delete'),
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
// RETIRED (410): no screen; it moved the linked batch to In Progress from any
// status but Completed — a Cancelled batch came back yieldable.
router.put(
  '/plans/:id/start',
  retired('Starting a production plan is retired. Start milling from the batch.'),
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

// The MILL cash account only: payments on entity='mill' payables, receipts on
// mill local sales, Head Office ⇄ Mill transfers and the mill cash float.
router.get('/cash-flow', authorize('milling', 'view'), requireCostVisibility, advancedController.cashFlow);
// Mill Finance KPIs (P4-01 / P4-02, docs/AGRIRICE_KPI_CONTRACTS.md): the D-13
// mill profit headline, production value (secondary), yield and working
// capital for a period (?period=month|quarter|fytd|fy|all|custom&from=&to=),
// and the rows behind each figure (/detail?part=sales|overheads|batches|stock).
// Profit and stock value are cost figures: View cost is required.
router.get('/finance-kpis', authorize('milling', 'view'), requireCostVisibility, async (req, res) => {
  try {
    const { millFinanceKpis } = require('../kpi/millFinance');
    const { period, from, to } = req.query;
    return res.json({ success: true, data: await millFinanceKpis(db, { period, from, to }) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
    console.error('finance-kpis error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});
// yield.v1 alone (quantities, no money) — no View cost needed.
router.get('/kpi/yield', authorize('milling', 'view'), async (req, res) => {
  try {
    const { yieldKpi } = require('../kpi/millFinance');
    const { period, from, to } = req.query;
    return res.json({ success: true, data: await yieldKpi(db, { period: period || 'all', from, to }) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
    console.error('kpi/yield error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});
router.get('/finance-kpis/detail', authorize('milling', 'view'), requireCostVisibility, async (req, res) => {
  try {
    const { millFinanceDetail } = require('../kpi/millFinance');
    const { part, period, from, to, page, limit } = req.query;
    return res.json({ success: true, data: await millFinanceDetail(db, { part, period, from, to, page, limit }) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
    console.error('finance-kpis detail error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});
router.get('/cost-trend', authorize('milling', 'view'), requireCostVisibility, controller.costTrend);
// Mill Finance ▸ Suppliers / Customers for mill roles without finance.view (the
// Mill Operator, owner decision 2026-10-05): the mill's OWN payables and
// receivables, read-only. Same handlers and response shape as /finance/payables
// and /finance/receivables, restricted to entity 'mill'. Paying stays on the
// finance routes (finance.confirm_payment).
const financeController = require('../finance/finance.controller');
router.get('/payables', authorize('milling', 'view'), requireCostVisibility, financeController.getMillPayables);
router.get('/receivables', authorize('milling', 'view'), requireCostVisibility, financeController.getMillReceivables);
// The mill's own cash / bank accounts for the payment pickers (a mill-only payer
// can pay only through these). Balances only with reports.view_cost.
router.get('/bank-accounts', authorize('milling', 'view'), financeController.getMillBankAccounts);
router.get('/batches/:id/source-lots', authorize('milling', 'view'), advancedController.listSourceLots);
// No POST: source lots join a batch only at creation (commitLotToBatch). The old
// add-source-lot route had no caller and linked a lot without reserving it.

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
// RETIRED (410): no screen; it issued stock out of the output lot with no
// GL, and completing it created no output lot (the rice vanished).
router.post(
  '/reprocessing',
  retired('Reprocessing is retired. Re-mill rice through a new milling batch.'),
  authorize('milling', 'create'),
  auditAction('create', 'reprocessing_batch', (req, data) => data.data && data.data.reprocessing ? data.data.reprocessing.id : null),
  advancedController.createReprocessing
);
router.put(
  '/reprocessing/:id/complete',
  retired('Reprocessing is retired. Re-mill rice through a new milling batch.'),
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

// Utility readings carry rate_per_unit / total_cost — redacted for cost-blind roles.
router.get('/utilities', authorize('milling', 'view'), redactCostInResponses(), advancedController.listUtilities);
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
router.get('/analytics/batch-profitability/:id', authorize('milling', 'view'), requireCostVisibility, advancedController.analyticsBatchProfitability);

// =============================================================================
// Product Pricing — confirm byproduct prices per batch
// =============================================================================

// Last confirmed per-kg prices (finished cost included). Its keys are bare grade
// names (finished, b1, bran…), so the whole object is named as money.
router.get('/last-prices', authorize('milling', 'view'), redactCostInResponses({ extraCostKeys: ['lastPrices'] }), async (req, res) => {
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

    // Per-KG throughout. buildLastPrices drops any stored value above the
    // per-kg ceiling (a per-MT figure saved by mistake) so it is never copied
    // forward into the next batch, and falls back to per-KG defaults.
    return res.json({
      success: true,
      data: { lastPrices: buildLastPrices(last) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Confirming by-product prices + manual costs re-costs the batch's outputs, so it
// needs reports.view_cost like every other cost input (the drawer is cost-gated).
router.put('/batches/:id/prices', authorize('milling', 'edit'), requireCostVisibility,
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
        // manual_milling_cost_pkr / manual_other_expenses_pkr are read below —
        // only clearing a legacy override is accepted. Finished price is DERIVED.
      } = req.body;

      // Every price here is per KG. A per-MT figure (1000× too large) would
      // credit the by-products at a thousand times their value and, through
      // the residual engine, zero the finished cost — refuse it outright.
      const implausible = findImplausiblePrices(req.body);
      if (implausible.length) {
        return res.status(400).json({ success: false, message: implausiblePriceMessage(implausible), fields: implausible.map((b) => b.field) });
      }

      // 0 is a valid manual cost; only blank/invalid → null.
      const current = await db('milling_batches').where({ id }).first();
      if (!current) return res.status(404).json({ success: false, message: 'Batch not found.' });

      // One cost source (P2-08 / MIL-03): milling and other costs are the
      // itemised cost-sheet lines (Costs tab), which post their own journals. A
      // manual total here re-valued the output lots with no journal and froze
      // later costs out of the lot value, so a NEW manual figure is refused. A
      // legacy override may only be CLEARED (back to the itemised lines the GL
      // already holds); resending the stored value, or omitting it, is a no-op.
      const posOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
      const manualUpdate = {};
      for (const k of ['manual_milling_cost_pkr', 'manual_other_expenses_pkr']) {
        if (req.body[k] === undefined) continue;
        const next = posOrNull(req.body[k]);
        const cur = posOrNull(current[k]);
        if (next == null ? cur == null : (cur != null && Math.abs(next - cur) < 0.01)) continue;
        if (next != null) {
          return res.status(400).json({
            success: false,
            message: 'Milling and other costs are entered as itemised lines on the Costs tab, not as a total here — add the cost there so it is booked in the accounts.',
          });
        }
        manualUpdate[k] = null;
      }

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
        ...manualUpdate,
        prices_confirmed: true,
      };

      // Re-pricing re-costs the output lots; once one of them has been sold or
      // used that rice left stock at the old cost, so a change is refused then.
      const changesValue = Object.keys(manualUpdate).length > 0
        || Object.entries(priceUpdate).some(([k, v]) => k.endsWith('_price_per_kg')
          && Math.abs((Number(v) || 0) - (Number(current[k]) || 0)) > 1e-6);
      if (changesValue) {
        try { await assertBatchOutputsUnsold(db, current); }
        catch (e) { return res.status(e.status || 500).json({ success: false, message: e.message }); }
      }

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
const { resolvePaymentAccountId } = require('../../shared/cashAccounts');
const { assertAccountCurrency } = require('../../shared/accountCurrency');
const { postAccountMovement } = require('../finance/paymentEngine');
const { postBankTransaction } = require('../../shared/bankBalance');
const { glAccountFor, controlAccount } = require('../../shared/accountGl');
// Shared payroll logic (also used by the scheduler) — compute + prepare.
const payrollService = require('./payroll.service');
const { computePayrollSummary, committedWorkerStatus, preparePayrollRun, nextPrepareDate, computeLeaveBalances, MONTHLY_DAY_DIVISOR } = payrollService;
const {
  payAdvance, removeAdvance, recoverAdvancesForWorker, postRecoveryJournal, reverseRecoveryJournals,
  addMonths,
} = require('./payrollAdvances');
const { computeFinalSettlement, settleWorker, reverseSettlement } = require('./finalSettlement');

// True when the signed-in user holds the Owner role (resolved by role NAME —
// the role id differs across environments).
async function isOwnerUser(req) {
  if (!req.user || !req.user.role_id) return false;
  const role = await db('roles').where({ id: req.user.role_id }).first('name');
  return !!role && role.name === 'Owner';
}

// Salaries are paid through Payroll (prepare → approve → pay), which writes the
// payslip, statutory deductions and advance recovery. A mill expense under
// these heads would pay a salary outside that workflow (P2-25); a staff
// advance is paid from the advance's own Pay drawer (D-11).
const PAYROLL_ONLY_HEADS = ['salaries', 'staff_advance'];

router.get('/expenses', authorize('milling', 'view'), requireCostVisibility, async (req, res) => {
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

// ── Expense heads ────────────────────────────────────────────────────────────
// The category on a mill expense is free text — the insert never validated it —
// but the form only ever offered a hardcoded list, so an operator could not
// record anything outside it (a lunch, a tea run, a one-off charge).
//
// Heads live in system_settings alongside companyProfile rather than in a table
// of their own: it is a short list of labels with no relationships, and it
// avoids a migration for what is effectively a preference.
//
// The list offered is the built-ins, plus anything saved here, plus any category
// already present on a mill expense — so a head used before this existed does
// not disappear from the dropdown.
const MILL_EXPENSE_HEADS_KEY = 'mill_expense_heads';
const BUILT_IN_MILL_HEADS = [
  'utilities', 'rent', 'maintenance', 'insurance',
  'transport', 'fuel', 'packaging', 'inspection', 'freight',
  'commission', 'miscellaneous',
];

// 'Night Shift  Lunch ' → 'night shift lunch'. Stored lowercase so the same head
// typed with different capitalisation cannot appear twice in the list.
function normaliseHead(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function readCustomHeads() {
  const row = await db('system_settings').where({ key: MILL_EXPENSE_HEADS_KEY }).first();
  if (!row || !row.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.map(normaliseHead).filter(Boolean) : [];
  } catch (_) { return []; }   // corrupt value must not break the expense form
}

router.get('/expenses/heads', authorize('milling', 'view'), async (_req, res) => {
  try {
    const custom = await readCustomHeads();
    const used = (await db('business_expenses').where('expense_type', 'mill').distinct('category'))
      .map((r) => normaliseHead(r.category)).filter(Boolean);
    const all = [...new Set([...BUILT_IN_MILL_HEADS, ...custom, ...used])]
      .filter((h) => !PAYROLL_ONLY_HEADS.includes(h)).sort();
    return res.json({ success: true, data: { heads: all, builtIn: BUILT_IN_MILL_HEADS, custom } });
  } catch (err) {
    console.error('list expense heads error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Same permission as recording an expense: if you can book the cost, you can
// name the head it goes under.
router.post('/expenses/heads', authorize('milling', 'create'),
  auditAction('create', 'mill_expense_head'),
  async (req, res) => {
    try {
      const head = normaliseHead(req.body?.head);
      if (!head) return res.status(400).json({ success: false, message: 'A name is required.' });
      if (head.length > 40) return res.status(400).json({ success: false, message: 'Keep the name to 40 characters or fewer.' });
      if (!/^[a-z0-9][a-z0-9 \-_/&]*$/.test(head)) {
        return res.status(400).json({ success: false, message: 'Use letters, numbers, spaces and - _ / & only.' });
      }
      const custom = await readCustomHeads();
      if (PAYROLL_ONLY_HEADS.includes(head)) {
        return res.status(400).json({ success: false, message: 'Salaries are paid through Payroll, not as a mill expense.' });
      }
      if (BUILT_IN_MILL_HEADS.includes(head) || custom.includes(head)) {
        return res.status(409).json({ success: false, message: `"${head}" is already on the list.` });
      }
      const next = [...custom, head];
      const existing = await db('system_settings').where({ key: MILL_EXPENSE_HEADS_KEY }).first();
      if (existing) {
        await db('system_settings').where({ key: MILL_EXPENSE_HEADS_KEY })
          .update({ value: JSON.stringify(next), updated_by: req.user?.id || null, updated_at: db.fn.now() });
      } else {
        await db('system_settings').insert({
          key: MILL_EXPENSE_HEADS_KEY, value: JSON.stringify(next), category: 'mill',
          updated_by: req.user?.id || null,
        });
      }
      return res.json({ success: true, data: { head, heads: [...new Set([...BUILT_IN_MILL_HEADS, ...next])].sort() } });
    } catch (err) {
      console.error('create expense head error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
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

      // P2-25: a salary paid as a mill expense skipped the payroll approval,
      // the payslip and statutory deductions, and blocked that month's payroll.
      if (PAYROLL_ONLY_HEADS.includes(normaliseHead(category))) {
        return res.status(400).json({
          success: false,
          message: 'Salaries are paid through Payroll (prepare → approve → pay), and salary advances from the advance\'s Pay button — not as a mill expense.',
        });
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
        // milling.create is a mill gate: without finance.confirm_payment the
        // pay-now leg may only use the mill's own accounts, never Head Office's.
      }, req.user?.id, null, { millOnly: !!pay_now && await lacksFinancePayment(req) });
      return res.json({ success: true, data: { expense } });
    } catch (err) {
      const code = err.statusCode || err.status;
      if (code && code < 500) return res.status(code).json({ success: false, message: err.message });
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

router.get('/expenses/recurring', authorize('milling', 'view'), requireCostVisibility, async (req, res) => {
  try {
    const rows = await db('business_expenses as e')
      .leftJoin('mill_workers as w', 'w.id', 'e.employee_id')
      .where('e.expense_type', 'mill').where('e.is_recurring', true)
      .select('e.id', 'e.expense_no', 'e.category', 'e.subcategory', 'e.vendor_name', 'e.employee_id',
        'w.name as employee_name', 'e.recurrence', db.raw('e.amount_pkr as amount'), 'e.expense_date', 'e.description',
        'e.recurrence_end_date')
      .orderBy('e.expense_date', 'desc').orderBy('e.id', 'desc');
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
      const endDate = e.recurrence_end_date ? isoDate(e.recurrence_end_date) : null;
      const ended = !!endDate && nextDue > endDate;
      // A salary series predates "salaries only through Payroll" — shown, never due.
      const payrollOnly = PAYROLL_ONLY_HEADS.includes(normaliseHead(e.category));
      return {
        ...e, last_date: isoDate(e.expense_date), next_due: ended || payrollOnly ? null : nextDue,
        end_date: endDate, ended, payroll_only: payrollOnly,
        due: !ended && !payrollOnly && nextDue <= today, occurrences: counts[k],
        payee: e.employee_name || e.vendor_name || null,
      };
    }).sort((a, b) => (String(a.next_due || '9999') < String(b.next_due || '9999') ? -1 : 1));
    return res.json({ success: true, data: { recurring, dueCount: recurring.filter((r) => r.due).length } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Post EVERY due occurrence of every recurring series in one shot ("Run due").
// Same guard as "Post now": per-series lock + duplicate-date check + end date.
router.post('/expenses/recurring/run-due', authorize('milling', 'create'), auditAction('run_due_recurring', 'business_expense'), async (req, res) => {
  try {
    const result = await automationService.materializeDueRecurringExpenses({ userId: req.user?.id || null });
    return res.json({ success: true, data: result });
  } catch (err) {
    const code = err.statusCode || err.status;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
});

// "Post now": the NEXT occurrence of a series (the :id is any row of it) — only
// once it is due, never past the series' end date, never twice for one date.
router.post('/expenses/recurring/:id/materialize', authorize('milling', 'create'), auditAction('materialize_recurring', 'business_expense'), async (req, res) => {
  try {
    const out = await automationService.materializeRecurringExpense(parseInt(req.params.id, 10), {
      payNow: !!req.body.pay_now, bankAccountId: req.body.bank_account_id || null,
      paymentMethod: req.body.payment_method || null, reference: req.body.reference || null,
      userId: req.user?.id || null, millOnly: !!req.body.pay_now && await lacksFinancePayment(req),
    });
    return res.json({ success: true, data: out });
  } catch (err) {
    const code = err.statusCode || err.status;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
});

// Stop a recurring series: nothing after `end_date` (default today) is posted.
router.post('/expenses/recurring/:id/stop', authorize('milling', 'create'),
  auditAction('stop_recurring', 'mill_expense', (req) => req.params.id), async (req, res) => {
  try {
    const out = await automationService.stopRecurringSeries(parseInt(req.params.id, 10), { endDate: req.body?.end_date || null });
    return res.json({ success: true, data: out });
  } catch (err) {
    const code = err.statusCode || err.status;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
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
// store a daily_wage (derived as salary ÷ 30 for monthly staff — D-12) so
// day-based figures keep working regardless of pay type. Payroll itself uses
// salary ÷ 30 for monthly staff whatever is stored here.
function normalizeWorkerPay(body) {
  const pay_type = body.pay_type === 'monthly' ? 'monthly' : 'daily';
  const monthly_salary = pay_type === 'monthly' ? parseFloat(body.monthly_salary) : null;
  let daily_wage = body.daily_wage != null && body.daily_wage !== '' ? parseFloat(body.daily_wage) : null;
  if (pay_type === 'monthly' && (!daily_wage || Number.isNaN(daily_wage))) {
    daily_wage = monthly_salary ? Math.round((monthly_salary / MONTHLY_DAY_DIVISOR) * 100) / 100 : 0;
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

// month string (YYYY-MM) helpers (addMonths: ./payrollAdvances)
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

// A CNIC identifies one employee at portal login, so two ACTIVE workers may not
// share it (P1-07 / PAY-30). Returns the clash message, or null.
async function activeCnicClash(cnic, exceptId) {
  const c = String(cnic || '').trim();
  if (!c) return null;
  const q = db('mill_workers').where('cnic', c).where('is_active', true);
  if (exceptId) q.whereNot('id', exceptId);
  const other = await q.first('id', 'name');
  return other ? `CNIC ${c} is already used by active employee ${other.name}.` : null;
}

// A unique-index hit (CNIC / phone already on another worker) is a 409 the
// admin can act on, not a 500.
function sendWorkerSaveError(res, err) {
  if (err && err.code === '23505') {
    const field = /cnic/i.test(err.constraint || err.message || '') ? 'CNIC' : /phone/i.test(err.constraint || err.message || '') ? 'phone number' : 'value';
    return res.status(409).json({ success: false, message: `Another employee already has this ${field}.` });
  }
  return res.status(500).json({ success: false, message: err.message });
}

router.post('/workers', authorize('payroll', 'create'), auditAction('create', 'mill_worker', (req, d) => d.data?.worker?.id), async (req, res) => {
  try {
    const { name, role, phone, cnic, joined_date, left_date, mill_id, notes, bank_name, bank_account_number, iban, department } = req.body;
    const entity = req.body.entity === 'general' ? 'general' : 'mill'; // Head Office vs Mill
    const { pay_type, monthly_salary, daily_wage } = normalizeWorkerPay(req.body);
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
    const cnicClash = await activeCnicClash(cnic);
    if (cnicClash) return res.status(409).json({ success: false, message: cnicClash });
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
  } catch (err) { return sendWorkerSaveError(res, err); }
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
    const nextActive = updates.is_active !== undefined ? updates.is_active : worker.is_active;
    const nextCnic = updates.cnic !== undefined ? updates.cnic : worker.cnic;
    if (nextActive && (updates.cnic !== undefined || updates.is_active === true)) {
      const cnicClash = await activeCnicClash(nextCnic, worker.id);
      if (cnicClash) return res.status(409).json({ success: false, message: cnicClash });
    }
    // Deactivating, or changing the login CNIC, ends the worker's portal sessions.
    if ((updates.is_active === false && worker.is_active)
      || (updates.cnic !== undefined && (updates.cnic || null) !== (worker.cnic || null))) {
      updates.portal_pin_version = db.raw('portal_pin_version + 1');
    }
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
    if (updated) delete updated.portal_pin_hash; // never send the PIN hash back
    return res.json({ success: true, data: { worker: updated } });
  } catch (err) { return sendWorkerSaveError(res, err); }
});

// Dedicated "Revise salary" — records a revision (old→new) WITH an effective date
// + reason, then applies the new pay. (The generic PUT also auto-logs, but this
// is the proper increment flow that captures why + when.)
router.post('/workers/:id/salary-revision', authorize('payroll', 'edit'), auditAction('salary_revision', 'mill_worker'), async (req, res) => {
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
      }, userId, trx, { strictLedger: true });
    }
    let assetRecovered = 0;
    for (const l of rows) {
      const ded = parseFloat(l.advance_deducted) || 0;
      if (ded > 0 && l.worker_id) {
        const rec = await recoverAdvancesForWorker(trx, l.worker_id, ded, { period: locked.period, runId: locked.id, lineId: l.id });
        assetRecovered += rec.assetApplied;
      }
      if (l.skip_reason && l.worker_id) await markPeriodSkipped(trx, l.worker_id, locked.period, l.skip_reason);
      await trx('mill_payroll_lines').where('id', l.id).update({ paid_at: trx.fn.now(), paid_by: userId || null, expense_id: expense?.id || null, updated_at: trx.fn.now() });
    }
    // The advances recovered from this pay that were booked to 1330 Staff
    // Advances become salary cost now (Dr 6135 / Cr 1330, D-11).
    await postRecoveryJournal(trx, {
      amount: assetRecovered, date: locked.pay_date, entity: locked.entity, refNo: `ADVREC-RUN-${locked.id}`, userId,
      description: `Salary advances recovered — payroll ${locked.period} (run #${locked.id})`,
    });
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

// Reverse the money an advance / salaries / settlement expense moved — signed-
// delta journals, a reversing bank row, rows kept as 'Reversed' (see
// payrollReversal.js). Nothing posted is deleted.
function unwindAdvanceExpense(trx, expenseId, opts = {}) {
  return reverseExpenseTrail(trx, expenseId, opts);
}

// Set / reset / disable a worker's self-service portal PIN (Phase 19). A new PIN
// must be 6–8 digits and is bcrypt-hashed; `enabled:false` turns the portal off.
// A reset or disable bumps portal_pin_version, ending every portal session the
// worker already has, and a reset clears any wrong-PIN lockout (P1-07).
router.post('/workers/:id/portal-pin', authorize('payroll', 'edit'), auditAction('set_portal_pin', 'mill_worker'), async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { newPinError } = require('../portal/portalAuth');
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const enabled = req.body?.enabled !== false;
    const pin = req.body?.pin != null ? String(req.body.pin).trim() : '';
    const updates = { updated_at: db.fn.now() };
    if (!enabled) {
      updates.portal_enabled = false;
      updates.portal_pin_version = db.raw('portal_pin_version + 1');
    } else {
      if (!worker.cnic) return res.status(400).json({ success: false, message: 'Add a CNIC first — the employee logs in with CNIC + PIN.' });
      if (pin) {
        const pinErr = newPinError(pin);
        if (pinErr) return res.status(400).json({ success: false, message: pinErr });
        updates.portal_pin_hash = await bcrypt.hash(pin, 10);
        updates.portal_pin_version = db.raw('portal_pin_version + 1');
        updates.portal_failed_attempts = 0;
        updates.portal_locked_until = null;
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

router.post('/worker-requests/:id/resolve', authorize('payroll', 'edit'), auditAction('resolve_request', 'worker_request'), async (req, res) => {
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
  // Never overwrite a day marked worked (present / half day): only an empty or
  // absent cell becomes 'leave'.
  for (const date of dates) {
    await db('mill_attendance').insert({ worker_id: workerId, date, status: 'leave', hours_worked: 0, overtime_hours: 0 })
      .onConflict(['worker_id', 'date']).merge(['status', 'hours_worked', 'updated_at'])
      .whereNotIn('mill_attendance.status', ['present', 'half_day']);
  }
}

router.get('/payroll/leave-types', authorize('payroll', 'view'), async (req, res) => {
  try { return res.json({ success: true, data: await db('mill_leave_types').orderBy('sort_order').orderBy('id') }); }
  catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-types', authorize('payroll', 'approve'), auditAction('create', 'leave_type'), async (req, res) => {
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
router.put('/payroll/leave-types/:id', authorize('payroll', 'approve'), auditAction('update', 'leave_type'), async (req, res) => {
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
router.delete('/payroll/leave-types/:id', authorize('payroll', 'approve'), auditAction('delete', 'leave_type'), async (req, res) => {
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
// Checks a leave range must pass (P2-25 / P2-26): no overlap with another
// pending/approved request of the same worker, within the leave type's
// remaining balance, and — for approval — no day already marked worked
// (approving used to overwrite a present day with 'leave', paying it twice).
// Returns an error message, or null.
async function leaveRangeProblem({ workerId, fromDate, toDate, typeId, days, excludeId = null, forApproval = false }) {
  const toYmd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const from = toYmd(fromDate); const to = toYmd(toDate);
  const overlap = await db('mill_leave_requests').where('worker_id', workerId)
    .whereIn('status', ['pending', 'approved'])
    .where('from_date', '<=', to).where('to_date', '>=', from)
    .modify((q) => { if (excludeId) q.whereNot('id', excludeId); })
    .first('id', 'from_date', 'to_date', 'status');
  if (overlap) return `These dates overlap leave request #${overlap.id} (${toYmd(overlap.from_date)} to ${toYmd(overlap.to_date)}, ${overlap.status}).`;
  if (typeId) {
    const year = from.slice(0, 4);
    const bal = (await computeLeaveBalances(workerId, year)).find((b) => b.id === Number(typeId));
    if (bal && bal.remaining != null && Number(days) > bal.remaining + 1e-9) {
      return `${bal.name}: ${days} day(s) requested but only ${bal.remaining} remain for ${year}.`;
    }
  }
  if (forApproval) {
    const worked = await db('mill_attendance').where('worker_id', workerId)
      .whereBetween('date', [from, to]).whereIn('status', ['present', 'half_day'])
      .orderBy('date').pluck('date');
    if (worked.length) return `The attendance register shows ${worked.length} day(s) worked in this range (${worked.slice(0, 5).map(toYmd).join(', ')}${worked.length > 5 ? ', …' : ''}). Correct the attendance or the dates first.`;
  }
  return null;
}

// Create a leave request. Always PENDING: approval is a separate act
// (/approve, payroll.approve) — a `status` in the body is ignored (P2-25).
router.post('/payroll/leave-requests', authorize('payroll', 'create'), auditAction('create', 'leave_request'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.worker_id || !b.from_date || !b.to_date) return res.status(400).json({ success: false, message: 'worker, from and to dates are required.' });
    const type = b.leave_type_id ? await db('mill_leave_types').where('id', b.leave_type_id).first() : null;
    const days = inclusiveDays(b.from_date, b.to_date);
    if (days <= 0) return res.status(400).json({ success: false, message: 'Invalid date range.' });
    const problem = await leaveRangeProblem({ workerId: b.worker_id, fromDate: b.from_date, toDate: b.to_date, typeId: b.leave_type_id, days });
    if (problem) return res.status(409).json({ success: false, message: problem });
    const [row] = await db('mill_leave_requests').insert({
      worker_id: b.worker_id, leave_type_id: b.leave_type_id || null, from_date: b.from_date, to_date: b.to_date,
      days, paid: type ? !!type.paid : false, reason: b.reason || null, status: 'pending',
    }).returning('*');
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});
router.post('/payroll/leave-requests/:id/approve', authorize('payroll', 'approve'), auditAction('approve', 'mill_leave_request', (req) => req.params.id), async (req, res) => {
  try {
    const r = await db('mill_leave_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (r.status !== 'pending') return res.status(409).json({ success: false, message: `Only a pending leave request can be approved (this one is ${r.status}).` });
    const problem = await leaveRangeProblem({
      workerId: r.worker_id, fromDate: r.from_date, toDate: r.to_date, typeId: r.leave_type_id, days: r.days, excludeId: r.id, forApproval: true,
    });
    if (problem) return res.status(409).json({ success: false, message: problem });
    const [row] = await db('mill_leave_requests').where('id', r.id).where('status', 'pending')
      .update({ status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    if (!row) return res.status(409).json({ success: false, message: 'This request changed while you were approving it — refresh and try again.' });
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
router.delete('/payroll/leave-requests/:id', authorize('payroll', 'delete'), auditAction('delete', 'leave_request'), async (req, res) => {
  try {
    const r = await db('mill_leave_requests').where('id', req.params.id).first();
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (r.status === 'approved') await markLeaveAttendance(r.worker_id, r.from_date, r.to_date, { remove: true, excludeRequestId: r.id });
    await db('mill_leave_requests').where('id', r.id).del();
    return res.json({ success: true, data: { deleted: r.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── Final settlement (Phase 25; P2-11) — see ./finalSettlement.js ──────────
router.get('/payroll/final-settlement/:workerId', authorize('payroll', 'view'), async (req, res) => {
  try {
    const data = await computeFinalSettlement(parseInt(req.params.workerId, 10), { leftDate: req.query.left_date || null });
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
    return res.json({ success: true, data: { logs: require('../admin/audit.service').redactRows(logs), actions, total: parseInt(countRow?.c, 10) || 0, page, limit } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Pay a final settlement — one locked transaction (payout, exact advance
// recovery, record, deactivation); a second settlement is refused (409).
router.post('/payroll/final-settlement/:workerId', authorize('payroll', 'pay'),
  auditAction('settle', 'mill_final_settlement', (req) => req.params.workerId),
  async (req, res) => {
  try {
    const settlement = await settleWorker(parseInt(req.params.workerId, 10), req.body || {}, req.user?.id || null,
      { millOnly: await lacksFinancePayment(req) });
    return res.status(201).json({ success: true, data: settlement });
  } catch (err) {
    const code = err.statusCode || err.httpStatus;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
});

// Reverse a settlement — a payment reversal, so it needs a reason and the
// Owner (D-3 / D-23). The payout is netted by signed deltas, the advances it
// recovered are restored, the worker is reactivated, and the settlement stays
// on record as 'reversed'.
async function reverseSettlementHandler(req, res) {
  try {
    const out = await reverseSettlement(parseInt(req.params.id, 10), { reason: req.body?.reason, userId: req.user?.id || null });
    return res.json({ success: true, data: { reversed: out.settlement.id, ...out } });
  } catch (err) {
    const code = err.statusCode || err.httpStatus;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
}
router.post('/payroll/final-settlements/:id/reverse', authorize('payroll', 'pay'), ownerApproval('final_settlement_reversal'),
  auditAction('void', 'mill_final_settlement', (req) => req.params.id), reverseSettlementHandler);
// The old DELETE removed the record; it now only explains where the reversal went.
router.delete('/payroll/final-settlements/:id', authorize('payroll', 'pay'), (req, res) => res.status(405).json({
  success: false, message: 'A final settlement is reversed, not deleted — use Reverse (a reason and the Owner\'s approval are required).',
}));

// Delete a worker — only one with no financial history (P2-10 / D-23). Anyone
// who was ever paid, advanced or settled can only be deactivated: deleting them
// used to reverse every advance's cash-out (phantom cash back in the bank) and
// cut their payslips and tax statement loose.
router.delete('/workers/:id', authorize('payroll', 'delete'), auditAction('delete', 'mill_worker', (req) => req.params.id), async (req, res) => {
  try {
    const worker = await db('mill_workers').where('id', req.params.id).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const [lines, advances, settlements, expenses] = await Promise.all([
      db('mill_payroll_lines').where('worker_id', worker.id).count('id as c').first(),
      db('mill_worker_advances').where('worker_id', worker.id).whereIn('approval_status', ['paid', 'voided']).count('id as c').first(),
      db('mill_final_settlements').where('worker_id', worker.id).count('id as c').first(),
      db('business_expenses').where('employee_id', worker.id).count('id as c').first(),
    ]);
    const n = (r) => parseInt(r && r.c, 10) || 0;
    if (n(lines) + n(advances) + n(settlements) + n(expenses) > 0) {
      return res.status(409).json({
        success: false,
        message: `${worker.name} has payroll history (${n(lines)} payslip line(s), ${n(advances)} paid advance(s), ${n(settlements)} settlement(s), ${n(expenses)} salary payment(s)). Deactivate the employee instead — their payslips and tax statement must stay.`,
      });
    }
    await db.transaction(async (trx) => {
      // Never-paid advance requests carry no money; they go with the worker.
      const reqIds = await trx('mill_worker_advances').where('worker_id', worker.id).pluck('id');
      if (reqIds.length) {
        await trx('mill_worker_advance_recovery_schedule').whereIn('advance_id', reqIds).del();
        await trx('mill_worker_advances').whereIn('id', reqIds).del();
      }
      await trx('mill_workers').where('id', worker.id).del(); // attendance, leave, adjustments cascade
    });
    return res.json({ success: true, data: { deleted: worker.id } });
  } catch (err) {
    if (err && err.code === '23503') return res.status(409).json({ success: false, message: 'This employee has payroll history — deactivate them instead.' });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// List a worker's advances (most recent first).
router.get('/workers/:id/advances', authorize('payroll', 'view'), async (req, res) => {
  try {
    const advances = await db('mill_worker_advances').where('worker_id', req.params.id).orderBy('advance_date', 'desc').orderBy('id', 'desc');
    return res.json({ success: true, data: { advances } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Per-employee LEDGER — the company's running liability to one worker:
//   • salary advances paid out (mill_worker_advances, approval_status 'paid')
//   • payroll lines (mill_payroll_lines) — P4-08 / PAY-19: only EARNED lines
//     credit the worker (paid, or accrued), and only PAID lines debit "Salary
//     paid" (payrollLineStatus.js). Prepared / approved lines book nothing and
//     are summarised as pending. Bonus is earned with the gross; statutory
//     (tax / EOBI…) and other deductions are withheld from it, so
//     gross + bonus − statutory − deductions − advance recovered = net, and a
//     net paid short of that (D-12 short pay) stays on the balance as owed.
//   • any other salary disbursement booked directly against them
//     (business_expenses.employee_id, excluding the advances' own cash-outs so
//      they aren't double-counted).
router.get('/workers/:id/ledger', authorize('payroll', 'view'), async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    const worker = await db('mill_workers').where('id', workerId).first();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const num = (v) => parseFloat(v) || 0;

    // Only disbursed advances are real money — pending/approved/rejected requests
    // (Batch 6 · item 8) must not inflate the employee ledger.
    const advances = await db('mill_worker_advances').where({ worker_id: workerId, approval_status: 'paid' })
      .select('id', 'advance_date', 'amount', 'recovered_amount', 'status', 'expense_id', 'notes');
    const advanceExpenseIds = advances.map((a) => a.expense_id).filter(Boolean);

    const payLines = await db('mill_payroll_lines as l')
      .join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where('l.worker_id', workerId)
      .whereRaw(payrollLineStatus.LIVE_SQL) // never paid / undone
      .select('l.id', 'r.period', 'r.pay_date', 'r.pay_method', 'r.status as run_status', 'l.paid_at',
        db.raw("to_char(COALESCE(l.paid_at, r.paid_at, r.pay_date::timestamptz), 'YYYY-MM-DD') AS paid_day"),
        'l.gross_pay', 'l.bonus_total', 'l.statutory_total', 'l.deduction_total', 'l.advance_deducted', 'l.net_pay',
        'l.short_pay_amount');

    let otherExpQ = db('business_expenses').where('employee_id', workerId).whereNot('payment_status', 'Reversed');
    if (advanceExpenseIds.length) otherExpQ = otherExpQ.whereNotIn('id', advanceExpenseIds);
    const otherExp = await otherExpQ.select('id', 'expense_no', 'expense_date', 'amount', 'amount_pkr', 'description', 'category');

    const lines = payLines.map((p) => ({ ...p, state: payrollLineStatus.lineState(p) }));
    const earned = lines.filter((p) => p.state === 'paid' || p.state === 'accrued');
    const paid = lines.filter((p) => p.state === 'paid');
    const pending = lines.filter((p) => p.state === 'pending');

    // credit = we owe them (salary earned); debit = we paid them or withheld
    // it on their behalf. Running balance > 0 → salary still payable;
    // balance < 0 → worker owes us (outstanding advance not yet recovered).
    const raw = [
      ...advances.map((a) => ({
        date: a.advance_date, ord: 1, type: 'advance', label: 'Advance given',
        reference: a.expense_id ? `ADV-${a.id}` : null, note: a.notes || null,
        debit: num(a.amount), credit: 0,
        // legacy alias kept so older UI keeps rendering
        amount: num(a.amount), status: a.status, recovered: num(a.recovered_amount),
      })),
      ...earned.flatMap((p) => {
        const gross = num(p.gross_pay); const bonus = num(p.bonus_total);
        const stat = num(p.statutory_total); const ded = num(p.deduction_total);
        const rows = [
          { date: p.pay_date, ord: 0, type: 'salary_earned', label: `Salary earned ${p.period}`, reference: p.period, debit: 0, credit: gross, amount: gross, note: p.state === 'accrued' ? 'Gross salary · accrued, not yet paid' : 'Gross salary' },
        ];
        if (bonus) rows.push({ date: p.pay_date, ord: 0, type: 'bonus', label: `Bonus ${p.period}`, reference: p.period, debit: 0, credit: bonus, amount: bonus });
        if (stat) rows.push({ date: p.pay_date, ord: 1, type: 'statutory', label: `Tax / statutory withheld ${p.period}`, reference: p.period, debit: stat, credit: 0, amount: stat, note: 'Paid to the authority on the employee’s behalf' });
        if (ded) rows.push({ date: p.pay_date, ord: 1, type: 'deduction', label: `Deductions ${p.period}`, reference: p.period, debit: ded, credit: 0, amount: ded });
        return rows;
      }),
      ...paid.map((p) => {
        const net = num(p.net_pay); const adv = num(p.advance_deducted); const short = num(p.short_pay_amount);
        const notes = [
          adv > 0 ? `advance recovered ${Math.round(adv).toLocaleString()}` : null,
          short > 0 ? `short-paid ${Math.round(short).toLocaleString()} (carried forward)` : null,
          `via ${p.pay_method || 'cash'}`,
        ].filter(Boolean).join(' · ');
        return { date: p.paid_day || p.pay_date, ord: 2, type: 'salary_paid', label: `Salary paid ${p.period}`, reference: p.period, debit: net, credit: 0, amount: net, note: notes };
      }),
      ...otherExp.map((e) => ({
        date: e.expense_date, ord: 1, type: 'other', label: e.description || 'Disbursement',
        reference: e.expense_no, note: e.category, debit: num(e.amount_pkr) || num(e.amount), credit: 0,
        amount: num(e.amount_pkr) || num(e.amount),
      })),
    ].sort((a, b) => (new Date(a.date) - new Date(b.date)) || (a.ord - b.ord));

    let bal = 0;
    const entries = raw.map((e) => { bal += (e.credit || 0) - (e.debit || 0); return { ...e, balance: Math.round(bal) }; });

    const sum = (arr, k) => Math.round(arr.reduce((s, p) => s + num(p[k]), 0));
    const summary = {
      salaryEarned: sum(earned, 'gross_pay'),
      bonus: sum(earned, 'bonus_total'),
      statutoryWithheld: sum(earned, 'statutory_total'),
      deductions: sum(earned, 'deduction_total'),
      advancesTaken: Math.round(advances.reduce((s, a) => s + num(a.amount), 0)),
      advanceDeducted: sum(earned, 'advance_deducted'),
      salaryPaid: sum(paid, 'net_pay'),
      accruedUnpaid: sum(earned.filter((p) => p.state === 'accrued'), 'net_pay'),
      advanceOutstanding: Math.round(advances.reduce((s, a) => s + Math.max(0, num(a.amount) - num(a.recovered_amount)), 0)),
      pendingLines: pending.length,
      pendingNet: sum(pending, 'net_pay'),
      currentBalance: Math.round(bal),
      currency: 'PKR',
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

// Approve a pending advance — payroll.approve (as reject) AND the Owner
// (ownerApproval gate: the Owner self-approves, anyone else must name the
// authorizing owner). No cash yet. Was payroll.view, which let a view-only
// role (Mill Manager, Read-Only Auditor) submit an approval.
router.post('/advances/:id/approve', authorize('payroll', 'approve'), ownerApproval('salary_advance'),
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

// Pay (disburse) an approved advance — Finance (payroll.pay). The pay drawer
// names the method, account and date; the payout is booked to 1330 Staff
// Advances on that date (D-11) in ONE transaction holding the advance's row
// lock, so a double-click or retry pays once and the second call gets 409.
router.post('/advances/:id/pay', authorize('payroll', 'pay'),
  auditAction('advance_paid', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const b = req.body || {};
    const advance = await payAdvance(parseInt(req.params.id, 10), {
      payDate: b.pay_date || null,
      method: b.payment_method || 'cash',
      bankAccountId: b.bank_account_id || null,
      reference: b.payment_reference || null,
      millOnly: await lacksFinancePayment(req),
    }, req.user?.id || null);
    return res.json({ success: true, data: { advance } });
  } catch (err) {
    const code = err.statusCode || err.httpStatus;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
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

// Delete an advance REQUEST (never paid: pending / approved / rejected) — no
// money moved, so the row goes. A paid advance is voided instead (below).
router.delete('/advances/:id', authorize('payroll', 'delete'), auditAction('advance_delete', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const out = await removeAdvance(parseInt(req.params.id, 10), { mode: 'delete', userId: req.user?.id || null });
    return res.json({ success: true, data: out });
  } catch (err) {
    const code = err.statusCode || err.httpStatus;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
});

// Void a PAID advance that nothing has been recovered from yet (D-23): the
// payout is reversed (signed-delta journals, reversing bank row) and the
// advance is kept as 'voided'. A payment reversal, so it needs a reason and
// the Owner (D-3). Refused (409) once any of it was recovered from salary.
router.post('/advances/:id/void', authorize('payroll', 'pay'), ownerApproval('salary_advance_void'),
  auditAction('advance_void', 'mill_worker_advance', (req) => req.params.id), async (req, res) => {
  try {
    const out = await removeAdvance(parseInt(req.params.id, 10), { mode: 'void', reason: req.body?.reason, userId: req.user?.id || null });
    return res.json({ success: true, data: out });
  } catch (err) {
    const code = err.statusCode || err.httpStatus;
    return res.status(code && code < 500 ? code : 500).json({ success: false, message: err.message });
  }
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

router.post('/workers/:id/adjustments', authorize('payroll', 'create'), auditAction('create_adjustment', 'mill_worker'), async (req, res) => {
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

router.delete('/adjustments/:id', authorize('payroll', 'delete'), auditAction('delete', 'payroll_adjustment'), async (req, res) => {
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

router.post('/payroll/statutory-deductions', authorize('payroll', 'approve'), auditAction('create', 'statutory_deduction'), async (req, res) => {
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

router.put('/payroll/statutory-deductions/:id', authorize('payroll', 'approve'), auditAction('update', 'statutory_deduction'), async (req, res) => {
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

router.delete('/payroll/statutory-deductions/:id', authorize('payroll', 'approve'), auditAction('delete', 'statutory_deduction'), async (req, res) => {
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
    if (!(await controlAccount(db))) return res.status(400).json({ success: false, message: 'Cash & Bank control account (1000) missing.' });
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
      // The account the money leaves, resolved and checked exactly as for any
      // payment: a bank remittance must name its account (it used to post the
      // GL with no account moving), cash with none comes out of the entity's
      // float, and only a PKR account can pay this PKR liability.
      const acctId = await resolvePaymentAccountId(trx, {
        bankAccountId: method === 'bank' ? (b.bank_account_id || null) : null,
        method: method === 'bank' ? 'bank_transfer' : 'cash',
        entity,
      });
      const acctRow = await trx('bank_accounts').where('id', acctId).first();
      if (!acctRow) { const e = new Error('Bank account not found.'); e.statusCode = 400; throw e; }
      assertAccountCurrency(acctRow, 'PKR');
      // The cash line posts to the paying account's own GL (G-8).
      const cash = await glAccountFor(trx, acctRow);
      // Collision-safe STR number (M3): MAX trailing-digit + 1, not MAX(id)+1 —
      // the latter regenerates an existing number after a delete (see nextDocNo).
      // A reversed remittance's row is removed but its journals stay (signed-
      // delta reversal), so the number must also clear the journal refs.
      const remitNo = [
        await nextDocNo(trx, { table: 'mill_statutory_remittances', column: 'remittance_no', prefix: 'STR-', pad: 4 }),
        await nextDocNo(trx, { table: 'journal_entries', column: 'ref_no', prefix: 'STR-', pad: 4 }),
      ].sort((x, y) => parseInt(x.slice(4), 10) - parseInt(y.slice(4), 10)).pop();
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

      // Move the cash/bank account + record the outflow on its ledger — the
      // payment engine's account movement.
      await postAccountMovement(trx, {
        account: acctRow, direction: 'out', amount, date: remitDate, reference: remitNo,
        userId: req.user?.id || null, source: 'statutory_remittance', category: 'statutory',
        counterparty: b.authority || null,
        notes: `Statutory remittance ${remitNo}${b.authority ? ` — ${b.authority}` : ''}`,
      });
      await trx('mill_statutory_remittances').where('id', r.id).update({ journal_id: journal?.id || null });
      return { ...r, journal_id: journal?.id || null };
    });
    return res.status(201).json({ success: true, data: row });
  } catch (err) { return res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }); }
});

// Reverse a remittance — net its GL with a signed-delta journal, restore the
// bank with a reversing bank row (both kept), and mark the remittance Reversed
// so the liability shows as owed again. The row is KEPT (P2-30): it used to be
// hard-deleted, losing the record of what was paid, when and who undid it.
// Its audit row is written inside the same transaction.
router.delete('/payroll/statutory-remittances/:id', authorize('payroll', 'pay'),
  auditAction('void', 'statutory_remittance', (req) => req.params.id),
  async (req, res) => {
  try {
    const reason = (req.body && typeof req.body.reason === 'string' && req.body.reason.trim()) || null;
    const row = await db.transaction(async (trx) => {
      const r = await trx('mill_statutory_remittances').where('id', req.params.id).forUpdate().first();
      if (!r) { const e = new Error('Remittance not found.'); e.statusCode = 404; throw e; }
      if (r.status === 'Reversed') { const e = new Error(`Remittance ${r.remittance_no} is already reversed.`); e.statusCode = 409; throw e; }
      const amt = parseFloat(r.amount) || 0;
      const moved = await trx('bank_transactions').where({ reference: r.remittance_no, source: 'statutory_remittance' }).first('id');
      if (r.bank_account_id && moved && amt > 0) {
        await postBankTransaction(trx, {
          accountId: r.bank_account_id, type: 'credit', amount: amt,
          transaction_date: new Date().toISOString().slice(0, 10), reference: r.remittance_no,
          notes: `Reversal of statutory remittance ${r.remittance_no}`, source: 'statutory_remittance_reversal',
          category: 'statutory', created_by: req.user?.id || null,
        });
      }
      await mirrorJournals(trx, {
        refNo: r.remittance_no, refTypes: ['Statutory Remittance'], refType: 'Statutory Remittance Reversal',
        description: `Reversal of statutory remittance ${r.remittance_no}`, userId: req.user?.id || null,
        cashAccountId: r.bank_account_id || null,
      });
      const [updated] = await trx('mill_statutory_remittances').where('id', r.id).update({
        status: 'Reversed', reversed_at: trx.fn.now(), reversed_by: req.user?.id || null,
        reversal_reason: reason, updated_at: trx.fn.now(),
      }).returning('*');
      await auditService.logInTrx(trx, req, {
        action: 'void', entityType: 'statutory_remittance', entityId: r.id,
        details: { remittance_no: r.remittance_no, amount: amt, reason },
      });
      return updated;
    });
    return res.json({ success: true, data: { reversed: row.id, remittance: row } });
  } catch (err) {
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: code === 500 ? 'Internal server error.' : err.message });
  }
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
    const { month, worker_id, entity } = req.query;
    // The register is one month × one entity's employees. It used to read the
    // 500 newest rows of every entity, so once employees × days passed 500 the
    // older days showed blank and were re-marked (PAY-10). A month (or one
    // employee) is now required and nothing is capped.
    if (!/^\d{4}-\d{2}$/.test(String(month || '')) && !worker_id) {
      return res.status(400).json({ success: false, message: 'month (YYYY-MM) or worker_id is required.' });
    }
    let query = db('mill_attendance as a')
      .leftJoin('mill_workers as w', 'a.worker_id', 'w.id')
      .select('a.*', 'w.name as worker_name', 'w.daily_wage', 'w.entity as worker_entity')
      .orderBy('a.date', 'desc').orderBy('a.id', 'desc');
    // Match the calendar month as a date range — `${month}-32` is an invalid
    // date and Postgres throws "date/time field value out of range".
    if (month) {
      const [y, m] = String(month).split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      query = query.where('a.date', '>=', `${month}-01`).where('a.date', '<', next);
    }
    if (worker_id) query = query.where('a.worker_id', worker_id);
    if (entity === 'mill' || entity === 'general') query = query.where('w.entity', entity);
    const records = await query;
    return res.json({ success: true, data: { attendance: records } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

const VALID_ATTENDANCE = ['present', 'absent', 'half_day', 'leave', 'off'];
const attHours = (status) => (status === 'half_day' ? 4 : status === 'present' ? 8 : 0);

router.post('/attendance', authorize('payroll', 'create'), auditAction('record', 'attendance'), async (req, res) => {
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
router.post('/attendance/bulk', authorize('payroll', 'create'), auditAction('record_bulk', 'attendance'), async (req, res) => {
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
router.post('/attendance/import', authorize('payroll', 'create'), auditAction('import', 'attendance'), async (req, res) => {
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

// recoverAdvancesForWorker / applyRecoveryToSchedule: ./payrollAdvances.js

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
    // ?status=paid,approved… narrows the runs listed (P4-08 / PAY-20).
    const wanted = String(req.query.status || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (wanted.length) q = q.whereIn('r.status', wanted);
    const runs = await q;
    const runIds = runs.map((r) => r.id);
    const lines = runIds.length
      ? await enrichPayslipLines(await db('mill_payroll_lines').whereIn('run_id', runIds).orderBy('worker_name'))
      : [];
    const runById = new Map(runs.map((r) => [r.id, r]));
    const byRun = {};
    for (const l of lines) {
      l.line_state = payrollLineStatus.lineState({ paid_at: l.paid_at, run_status: (runById.get(l.run_id) || {}).status });
      (byRun[l.run_id] = byRun[l.run_id] || []).push(l);
    }
    const withLines = runs.map((r) => ({ ...r, lines: byRun[r.id] || [] }));
    // Totals are what was PAID — paid lines only (a partially-paid run counts
    // its paid employees); prepared / approved / voided / reversed runs are
    // listed but add nothing. byStatus shows every run status separately.
    const n = (v) => parseFloat(v || 0);
    const paidLines = lines.filter((l) => l.line_state === 'paid');
    const sumL = (k) => paidLines.reduce((s, l) => s + n(l[k]), 0);
    const byStatus = {};
    for (const r of runs) {
      const b = byStatus[r.status] || (byStatus[r.status] = { runs: 0, grossTotal: 0, netTotal: 0 });
      b.runs += 1; b.grossTotal += n(r.gross_total); b.netTotal += n(r.net_total);
    }
    const totals = {
      runs: runs.length,
      paidRuns: new Set(paidLines.map((l) => l.run_id)).size,
      employees: paidLines.length,
      grossTotal: sumL('gross_pay'),
      bonusTotal: sumL('bonus_total'),
      statutoryTotal: sumL('statutory_total'),
      deductionTotal: sumL('deduction_total'),
      advanceTotal: sumL('advance_deducted'),
      netTotal: sumL('net_pay'),
      basis: 'paid lines',
      currency: 'PKR',
      byStatus,
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
// One auto-prepare schedule PER ENTITY (Mill / Head Office), each a
// scheduled_tasks row (task_type 'payroll_prepare', config.entity). The
// scheduler auto-PREPARES on the chosen day each month — the month just closed
// for daily-wage staff, the current month for salaried staff
// (payroll.service prepareScheduledPayroll); it never auto-approves or
// auto-pays. config = { entity, pay_method, day_of_month, notes }.
// (Rows from before per-entity schedules carry no entity: they are the Mill's.)
const PAYROLL_TASK = 'payroll_prepare';
function parseTaskConfig(t) { try { return typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {}); } catch (e) { return {}; } }
const scheduleEntity = (v) => (v === 'general' ? 'general' : 'mill');
const payrollTaskFor = (ent) => db('scheduled_tasks').where('task_type', PAYROLL_TASK)
  .whereRaw("COALESCE(config->>'entity', 'mill') = ?", [ent]).orderBy('id', 'desc').first();

router.get('/payroll/schedule', authorize('payroll', 'view'), async (req, res) => {
  try {
    const ent = scheduleEntity(req.query.entity);
    const task = await payrollTaskFor(ent);
    if (!task) return res.json({ success: true, data: { schedule: null } });
    const cfg = parseTaskConfig(task);
    return res.json({ success: true, data: { schedule: {
      id: task.id, entity: ent, active: !!task.is_active, payMethod: cfg.pay_method || 'cash',
      dayOfMonth: cfg.day_of_month || 28, notes: cfg.notes || null,
      nextRun: task.next_run, lastRun: task.last_run, lastStatus: task.last_status, lastError: task.last_error || null,
    } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Create/update an entity's schedule. Finance/Owner only (they own payroll spend).
router.put('/payroll/schedule', authorize('payroll', 'approve'),
  auditAction('schedule', 'mill_payroll_run', () => null), async (req, res) => {
  try {
    const ent = scheduleEntity(req.body.entity);
    const active = req.body.active !== false;
    const dayOfMonth = Math.min(28, Math.max(1, parseInt(req.body.day_of_month, 10) || 28));
    const payMethod = req.body.pay_method === 'bank' ? 'bank' : 'cash';
    const config = JSON.stringify({ entity: ent, pay_method: payMethod, day_of_month: dayOfMonth, notes: req.body.notes || null });
    const nextRun = nextPrepareDate(dayOfMonth).toISOString();
    const existing = await payrollTaskFor(ent);
    let task;
    if (existing) {
      [task] = await db('scheduled_tasks').where('id', existing.id)
        .update({ is_active: active, config, cron_expression: 'monthly', next_run: nextRun, failure_count: 0, updated_at: db.fn.now() }).returning('*');
    } else {
      [task] = await db('scheduled_tasks').insert({
        name: ent === 'general' ? 'Monthly payroll auto-prepare (Head Office)' : 'Monthly payroll auto-prepare', task_type: PAYROLL_TASK,
        cron_expression: 'monthly', is_active: active, config, next_run: nextRun,
      }).returning('*');
    }
    const cfg = parseTaskConfig(task);
    return res.json({ success: true, data: { schedule: { id: task.id, entity: ent, active: !!task.is_active, payMethod: cfg.pay_method, dayOfMonth: cfg.day_of_month, notes: cfg.notes, nextRun: task.next_run } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Trigger the scheduled prepare now. With a `month`, prepares that month (the
// open-month rule still applies); without, does exactly what the schedule does.
// Preparers (Mill Manager/admins), not operators. The caller is the preparer,
// so they cannot also approve the run.
router.post('/payroll/schedule/run-now', authorize('payroll', 'create'),
  auditAction('prepare', 'mill_payroll_run', (req, data) => data.data?.run?.id), async (req, res) => {
  try {
    const ent = scheduleEntity(req.body.entity);
    const task = await payrollTaskFor(ent);
    const cfg = task ? parseTaskConfig(task) : {};
    if (req.body.month && /^\d{4}-\d{2}$/.test(req.body.month)) {
      const month = req.body.month;
      try {
        const run = await preparePayrollRun({ month, entity: ent, pay_method: cfg.pay_method || 'cash', notes: `Payroll auto-prepared for ${month}` }, req.user?.id);
        return res.json({ success: true, data: { run, runs: [run], prepared: true } });
      } catch (e) {
        if (e.code === 'NONE') return res.json({ success: true, data: { run: null, runs: [], prepared: false, message: e.message } });
        throw e;
      }
    }
    const results = await payrollService.prepareScheduledPayroll({ entity: ent, pay_method: cfg.pay_method || 'cash', userId: req.user?.id || null });
    const runs = results.map((r) => r.run).filter(Boolean);
    return res.json({ success: true, data: {
      run: runs[runs.length - 1] || null, runs, prepared: runs.length > 0,
      message: runs.length ? null : results.map((r) => r.message).filter(Boolean).join(' '),
    } });
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
    // Maker ≠ checker (P2-25): whoever prepared the run cannot approve it —
    // except an Owner (the business may have no other approver), and then the
    // run is marked self-approved so the exception is on record.
    const selfApproved = !!run.created_by && run.created_by === req.user?.id;
    if (selfApproved && !await isOwnerUser(req)) {
      return res.status(403).json({ success: false, code: 'SAME_PREPARER', message: 'You prepared this run, so someone else must approve it.' });
    }
    // Conditional on the status still being 'prepared' so a racing void/approve
    // can't be overwritten after the check above.
    const [updated] = await db('mill_payroll_runs').where('id', run.id).where('status', 'prepared')
      .update({ status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), self_approved: selfApproved, updated_at: db.fn.now() }).returning('*');
    if (!updated) return res.status(409).json({ success: false, message: 'This run changed while you were approving it — refresh and try again.' });
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
// is Settled. Gate: payroll.pay (P2-25 — an approver must not also book the
// salary cost; Accrue is the payer's alternative to Pay).
router.post('/payroll/runs/:id/accrue', authorize('payroll', 'pay'),
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
        }, req.user?.id, trx, { strictLedger: true });
      }

      let assetRecovered = 0;
      for (const l of lines) {
        const ded = parseFloat(l.advance_deducted) || 0;
        if (ded > 0 && l.worker_id) {
          const rec = await recoverAdvancesForWorker(trx, l.worker_id, ded, { period: run.period, runId: run.id, lineId: l.id });
          assetRecovered += rec.assetApplied;
        }
        if (l.skip_reason && l.worker_id) await markPeriodSkipped(trx, l.worker_id, run.period, l.skip_reason);
      }
      await postRecoveryJournal(trx, {
        amount: assetRecovered, date: run.pay_date, entity: run.entity, refNo: `ADVREC-RUN-${run.id}`, userId: req.user?.id,
        description: `Salary advances recovered — payroll ${run.period} (run #${run.id}, accrued)`,
      });
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

    // ONE locked transaction: the cash-out and the status flip commit together.
    // They used to be separate, so a second concurrent settle could pass the
    // 'accrued' check above and pay again, or a failed flip left the expense
    // paid while the run still read 'accrued'.
    const updated = await db.transaction(async (trx) => {
      const locked = await trx('mill_payroll_runs').where('id', run.id).forUpdate().first();
      if (!locked || locked.status !== 'accrued') {
        const e = new Error(`Only an Accrued run can be settled (status ${locked?.status || 'missing'}).`); e.statusCode = 409; throw e;
      }
      // Settle the accrued payable (no-op if a zero-net run had no expense).
      if (locked.expense_id) {
        await expensesService.markPaid(locked.expense_id, {
          bank_account_id: locked.bank_account_id || null,
          payment_method: locked.pay_method || 'cash',
          paid_date: locked.pay_date,
        }, req.user?.id, trx);
      }
      const [r] = await trx('mill_payroll_runs').where('id', locked.id)
        .update({ status: 'paid', paid_by: req.user?.id || null, paid_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*');
      return r;
    });
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
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
    // Conditional on the status so a void can't land on a run that a concurrent
    // Pay/Accrue has just moved on (that would hide posted money behind 'voided').
    const [updated] = await db('mill_payroll_runs').where('id', run.id).whereIn('status', ['prepared', 'approved'])
      .update({ status: 'voided', voided_by: req.user?.id || null, voided_at: db.fn.now(), void_reason: (typeof req.body?.reason === 'string' && req.body.reason.trim()) || null, updated_at: db.fn.now() }).returning('*');
    if (!updated) return res.status(409).json({ success: false, message: 'This run changed while you were voiding it — refresh and try again.' });
    // Its lines no longer hold the employees' month (uq_mill_payroll_lines_worker_period).
    await db('mill_payroll_lines').where('run_id', updated.id).update({ active: false, updated_at: db.fn.now() });
    return res.json({ success: true, data: { run: updated } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Undo a payroll run — reverse its cash-out (+ GL) with signed-delta journals
// and reversing bank rows, restore the advances it recovered to outstanding,
// and keep the run as 'reversed' (nothing posted is deleted). Refused while a
// statutory liability the run withheld has been remitted since.
router.delete('/payroll/runs/:id', authorize('payroll', 'delete'),
  auditAction('reverse', 'mill_payroll_run', (req) => req.params.id),
  async (req, res) => {
  try {
    const run = await db('mill_payroll_runs').where('id', req.params.id).first();
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found.' });
    if (run.status === 'reversed') {
      return res.status(409).json({ success: false, message: 'This payroll run has already been reversed.' });
    }
    // A Prepared/Approved/Voided run never posted money or recovered advances —
    // just delete it (lines cascade). Paid/posted/accrued AND partially_paid
    // (one or more cash batches) runs need full reversal.
    const MONEY_STATUSES = ['paid', 'posted', 'accrued', 'partially_paid'];
    if (!MONEY_STATUSES.includes(run.status)) {
      await db('mill_payroll_runs').where('id', run.id).del();
      return res.json({ success: true, data: { deleted: run.id } });
    }
    const userId = req.user?.id || null;
    const reason = (typeof req.body?.reason === 'string' && req.body.reason.trim()) || null;
    const out = await db.transaction(async (trx) => {
      const locked = await trx('mill_payroll_runs').where('id', run.id).forUpdate().first();
      if (!locked || !MONEY_STATUSES.includes(locked.status)) {
        const e = new Error(`This run changed while it was being reversed (now ${locked?.status || 'missing'}) — refresh and try again.`);
        e.statusCode = 409; throw e;
      }
      // Every salaries expense the run created (one per pay batch + run.expense_id
      // for accrued/legacy single-batch runs) and each batch's statutory ref.
      const expIds = new Set();
      if (locked.expense_id) expIds.add(locked.expense_id);
      const lineExp = await trx('mill_payroll_lines').where('run_id', locked.id).whereNotNull('expense_id').distinct('expense_id');
      for (const r of lineExp) expIds.add(r.expense_id);
      const statRefs = [...[...expIds].map((id) => `STAT-EXP-${id}`), `STAT-RUN-${locked.id}`];
      // Withheld tax / EOBI already paid over to the authority can't be pulled
      // back by undoing the run — refuse rather than leave 2050/2055 owing us.
      const remitted = await remittedStatutoryForRun(trx, locked, statRefs);
      if (remitted.length) {
        const e = new Error(`Statutory deductions withheld by this run have been remitted since (${remitted.join(', ')}). Reverse those remittances first, or correct the run with an adjustment instead of undoing it.`);
        e.statusCode = 409; throw e;
      }
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
          const wasRecovered = l.paid_at || ['accrued', 'paid', 'posted'].includes(locked.status);
          if (parseFloat(l.advance_deducted) > 0 && l.worker_id && wasRecovered) {
            await unrecoverAdvancesForWorker(trx, l.worker_id, l.advance_deducted);
          }
        }
      }
      // Reverse every salaries expense (cash-out, accrual, payable) and every
      // statutory journal — signed deltas, never deletes.
      const opts = { userId, reason: reason || `Payroll run ${locked.period} (#${locked.id}) reversed` };
      const reversed = [];
      for (const expId of expIds) reversed.push(await unwindAdvanceExpense(trx, expId, opts));
      const statJournals = [];
      for (const ref of statRefs) statJournals.push(...await reverseStatutoryJournal(trx, ref, opts));
      // The Dr 6135 / Cr 1330 recovery journal(s) of advances booked as an asset.
      const recoveryJournals = await reverseRecoveryJournals(trx, `ADVREC-RUN-${locked.id}`, opts);
      // The lines no longer count as paid anywhere (payslips, tax statements,
      // YTD all read paid_at / paid runs) nor hold the month; expense_id stays
      // for the trail.
      await trx('mill_payroll_lines').where('run_id', locked.id).update({ paid_at: null, paid_by: null, active: false, updated_at: trx.fn.now() });
      const [updated] = await trx('mill_payroll_runs').where('id', locked.id).update({
        status: 'reversed', reversed_at: trx.fn.now(), reversed_by: userId, reversal_reason: reason, updated_at: trx.fn.now(),
      }).returning('*');
      return { run: updated, expenses: reversed, statutoryJournals: statJournals, recoveryJournals };
    });
    return res.json({ success: true, data: { reversed: run.id, ...out } });
  } catch (err) {
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: err.message });
  }
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

// Packing runs carry bag / master / poly costs: cost-blind roles may record and
// read them, but every money figure in the response is nulled for them.
router.post(
  '/batches/:id/packing',
  authorize('mill_store', 'record_consumption'),
  redactCostInResponses(),
  auditAction('pack_batch', 'milling_batch', (req) => req.params.id),
  packingCtrl.pack
);
router.get(
  '/batches/:id/packing',
  authorize('mill_store', 'view'),
  redactCostInResponses(),
  packingCtrl.history
);
// Correct / delete a packing run. The route needs the permission that records
// packing; the service then applies the batch-status rule (packingGate):
// Completed → Owner / Super Admin / Mill Manager only, Cancelled/Rejected →
// nobody. The audit entry carries the run's before → after image.
router.put(
  '/batches/:id/packing/:logId',
  authorize('mill_store', 'record_consumption'),
  validate(schemas.updatePackingRun),
  auditAction('edit_packing_run', 'mill_packing_log', (req) => req.params.logId),
  packingCtrl.updateRun
);
router.delete(
  '/batches/:id/packing/:logId',
  authorize('mill_store', 'record_consumption'),
  auditAction('delete_packing_run', 'mill_packing_log', (req) => req.params.logId),
  packingCtrl.deleteRun
);
// The bag this batch packs into — set or clear the batch's own override of
// the export order's line spec. Same status rule, with milling.edit.
router.put(
  '/batches/:id/packing-spec',
  authorize('milling', 'edit'),
  validate(schemas.batchPackSpec),
  auditAction('set_packing_spec', 'milling_batch', (req) => req.params.id),
  packingCtrl.setPackSpec
);
router.get('/batches/:id/katta', authorize('milling', 'view'), controller.getBatchKatta);

// ── Packaging recorded on a batch, line by line (mig 307) ──
// A batch could only ever state one bag size, so "300 katta and 500 P.P. bags"
// could not be said at all. Each line names a real packaging item, so its type
// decides which stock it moves and its own price decides what it costs.
const batchPackagingCtrl = require('./batchPackaging.controller');
router.get(
  '/batches/:id/packaging',
  authorize('milling', 'view'),
  redactCostInResponses(), // unit/total cost per line — nulled for cost-blind roles
  batchPackagingCtrl.list
);
// Saving moves store stock, so it sits behind the same permission as recording
// any other store consumption rather than plain milling edit.
router.put(
  '/batches/:id/packaging',
  authorize('mill_store', 'record_consumption'),
  redactCostInResponses(),
  validate(schemas.saveBatchPackaging),
  auditAction('save_batch_packaging', 'milling_batch', (req) => req.params.id),
  batchPackagingCtrl.save
);

module.exports = router;
