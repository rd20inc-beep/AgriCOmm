const express = require('express');
const router = express.Router();
const controller = require('../../controllers/accountingController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// ═══════════════════════════════════════════════════════════════════
// Chart of Accounts
// ═══════════════════════════════════════════════════════════════════
router.get('/accounts', authorize('finance', 'view'), controller.listAccounts);
router.post(
  '/accounts',
  authorize('finance', 'create'),
  auditAction('create_account', 'chart_of_accounts'),
  controller.createAccount
);
router.put(
  '/accounts/:id',
  authorize('finance', 'update'),
  auditAction('update_account', 'chart_of_accounts'),
  controller.updateAccount
);

// ═══════════════════════════════════════════════════════════════════
// Journal Entries
// ═══════════════════════════════════════════════════════════════════
router.get('/journals', authorize('finance', 'view'), controller.listJournals);
router.post(
  '/journals',
  authorize('finance', 'create'),
  auditAction('create_journal', 'journal_entries'),
  controller.createJournal
);
router.put(
  '/journals/:id/post',
  authorize('finance', 'update'),
  auditAction('post_journal', 'journal_entries'),
  controller.postJournal
);
router.post(
  '/journals/:id/reverse',
  authorize('finance', 'update'),
  auditAction('reverse_journal', 'journal_entries'),
  controller.reverseJournal
);

// ═══════════════════════════════════════════════════════════════════
// Auto-Posting (testing endpoint)
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/auto-post',
  authorize('finance', 'create'),
  auditAction('auto_post', 'journal_entries'),
  controller.triggerAutoPost
);

// ═══════════════════════════════════════════════════════════════════
// Posting Rules
// ═══════════════════════════════════════════════════════════════════
router.get('/posting-rules', authorize('finance', 'view'), controller.listPostingRules);
router.post(
  '/posting-rules',
  authorize('finance', 'create'),
  auditAction('create_posting_rule', 'posting_rules'),
  controller.createPostingRule
);
router.put(
  '/posting-rules/:id',
  authorize('finance', 'update'),
  auditAction('update_posting_rule', 'posting_rules'),
  controller.updatePostingRule
);

// ═══════════════════════════════════════════════════════════════════
// Periods
// ═══════════════════════════════════════════════════════════════════
router.get('/periods', authorize('finance', 'view'), controller.listPeriods);
router.put(
  '/periods/:id/close',
  authorize('finance', 'update'),
  auditAction('close_period', 'accounting_periods'),
  controller.closePeriod
);
router.put(
  '/periods/:id/reopen',
  authorize('finance', 'update'),
  auditAction('reopen_period', 'accounting_periods'),
  controller.reopenPeriod
);

// ═══════════════════════════════════════════════════════════════════
// Bank Reconciliation
// ═══════════════════════════════════════════════════════════════════
router.get('/reconciliations', authorize('finance', 'view'), controller.listReconciliations);
router.post(
  '/reconciliations',
  authorize('finance', 'create'),
  auditAction('create_reconciliation', 'bank_reconciliation'),
  controller.createReconciliation
);
router.get('/reconciliations/:id', authorize('finance', 'view'), controller.getReconciliation);
router.post(
  '/reconciliations/:id/items',
  authorize('finance', 'create'),
  auditAction('add_reconciliation_items', 'bank_reconciliation'),
  controller.addReconciliationItems
);
router.put(
  '/reconciliations/:id/match',
  authorize('finance', 'update'),
  auditAction('match_reconciliation', 'bank_reconciliation'),
  controller.matchReconciliationItems
);
router.put(
  '/reconciliations/:id/complete',
  authorize('finance', 'update'),
  auditAction('complete_reconciliation', 'bank_reconciliation'),
  controller.completeReconciliation
);

// ═══════════════════════════════════════════════════════════════════
// FX Rates
// ═══════════════════════════════════════════════════════════════════
router.get('/fx-rates', authorize('finance', 'view'), controller.listFxRates);
router.post(
  '/fx-rates',
  authorize('finance', 'create'),
  auditAction('set_fx_rate', 'fx_rates'),
  controller.setFxRate
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

// ═══════════════════════════════════════════════════════════════════
// Account Queries
// ═══════════════════════════════════════════════════════════════════
router.get('/accounts/:id/balance', authorize('finance', 'view'), controller.accountBalance);
router.get('/accounts/:id/transactions', authorize('finance', 'view'), controller.accountTransactions);

module.exports = router;
