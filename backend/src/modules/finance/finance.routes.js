const express = require('express');
const router = express.Router();
const controller = require('../../controllers/financeController');
const authorize = require('../../middleware/rbac');
const { authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const fundTransfers = require('../finance/fundTransfers.service');
const ownerApproval = require('../../middleware/ownerApproval');

// ── Head Office ⇄ Mill fund transfers ──
router.get('/fund-transfers', authorize('finance', 'view'), async (req, res) => {
  try {
    const transfers = await fundTransfers.list(req.query);
    return res.json({ success: true, data: { transfers } });
  } catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});
router.post('/fund-transfers', authorize('finance', 'confirm_payment'),
  auditAction('fund_transfer', 'finance', (req, data) => data?.data?.transfer?.id || null),
  async (req, res) => {
    try {
      const transfer = await fundTransfers.create(req.body, req.user?.id);
      return res.json({ success: true, data: { transfer } });
    } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
  });
router.post('/fund-transfers/:id/accept', authorize('milling', 'edit'),
  ownerApproval('fund_transfer'),
  auditAction('accept_fund_transfer', 'finance', (req) => req.params.id),
  async (req, res) => {
    try {
      const transfer = await fundTransfers.accept(req.params.id, req.user?.id);
      return res.json({ success: true, data: { transfer } });
    } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
  });
router.delete('/fund-transfers/:id', authorize('finance', 'confirm_payment'), async (req, res) => {
  try {
    const result = await fundTransfers.remove(req.params.id, req.user?.id);
    return res.json({ success: true, data: result });
  } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

router.get('/receivables', authorize('finance', 'view'), controller.getReceivables);
router.get('/receivables/:id/receipts', authorize('finance', 'view'), controller.getReceivableReceipts);
router.get('/payables', authorize('finance', 'view'), controller.getPayables);
router.get('/payables/:id/payments', authorize('finance', 'view'), controller.getPayablePayments);
router.get('/purchases/:source/:sourceId/payments', authorize('finance', 'view'), controller.getPurchasePayments);
router.get('/mill-lot-costs', authorize('finance', 'view'), controller.getMillLotCosts);
router.get('/journal-entries', authorize('finance', 'view'), controller.getJournalEntries);
router.get('/alerts', authorize('finance', 'view'), controller.getAlerts);
router.get('/overview', authorize('finance', 'view'), controller.getOverview);
router.get('/upcoming', authorize('finance', 'view'), controller.getUpcoming);
router.post('/payments/:id/clear', authorize('finance', 'confirm_payment'), controller.clearCheque);
router.post(
  '/payments',
  authorize('finance', 'confirm_payment'),
  validate(schemas.recordPayment),
  auditAction('record_payment', 'finance', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.recordPayment
);
router.get('/payments', authorize('finance', 'view'), controller.listPayments);
router.get('/purchases', authorize('finance', 'view'), controller.listPurchases);
router.post(
  '/purchases/pay',
  authorize('finance', 'confirm_payment'),
  auditAction('pay_purchase', 'finance', (req, data) => data?.data?.source_id || null),
  controller.payPurchase
);
router.get('/bank-accounts', authorize('finance', 'view'), controller.getBankAccounts);
router.get('/bank-transactions', authorize('finance', 'view'), controller.getBankTransactions);
router.get('/internal-transfers', authorize('finance', 'view'), controller.getInternalTransfers);
router.post(
  '/internal-transfers',
  authorize('inventory', 'transfer'),
  validate(schemas.createInternalTransfer),
  auditAction('create_internal_transfer', 'finance', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createInternalTransfer
);
router.get('/internal-transfers/:id', authorize('finance', 'view'), controller.getInternalTransferDetail);
router.put(
  '/internal-transfers/:id/confirm-export',
  // Mill side (inventory.transfer) OR the export team (export_orders.edit) may
  // accept an incoming transfer — the export manager accepts what the mill sent.
  authorizeAny(['inventory', 'transfer'], ['export_orders', 'edit']),
  auditAction('confirm_internal_transfer_export', 'internal_transfers', (req) => req.params.id),
  controller.confirmInternalTransferExport
);

// Phase 2: Centralized finance summary endpoints
const financeService = require('../../services/financeService');

router.get('/overview-summary', authorize('finance', 'view'), async (req, res) => {
  try {
    const { start_date, end_date, entity } = req.query;
    const summary = await financeService.getOverviewSummary({ startDate: start_date, endDate: end_date, entity });
    return res.json({ success: true, data: summary });
  } catch (err) {
    console.error('Finance overview-summary error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/profitability-summary', authorize('finance', 'view'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const summary = await financeService.getProfitabilitySummary({ startDate: start_date, endDate: end_date });
    return res.json({ success: true, data: summary });
  } catch (err) {
    console.error('Finance profitability-summary error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Cost Allocations
router.get('/cost-allocations', authorize('finance', 'view'), controller.listCostAllocations);
router.post(
  '/cost-allocations',
  authorize('finance', 'confirm_payment'),
  auditAction('create_cost_allocation', 'cost_allocation'),
  controller.createCostAllocation
);
router.post(
  '/cost-allocations/:id/lines',
  authorize('finance', 'confirm_payment'),
  auditAction('add_allocation_line', 'cost_allocation', (req) => req.params.id),
  controller.addAllocationLine
);
router.delete(
  '/cost-allocations/:allocationId/lines/:lineId',
  authorize('finance', 'confirm_payment'),
  auditAction('remove_allocation_line', 'cost_allocation', (req) => req.params.allocationId),
  controller.removeAllocationLine
);

// ── FX Rates ──
const fxRateService = require('../../services/fxRateService');
const commodityRateService = require('../../services/commodityRateService');

router.get('/fx-rates', authorize('finance', 'view'), async (req, res) => {
  try {
    const { currency = 'USD' } = req.query;
    const rates = await fxRateService.listRates(currency);
    const latest = await fxRateService.getLatestRate(currency);
    return res.json({ success: true, data: { rates, latest } });
  } catch (err) {
    console.error('FX rates error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/fx-rates', authorize('finance', 'confirm_payment'), async (req, res) => {
  try {
    const { currency_code, rate, effective_date, source_type, notes } = req.body;
    if (!currency_code || !rate || !effective_date) {
      return res.status(400).json({ success: false, message: 'currency_code, rate, and effective_date are required' });
    }
    const row = await fxRateService.addRate({
      currencyCode: currency_code, rate: parseFloat(rate),
      effectiveDate: effective_date, sourceType: source_type || 'manual',
      notes, createdBy: req.user?.id,
    });
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('Add FX rate error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/fx-rates/refresh', authorize('finance', 'confirm_payment'), async (req, res) => {
  try {
    const result = await fxRateService.refreshCurrentFxValues();
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('FX refresh error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Commodity / Product Rates ──
router.get('/commodity-rates', authorize('finance', 'view'), async (req, res) => {
  try {
    const { rate_type } = req.query;
    const rates = rate_type ? await commodityRateService.listRates(rate_type) : await commodityRateService.getCurrentRates();
    return res.json({ success: true, data: rates });
  } catch (err) {
    console.error('Commodity rates error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/commodity-rates', authorize('finance', 'confirm_payment'), async (req, res) => {
  try {
    const row = await commodityRateService.upsertRate({
      ...req.body, createdBy: req.user?.id,
    });
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('Add commodity rate error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Suspense Account (#8): unidentified money → resolve/reclassify later ──
const suspenseService = require('./suspense.service');
const wrapSuspense = (fn) => async (req, res) => {
  try { return res.json({ success: true, data: await fn(req) }); }
  catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
};
router.get('/suspense', authorize('finance', 'view'), wrapSuspense((req) => suspenseService.list(req.query)));
router.get('/suspense/summary', authorize('finance', 'view'), wrapSuspense(() => suspenseService.summary()));
router.get('/suspense/:id', authorize('finance', 'view'), wrapSuspense((req) => suspenseService.get(req.params.id)));
router.post('/suspense', authorize('finance', 'confirm_payment'),
  auditAction('create_suspense', 'suspense_entries', (req, data) => data?.data?.id || null),
  wrapSuspense((req) => suspenseService.create(req.body, req.user?.id)));
// Resolve + reverse post reclassification journals → gated on post_journal
// (Finance Manager + Owner/Super Admin only, per "only Finance/Admin resolve").
router.post('/suspense/:id/resolve', authorize('finance', 'post_journal'),
  auditAction('resolve_suspense', 'suspense_entries', (req) => req.params.id),
  wrapSuspense((req) => suspenseService.resolve(req.params.id, req.body, req.user?.id)));
router.post('/suspense/:id/reverse', authorize('finance', 'post_journal'),
  auditAction('reverse_suspense', 'suspense_entries', (req) => req.params.id),
  wrapSuspense((req) => suspenseService.reverse(req.params.id, req.body?.reason, req.user?.id)));
router.post('/suspense/:id/review', authorize('finance', 'view'),
  auditAction('review_suspense', 'suspense_entries', (req) => req.params.id),
  wrapSuspense((req) => suspenseService.setUnderReview(req.params.id, req.user?.id)));

module.exports = router;
