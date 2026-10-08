const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('../../controllers/financeController');
const authorize = require('../../middleware/rbac');
const { authorizeAny, authorizeRole } = require('../../middleware/rbac');
const db = require('../../config/database');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const fundTransfers = require('../finance/fundTransfers.service');
const { isMillOnlyPayer } = require('../../shared/millPayer');

// #14 Phase 1e — supporting-document upload for payments (WHT certificate,
// vendor invoice, receipt). Disk storage under uploads/payments, mirroring the
// documents module. The stored relative name is saved on the payment as
// attachment_url and served back via the GET route below.
const PAY_UPLOAD_DIR = require('../../config/paths').uploadPath('payments');
const payAttachStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(PAY_UPLOAD_DIR)) fs.mkdirSync(PAY_UPLOAD_DIR, { recursive: true });
    cb(null, PAY_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});
const payAttachUpload = multer({ storage: payAttachStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// Contra-transfer supporting documents (bank advice, deposit slip) — same
// pattern as payment attachments, own folder uploads/contra.
const CONTRA_UPLOAD_DIR = require('../../config/paths').uploadPath('contra');
const contraAttachUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(CONTRA_UPLOAD_DIR)) fs.mkdirSync(CONTRA_UPLOAD_DIR, { recursive: true });
      cb(null, CONTRA_UPLOAD_DIR);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Error → response for the transfer routes. A 409 carrying the transfer that
// already exists (duplicate client_ref) returns it so the client can show it.
function sendTransferError(res, e) {
  const status = e.statusCode || e.status || 400;
  const body = { success: false, message: e.message };
  if (e.existing) body.data = { transfer: e.existing };
  return res.status(status).json(body);
}

// ── Contra transfers (money between the company's own accounts) ──
// Create: finance.confirm_payment, or milling.edit for a mill-only payer who
// may then use only the mill's own accounts (both sides — shared/millPayer).
// Same-entity → settles at once; Head Office ⇄ Mill → the two-phase flow.
const canMoveMoney = authorizeAny(['finance', 'confirm_payment'], ['milling', 'edit']);
router.post('/contra-transfers', canMoveMoney,
  validate(schemas.createContraTransfer),
  auditAction('contra_transfer', 'finance', (req, data) => data?.data?.transfer?.id || null),
  async (req, res) => {
    try {
      const millOnly = await isMillOnlyPayer(req);
      const transfer = await fundTransfers.createContra(req.body, req.user?.id, { millOnly });
      return res.json({ success: true, data: { transfer } });
    } catch (e) { return sendTransferError(res, e); }
  });
// The default rate the drawer pre-fills (fx_rates, else the system default).
router.get('/contra-transfers/rate', canMoveMoney, async (req, res) => {
  try {
    const currency = String(req.query.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'PKR') {
      return res.status(400).json({ success: false, message: 'currency must be a 3-letter non-PKR code.' });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : new Date().toISOString().slice(0, 10);
    const r = await require('./fxRate.service').getRateForDate(currency, date);
    return res.json({ success: true, data: { currency, date, rate: r.rate, source: r.source, effective_date: r.effectiveDate || null, warning: r.warning || null } });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});
router.post('/fund-transfers/attachment', canMoveMoney, contraAttachUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
  return res.json({ success: true, data: { url: req.file.filename, name: req.file.originalname } });
});
router.get('/fund-transfers/attachment/:file', authorize('finance', 'view'), (req, res) => {
  const safe = path.basename(req.params.file || '');
  const full = path.join(CONTRA_UPLOAD_DIR, safe);
  if (!full.startsWith(CONTRA_UPLOAD_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ success: false, message: 'Attachment not found.' });
  }
  return res.sendFile(full);
});
// Edit = reverse the original + create the corrected transfer, atomically.
// Owner / Super Admin, like reversal.
router.post('/fund-transfers/:id/replace', authorizeRole('Owner', 'Super Admin'),
  validate(schemas.replaceContraTransfer),
  auditAction('replace_fund_transfer', 'finance', (req) => req.params.id),
  async (req, res) => {
    try {
      // Everything but the reason is the corrected transfer. (Kept as an
      // explicit filter: the schema-strip sweep treats a rest-spread binding
      // off the body as a body field of that name.)
      const { reason } = req.body;
      const corrected = Object.fromEntries(Object.entries(req.body).filter(([k]) => k !== 'reason'));
      const result = await fundTransfers.replace(req.params.id, corrected, req.user?.id, { reason });
      return res.json({ success: true, data: result });
    } catch (e) { return sendTransferError(res, e); }
  });

// ── Head Office ⇄ Mill fund transfers ──
router.get('/fund-transfers', authorize('finance', 'view'), async (req, res) => {
  try {
    const transfers = await fundTransfers.list(req.query);
    return res.json({ success: true, data: { transfers } });
  } catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});
// One transfer: both sides' bank rows, journals, audit fields, replace links.
router.get('/fund-transfers/:id', authorize('finance', 'view'), async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) return res.status(404).json({ success: false, message: 'Fund transfer not found.' });
    const transfer = await fundTransfers.getById(req.params.id);
    return res.json({ success: true, data: { transfer } });
  } catch (e) { return sendTransferError(res, e); }
});
router.post('/fund-transfers', authorize('finance', 'confirm_payment'),
  auditAction('fund_transfer', 'finance', (req, data) => data?.data?.transfer?.id || null),
  async (req, res) => {
    try {
      const transfer = await fundTransfers.create(req.body, req.user?.id);
      return res.json({ success: true, data: { transfer } });
    } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
  });
// Accepting is authorised by the RECEIVING side, with no Owner step (owner
// decision 2026-10-06): Head Office (to_entity 'general') accepts with
// finance.confirm_payment, the Mill with milling.edit. It used to be
// milling.edit for every transfer, so a Head-Office finance user could not
// accept money sent to Head Office without a mill permission.
const ACCEPT_PERMISSION = {
  general: ['finance', 'confirm_payment'],
  mill: ['milling', 'edit'],
};
async function authorizeTransferAccept(req, res, next) {
  try {
    const t = await db('fund_transfers').where({ id: req.params.id }).first('id', 'to_entity');
    if (!t) return res.status(404).json({ success: false, message: 'Fund transfer not found.' });
    const perm = ACCEPT_PERMISSION[t.to_entity];
    if (!perm) return res.status(403).json({ success: false, message: `No accept permission is defined for ${t.to_entity} transfers.` });
    return authorize(perm[0], perm[1])(req, res, next);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Authorization check failed.' });
  }
}
router.post('/fund-transfers/:id/accept', authorizeTransferAccept,
  auditAction('accept_fund_transfer', 'finance', (req) => req.params.id),
  async (req, res) => {
    try {
      const transfer = await fundTransfers.accept(req.params.id, req.user?.id);
      return res.json({ success: true, data: { transfer } });
    } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
  });
// Reversal: equal-and-opposite bank moves + signed-delta journals, transfer
// marked 'reversed' (fundTransfers.reverse). Owner / Super Admin only. DELETE is
// kept as an alias so older clients still work — it no longer deletes anything.
async function reverseTransferHandler(req, res) {
  try {
    const result = await fundTransfers.reverse(req.params.id, req.user?.id, { reason: req.body?.reason });
    return res.json({ success: true, data: result });
  } catch (e) { return sendTransferError(res, e); }
}
// A reason is required (kept on the transfer as reversal_reason). The DELETE
// alias predates that and still reverses without one.
router.post('/fund-transfers/:id/reverse', authorizeRole('Owner', 'Super Admin'),
  validate(schemas.reverseFundTransfer),
  auditAction('reverse_fund_transfer', 'finance', (req) => req.params.id),
  reverseTransferHandler);
router.delete('/fund-transfers/:id', authorizeRole('Owner', 'Super Admin'),
  auditAction('reverse_fund_transfer', 'finance', (req) => req.params.id),
  reverseTransferHandler);

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
// Paying is finance.confirm_payment — or, for the MILL's own payables and
// receivables only, milling.edit (the Mill Operator, owner decision
// 2026-10-05). The handler refuses a mill-only payer anything whose entity is
// not 'mill' or any non-mill account (shared/millPayer). Reversal stays finance.
const canPayFinanceOrMill = authorizeAny(['finance', 'confirm_payment'], ['milling', 'edit']);
router.post(
  '/payments',
  canPayFinanceOrMill,
  validate(schemas.recordPayment),
  auditAction('record_payment', 'finance', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.recordPayment
);
router.post(
  '/payments/:id/reverse',
  authorize('finance', 'confirm_payment'),
  auditAction('reverse_payment', 'payment', (req) => req.params.id),
  controller.reversePayment
);
// #14 1e — upload a payment's supporting document, returns { url, name }.
router.post('/payments/attachment', authorize('finance', 'confirm_payment'), payAttachUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
  return res.json({ success: true, data: { url: req.file.filename, name: req.file.originalname } });
});
// Attach the supporting document to a payment that was recorded without one.
// Metadata only — the amount, accounts and ledger are untouched — so it sits
// behind the same permission as the upload itself, audited. A payment keeps
// the document it has: this fills an empty slot, it does not replace one.
router.put('/payments/:id/attachment', authorize('finance', 'confirm_payment'),
  validate(schemas.attachPaymentDocument),
  auditAction('attach_payment_document', 'payment', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const file = path.basename(String(req.body.attachment_url || ''));
      if (!id) return res.status(400).json({ success: false, message: 'Invalid payment id.' });
      if (!file || !fs.existsSync(path.join(PAY_UPLOAD_DIR, file))) {
        return res.status(400).json({ success: false, message: 'Upload the document first.' });
      }
      const p = await db('payments').where({ id }).first('id', 'attachment_url');
      if (!p) return res.status(404).json({ success: false, message: 'Payment not found.' });
      if (p.attachment_url) return res.status(409).json({ success: false, message: 'This payment already has a document attached.' });
      const [updated] = await db('payments').where({ id }).update({
        attachment_url: file, attachment_name: req.body.attachment_name || file, updated_at: db.fn.now(),
      }).returning(['id', 'attachment_url', 'attachment_name']);
      return res.json({ success: true, data: { payment: updated } });
    } catch (err) {
      console.error('attach payment document error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });
// Serve a stored payment attachment. The :file segment is a generated basename
// (no path separators) — resolve within the upload dir and reject traversal.
router.get('/payments/attachment/:file', authorize('finance', 'view'), (req, res) => {
  const safe = path.basename(req.params.file || '');
  const full = path.join(PAY_UPLOAD_DIR, safe);
  if (!full.startsWith(PAY_UPLOAD_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ success: false, message: 'Attachment not found.' });
  }
  return res.sendFile(full);
});
router.get('/payments', authorize('finance', 'view'), controller.listPayments);
// Read-only views behind the Finance drawers (transactionDetail.js): one
// movement with its payment, bank rows and journals; and the header search.
const transactionDetail = require('./transactionDetail');
router.get('/transactions/:kind/:id', authorize('finance', 'view'), transactionDetail.getTransactionDetail);
router.get('/search', authorize('finance', 'view'), transactionDetail.search);
router.get('/purchases', authorize('finance', 'view'), controller.listPurchases);
// Batch/order reference options for the Expenses link pickers (no party names) —
// so payments-only roles that can't load /milling|/export can still link.
router.get('/expense-link-options', authorize('finance', 'view'), controller.getExpenseLinkOptions);
router.post(
  '/purchases/pay',
  canPayFinanceOrMill,
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

// The headline profit figures (Booked / Realised / Pipeline / FX for export,
// mill realised, local other, consolidated) — the operations Dashboard tile
// reads this. Anyone who may see profit: finance.view or reports.view_profit.
router.get('/profit-headline', authorizeAny(['finance', 'view'], ['reports', 'view_profit']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const { profitDefinitions } = require('./profitDefinitions');
    const fx = await require('./fxRate.service').getLatestRate('USD');
    const defs = await profitDefinitions(db, { startDate: start_date, endDate: end_date, currentFxRate: fx.rate });
    // Totals only — the per-order rows stay on /profitability-summary.
    return res.json({ success: true, data: { ...defs, exportRows: undefined } });
  } catch (err) {
    console.error('Finance profit-headline error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Collection rate (C6): received ÷ amounts due, per currency, against the
// configurable target — the Finance Home tile and the operations Dashboard's
// Money Received tile. Anyone who may see money: finance.view or reports.view_cost.
router.get('/collection-rate', authorizeAny(['finance', 'view'], ['reports', 'view_cost']), async (req, res) => {
  try {
    const { collectionRate } = require('./collectionRate');
    return res.json({ success: true, data: await collectionRate(db) });
  } catch (err) {
    console.error('Finance collection-rate error:', err);
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
