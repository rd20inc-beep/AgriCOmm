const express = require('express');
const router = express.Router();
const db = require('../config/database');
const controller = require('../controllers/millingController');
const advancedController = require('../controllers/millingAdvancedController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

// =============================================================================
// Existing Batch Routes
// =============================================================================

router.get('/batches', authorize('milling', 'view'), controller.list);
router.get('/batches/:id', authorize('milling', 'view'), controller.getById);
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
// Mill Expenses (Overheads: salaries, rent, utilities, etc.)
// =============================================================================

router.get('/expenses', authorize('milling', 'view'), async (req, res) => {
  try {
    const { limit = 100, period } = req.query;
    let query = db('mill_expenses').orderBy('expense_date', 'desc').limit(parseInt(limit));
    if (period) query = query.where('period', period);
    const expenses = await query;
    const summary = await db('mill_expenses').select('category')
      .sum('amount as total').groupBy('category').orderBy('total', 'desc');
    return res.json({ success: true, data: { expenses, summary } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/expenses', authorize('milling', 'create'),
  auditAction('create', 'mill_expense', (req, data) => data.data?.expense?.id),
  async (req, res) => {
    try {
      const { category, description, amount, expense_date, period, payment_method, reference, notes, mill_id } = req.body;
      if (!category || !amount || !expense_date) {
        return res.status(400).json({ success: false, message: 'category, amount, and expense_date are required.' });
      }
      const [expense] = await db('mill_expenses').insert({
        mill_id: mill_id || null,
        category,
        description: description || null,
        amount: parseFloat(amount),
        expense_date,
        period: period || expense_date.substring(0, 7),
        payment_method: payment_method || null,
        reference: reference || null,
        notes: notes || null,
        created_by: req.user?.id,
      }).returning('*');
      return res.json({ success: true, data: { expense } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================================================================
// Mill Workers & Payroll
// =============================================================================

router.get('/workers', authorize('milling', 'view'), async (req, res) => {
  try {
    const workers = await db('mill_workers').orderBy('name');
    return res.json({ success: true, data: { workers } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/workers', authorize('milling', 'create'), async (req, res) => {
  try {
    const { name, role, daily_wage, phone, cnic, joined_date, mill_id, notes } = req.body;
    if (!name || !daily_wage) return res.status(400).json({ success: false, message: 'name and daily_wage required.' });
    const [worker] = await db('mill_workers').insert({
      name, role: role || 'laborer', daily_wage: parseFloat(daily_wage),
      phone: phone || null, cnic: cnic || null,
      joined_date: joined_date || new Date().toISOString().split('T')[0],
      mill_id: mill_id || null, notes: notes || null,
    }).returning('*');
    return res.json({ success: true, data: { worker } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/attendance', authorize('milling', 'view'), async (req, res) => {
  try {
    const { month, worker_id } = req.query;
    let query = db('mill_attendance as a')
      .leftJoin('mill_workers as w', 'a.worker_id', 'w.id')
      .select('a.*', 'w.name as worker_name', 'w.daily_wage')
      .orderBy('a.date', 'desc');
    if (month) query = query.where('a.date', '>=', `${month}-01`).where('a.date', '<', `${month}-32`);
    if (worker_id) query = query.where('a.worker_id', worker_id);
    const records = await query.limit(500);
    return res.json({ success: true, data: { attendance: records } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/attendance', authorize('milling', 'create'), async (req, res) => {
  try {
    const { worker_id, date, status, hours_worked, overtime_hours, notes } = req.body;
    if (!worker_id || !date) return res.status(400).json({ success: false, message: 'worker_id and date required.' });
    const [record] = await db('mill_attendance').insert({
      worker_id, date, status: status || 'present',
      hours_worked: hours_worked || 8, overtime_hours: overtime_hours || 0,
      notes: notes || null,
    }).returning('*').onConflict(['worker_id', 'date']).merge();
    return res.json({ success: true, data: { attendance: record } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/payroll/summary', authorize('milling', 'view'), async (req, res) => {
  try {
    const { month } = req.query;
    const startDate = month ? `${month}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = month ? `${month}-31` : new Date().toISOString().split('T')[0];

    const workers = await db('mill_workers').where('is_active', true).orderBy('name');
    const attendance = await db('mill_attendance')
      .where('date', '>=', startDate).where('date', '<=', endDate);

    const summary = workers.map(w => {
      const records = attendance.filter(a => a.worker_id === w.id);
      const daysPresent = records.filter(a => a.status === 'present').length;
      const halfDays = records.filter(a => a.status === 'half_day').length;
      const totalOT = records.reduce((s, a) => s + (parseFloat(a.overtime_hours) || 0), 0);
      const effectiveDays = daysPresent + (halfDays * 0.5);
      const basicPay = effectiveDays * parseFloat(w.daily_wage);
      const otPay = totalOT * (parseFloat(w.daily_wage) / 8 * 1.5);
      return {
        ...w, daysPresent, halfDays, effectiveDays, totalOT,
        basicPay: Math.round(basicPay), otPay: Math.round(otPay),
        totalPay: Math.round(basicPay + otPay),
      };
    });

    const grandTotal = summary.reduce((s, w) => s + w.totalPay, 0);
    return res.json({ success: true, data: { summary, grandTotal, period: { startDate, endDate } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
