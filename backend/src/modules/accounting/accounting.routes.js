const express = require('express');
const router = express.Router();
const controller = require('../../controllers/accountingController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const fxRevaluation = require('./fxRevaluation');
const ownerApproval = require('../../middleware/ownerApproval');

// ═══════════════════════════════════════════════════════════════════
// Chart of Accounts
// ═══════════════════════════════════════════════════════════════════
router.get('/accounts', authorize('finance', 'view'), controller.listAccounts);
router.post(
  '/accounts',
  authorize('finance', 'post_journal'),
  auditAction('create_account', 'chart_of_accounts'),
  controller.createAccount
);
router.put(
  '/accounts/:id',
  authorize('finance', 'post_journal'),
  auditAction('update_account', 'chart_of_accounts'),
  controller.updateAccount
);

// ═══════════════════════════════════════════════════════════════════
// Journal Entries
// ═══════════════════════════════════════════════════════════════════
router.get('/journals', authorize('finance', 'view'), controller.listJournals);
// Manual journals (D-2): Finance Manager creates and posts; control accounts
// are refused; each writes its audit row inside its own transaction (P2-30).
router.post(
  '/journals',
  authorize('finance', 'post_journal'),
  validate(schemas.createJournal),
  auditAction('create_journal', 'journal_entries'),
  controller.createJournal
);
router.put(
  '/journals/:id/post',
  authorize('finance', 'post_journal'),
  auditAction('post_journal', 'journal_entries'),
  controller.postJournal
);
// A reversal needs a reason and the Owner's approval, and is posted as a dated
// signed-delta journal (never a status flip of a closed period's entry).
// ownerApproval runs BEFORE validate (which would strip its fields).
router.post(
  '/journals/:id/reverse',
  authorize('finance', 'post_journal'),
  ownerApproval('journal_reversal'),
  validate(schemas.reverseJournal),
  auditAction('reverse_journal', 'journal_entries'),
  controller.reverseJournal
);

// The '/auto-post' "testing endpoint" is gone (P2-13): it let anyone with
// finance.post_journal fire any posting rule for any amount — a GL entry with
// no document behind it.

// ═══════════════════════════════════════════════════════════════════
// Posting Rules
// ═══════════════════════════════════════════════════════════════════
router.get('/posting-rules', authorize('finance', 'view'), controller.listPostingRules);
router.post(
  '/posting-rules',
  authorize('finance', 'post_journal'),
  auditAction('create_posting_rule', 'posting_rules'),
  controller.createPostingRule
);
router.put(
  '/posting-rules/:id',
  authorize('finance', 'post_journal'),
  auditAction('update_posting_rule', 'posting_rules'),
  controller.updatePostingRule
);

// ═══════════════════════════════════════════════════════════════════
// Periods
// ═══════════════════════════════════════════════════════════════════
router.get('/periods', authorize('finance', 'view'), controller.listPeriods);
router.put(
  '/periods/:id/close',
  authorize('finance', 'post_journal'),
  auditAction('close_period', 'accounting_periods'),
  controller.closePeriod
);
// Reopening a closed period changes books already reported on: it needs a
// reason and the Owner's approval (P2-13).
router.put(
  '/periods/:id/reopen',
  authorize('finance', 'post_journal'),
  ownerApproval('period_reopen'),
  validate(schemas.reopenPeriod),
  auditAction('reopen_period', 'accounting_periods'),
  controller.reopenPeriod
);

// ═══════════════════════════════════════════════════════════════════
// Bank Reconciliation
// ═══════════════════════════════════════════════════════════════════
// B5 — Finance › Accounts › Reconcile. Reading is finance.view; starting,
// ticking, importing statement lines and completing are finance.post_journal.
router.get('/reconciliations', authorize('finance', 'view'), controller.listReconciliations);
router.post(
  '/reconciliations',
  authorize('finance', 'post_journal'),
  validate(schemas.createReconciliation),
  auditAction('create_reconciliation', 'bank_reconciliation', (req, data) => data?.data?.reconciliation?.id || null),
  controller.createReconciliation
);
router.get('/reconciliations/:id', authorize('finance', 'view'), controller.getReconciliation);
router.put(
  '/reconciliations/:id/ticks',
  authorize('finance', 'post_journal'),
  validate(schemas.saveReconciliationTicks),
  auditAction('save_reconciliation', 'bank_reconciliation', (req) => req.params.id),
  controller.saveReconciliationTicks
);
router.post(
  '/reconciliations/:id/items',
  authorize('finance', 'post_journal'),
  validate(schemas.reconciliationStatementLines),
  auditAction('add_reconciliation_items', 'bank_reconciliation', (req) => req.params.id),
  controller.addReconciliationItems
);
router.put(
  '/reconciliations/:id/match',
  authorize('finance', 'post_journal'),
  auditAction('match_reconciliation', 'bank_reconciliation'),
  controller.matchReconciliationItems
);
router.put(
  '/reconciliations/:id/complete',
  authorize('finance', 'post_journal'),
  auditAction('complete_reconciliation', 'bank_reconciliation'),
  controller.completeReconciliation
);

// ═══════════════════════════════════════════════════════════════════
// FX Rates
// ═══════════════════════════════════════════════════════════════════
router.get('/fx-rates', authorize('finance', 'view'), controller.listFxRates);
router.post(
  '/fx-rates',
  authorize('finance', 'post_journal'),
  auditAction('set_fx_rate', 'fx_rates'),
  controller.setFxRate
);

// Month-end FX revaluation (G-7): open USD AR + USD bank GL at the month's
// closing rate → 6210, dated month-end, auto-reversed on the 1st. Idempotent
// per month; preview: true computes without posting; rerun: true replaces.
router.get('/fx-revaluation', authorize('finance', 'view'), async (req, res) => {
  try {
    return res.json({ success: true, data: { revaluations: await fxRevaluation.list(req.query) } });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});
router.get('/fx-revaluation/preview', authorize('finance', 'post_journal'), async (req, res) => {
  try {
    const data = await fxRevaluation.revalue({ monthEnd: req.query.month_end, currency: req.query.currency || 'USD', preview: true });
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});
router.post(
  '/fx-revaluation',
  authorize('finance', 'post_journal'),
  validate(schemas.fxRevaluation),
  auditAction('fx_revaluation', 'fx_revaluations', (req, data) => data?.data?.revaluation?.id),
  async (req, res) => {
    try {
      const { month_end: monthEnd, currency, rerun, preview } = req.body;
      const data = await fxRevaluation.revalue({ monthEnd, currency: currency || 'USD', rerun: !!rerun, preview: !!preview, userId: req.user?.id || null });
      return res.status(preview ? 200 : 201).json({ success: true, data });
    } catch (err) {
      const period = /Accounting period .* is /.test(String(err.message));
      return res.status(err.statusCode || (period ? 400 : 500)).json({ success: false, message: err.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// Financial Statements
// ═══════════════════════════════════════════════════════════════════
router.get('/statements/trial-balance', authorize('finance', 'view'), controller.trialBalance);
router.get('/statements/profit-loss', authorize('finance', 'view'), controller.profitAndLoss);
router.get('/statements/balance-sheet', authorize('finance', 'view'), controller.balanceSheet);
router.get('/statements/cash-flow', authorize('finance', 'view'), controller.cashFlow);
router.get('/statements/customer/:id', authorize('finance', 'view'), controller.customerStatement);
router.get('/statements/supplier/:id', authorize('finance', 'view'), controller.supplierStatement);
router.get('/statements/allocation/:type/:id', authorize('finance', 'view'), controller.partyAllocation);

// ═══════════════════════════════════════════════════════════════════
// Account Queries
// ═══════════════════════════════════════════════════════════════════
router.get('/accounts/:id/balance', authorize('finance', 'view'), controller.accountBalance);
router.get('/accounts/:id/transactions', authorize('finance', 'view'), controller.accountTransactions);

module.exports = router;
