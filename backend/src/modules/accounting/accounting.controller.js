const db = require('../../config/database');
const accountingService = require('../../services/accountingService');
const bankReconciliation = require('./bankReconciliation.service');
const auditService = require('../admin/audit.service');
const { assertNoControlAccounts } = require('./controlAccounts');
const { sendCsv, wantsCsv } = require('../../utils/csv');
const statementCsv = require('./statementCsv');

// A refusal the user can act on (typed 400/403/404/409) keeps its status and
// message; anything else is a server fault and says nothing about internals.
function journalError(res, err, label) {
  const code = err.statusCode || 500;
  if (code === 500) console.error(label, err);
  return res.status(code).json({
    success: false,
    message: code === 500 ? 'Internal server error.' : err.message,
    ...(err.reason ? { reason: err.reason } : {}),
  });
}

// A reconciliation refusal carries its status (404 / 409 / 400); anything else is a 500.
function reconError(res, err, label) {
  const code = err.statusCode || 500;
  if (code === 500) console.error(label, err);
  const body = { success: false, message: code === 500 ? 'Internal server error.' : err.message };
  if (err.existing) body.data = { reconciliation: err.existing };
  return res.status(code).json(body);
}

const accountingController = {
  // ═══════════════════════════════════════════════════════════════════
  // Chart of Accounts
  // ═══════════════════════════════════════════════════════════════════

  async listAccounts(req, res) {
    try {
      const accounts = await accountingService.getChartOfAccounts();
      return res.json({ success: true, data: { accounts } });
    } catch (err) {
      console.error('List accounts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createAccount(req, res) {
    try {
      const { code, name, type, sub_type, parent_id, entity, currency, normal_balance, description } = req.body;

      if (!code || !name || !type) {
        return res.status(400).json({ success: false, message: 'code, name, and type are required.' });
      }

      const [account] = await db('chart_of_accounts')
        .insert({
          code,
          name,
          type,
          sub_type: sub_type || null,
          parent_id: parent_id || null,
          entity: entity || null,
          currency: currency || 'PKR',
          normal_balance: normal_balance || 'debit',
          description: description || null,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { account } });
    } catch (err) {
      console.error('Create account error:', err);
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Account code already exists.' });
      }
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateAccount(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Prevent updating system accounts' critical fields
      const existing = await db('chart_of_accounts').where({ id }).first();
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Account not found.' });
      }
      if (existing.is_system && (updates.code || updates.type)) {
        return res.status(400).json({ success: false, message: 'Cannot change code or type of system accounts.' });
      }

      delete updates.id;
      delete updates.is_system;
      delete updates.created_at;
      updates.updated_at = db.fn.now();

      const [account] = await db('chart_of_accounts')
        .where({ id })
        .update(updates)
        .returning('*');

      return res.json({ success: true, data: { account } });
    } catch (err) {
      console.error('Update account error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Journal Entries
  // ═══════════════════════════════════════════════════════════════════

  async listJournals(req, res) {
    try {
      const { page = 1, limit = 20, entity, period_id, ref_type, status, date_from, date_to } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('journal_entries as je')
        .leftJoin('accounting_periods as ap', 'je.period_id', 'ap.id')
        .leftJoin('users as u', 'je.created_by', 'u.id')
        .select(
          'je.*',
          'ap.name as period_name',
          'u.full_name as created_by_name'
        );

      if (entity) query = query.where('je.entity', entity);
      if (period_id) query = query.where('je.period_id', period_id);
      if (ref_type) query = query.where('je.ref_type', ref_type);
      if (status) query = query.where('je.status', status);
      if (date_from) query = query.where('je.date', '>=', date_from);
      if (date_to) query = query.where('je.date', '<=', date_to);

      const countQuery = query.clone().clearSelect().clearOrder().count('je.id as total').first();

      const [journals, countResult] = await Promise.all([
        query.orderBy('je.date', 'desc').orderBy('je.id', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      // Fetch lines for each journal
      const journalIds = journals.map((j) => j.id);
      const allLines = journalIds.length > 0
        ? await db('journal_lines as jl')
            .leftJoin('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
            .whereIn('jl.journal_id', journalIds)
            .select('jl.*', 'coa.code as account_code', 'coa.name as account_name')
        : [];

      const linesByJournal = {};
      for (const line of allLines) {
        if (!linesByJournal[line.journal_id]) linesByJournal[line.journal_id] = [];
        linesByJournal[line.journal_id].push(line);
      }

      const journalsWithLines = journals.map((j) => ({
        ...j,
        lines: linesByJournal[j.id] || [],
      }));

      return res.json({
        success: true,
        data: {
          journals: journalsWithLines,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('List journals error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Manual journals (owner decision D-2): the Finance Manager posts them
  // (finance.post_journal), validated by schemas.createJournal, and they may
  // NOT touch a control account — bank / cash, AR, customer advances, AP,
  // salaries payable, stock — which change only through their own documents.
  // The audit row is written inside the same transaction (P2-30).
  async createJournal(req, res) {
    try {
      const { date, entity, ref_type, ref_no, description, lines } = req.body;

      const journal = await db.transaction(async (trx) => {
        await assertNoControlAccounts(trx, lines);
        const j = await accountingService.createJournal(trx, {
          date: date instanceof Date ? date.toISOString().slice(0, 10) : date,
          entity,
          refType: ref_type || 'Manual Journal',
          refNo: ref_no || null,
          description,
          lines: lines.map((l) => ({
            account_id: l.account_id,
            debit: l.debit || 0,
            credit: l.credit || 0,
            narration: l.narration || l.description || null,
          })),
          // The GL is PKR-base: a manual journal is entered in PKR.
          currency: 'PKR',
          fxRate: 1,
          isAuto: false,
          userId: req.user?.id,
        });
        await auditService.logInTrx(trx, req, {
          action: 'create_journal', entityType: 'journal_entries', entityId: j.id,
          result: { journal_no: j.journal_no, status: j.status },
        });
        return j;
      });

      return res.status(201).json({ success: true, data: { journal } });
    } catch (err) {
      return journalError(res, err, 'Create journal error:');
    }
  },

  async postJournal(req, res) {
    try {
      const id = parseInt(req.params.id, 10);

      const journal = await db.transaction(async (trx) => {
        const draft = await trx('journal_entries').where({ id }).forUpdate().first();
        // A manual draft is re-checked at posting: it may predate the rule.
        if (draft && !draft.is_auto) {
          const lines = await trx('journal_lines').where({ journal_id: id }).select('account_id');
          await assertNoControlAccounts(trx, lines);
        }
        const posted = await accountingService.postJournal(trx, id);
        await auditService.logInTrx(trx, req, {
          action: 'post_journal', entityType: 'journal_entries', entityId: id,
          result: { journal_no: posted.journal_no, status: posted.status },
        });
        return posted;
      });

      return res.json({ success: true, data: { journal } });
    } catch (err) {
      return journalError(res, err, 'Post journal error:');
    }
  },

  // Reversal (owner decision D-2): a reason and Owner approval (the route's
  // ownerApproval middleware), posted as a dated signed-delta journal — the
  // original is never edited, so a closed period's books never change and the
  // delta itself must fall in an open period. Idempotent: reversing twice
  // returns the first reversal. A journal on a control account was posted by
  // its document and is reversed through that document, not here.
  async reverseJournal(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason, date } = req.body;

      const result = await db.transaction(async (trx) => {
        const lines = await trx('journal_lines').where({ journal_id: id }).select('account_id');
        await assertNoControlAccounts(trx, lines, 'A journal reversal');
        const r = await accountingService.postReversalDelta(trx, {
          journalId: id,
          date: date instanceof Date ? date.toISOString().slice(0, 10) : date,
          reason,
          userId: req.user?.id,
        });
        // Already reversed: nothing changed, so nothing to audit (and the
        // route middleware must not log the no-op as a reversal either).
        if (r.alreadyReversed) req.auditedInTrx = true;
        else {
          await auditService.logInTrx(trx, req, {
            action: 'reverse_journal', entityType: 'journal_entries', entityId: id,
            details: {
              reason,
              reversal_journal_id: r.journal.id,
              reversal_journal_no: r.journal.journal_no,
              authorized_by_owner_id: req.ownerAuth?.ownerId || null,
            },
          });
        }
        return r;
      });

      return res.status(result.alreadyReversed ? 200 : 201).json({
        success: true,
        data: { journal: result.journal, already_reversed: result.alreadyReversed },
      });
    } catch (err) {
      return journalError(res, err, 'Reverse journal error:');
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Posting Rules
  // ═══════════════════════════════════════════════════════════════════

  async listPostingRules(req, res) {
    try {
      const rules = await db('posting_rules as pr')
        .leftJoin('chart_of_accounts as dr', 'pr.debit_account_id', 'dr.id')
        .leftJoin('chart_of_accounts as cr', 'pr.credit_account_id', 'cr.id')
        .select(
          'pr.*',
          'dr.code as debit_account_code',
          'dr.name as debit_account_name',
          'cr.code as credit_account_code',
          'cr.name as credit_account_name'
        )
        .orderBy('pr.rule_name');

      return res.json({ success: true, data: { rules } });
    } catch (err) {
      console.error('List posting rules error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createPostingRule(req, res) {
    try {
      const { rule_name, trigger_event, entity, debit_account_id, credit_account_id, description } = req.body;

      if (!rule_name || !trigger_event) {
        return res.status(400).json({ success: false, message: 'rule_name and trigger_event are required.' });
      }

      const [rule] = await db('posting_rules')
        .insert({
          rule_name,
          trigger_event,
          entity: entity || null,
          debit_account_id,
          credit_account_id,
          description: description || null,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { rule } });
    } catch (err) {
      console.error('Create posting rule error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updatePostingRule(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      delete updates.id;
      delete updates.created_at;
      updates.updated_at = db.fn.now();

      const [rule] = await db('posting_rules')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!rule) {
        return res.status(404).json({ success: false, message: 'Posting rule not found.' });
      }

      return res.json({ success: true, data: { rule } });
    } catch (err) {
      console.error('Update posting rule error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Periods
  // ═══════════════════════════════════════════════════════════════════

  async listPeriods(req, res) {
    try {
      const periods = await db('accounting_periods')
        .leftJoin('users as u', 'accounting_periods.closed_by', 'u.id')
        .select('accounting_periods.*', 'u.full_name as closed_by_name')
        .orderBy('accounting_periods.period_start');

      return res.json({ success: true, data: { periods } });
    } catch (err) {
      console.error('List periods error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async closePeriod(req, res) {
    try {
      const { id } = req.params;

      const period = await db.transaction(async (trx) => {
        const p = await accountingService.closePeriod(trx, {
          periodId: parseInt(id),
          userId: req.user?.id,
        });
        await auditService.logInTrx(trx, req, {
          action: 'close_period', entityType: 'accounting_periods', entityId: p.id,
          result: { name: p.name, status: p.status },
        });
        return p;
      });

      return res.json({ success: true, data: { period } });
    } catch (err) {
      console.error('Close period error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async reopenPeriod(req, res) {
    try {
      const { id } = req.params;

      const period = await db.transaction(async (trx) => {
        const p = await accountingService.reopenPeriod(trx, {
          periodId: parseInt(id),
          userId: req.user?.id,
        });
        await auditService.logInTrx(trx, req, {
          action: 'reopen_period', entityType: 'accounting_periods', entityId: p.id,
          details: { reason: req.body?.reason, result: { name: p.name, status: p.status }, authorized_by_owner_id: req.ownerAuth?.ownerId || null },
        });
        return p;
      });

      return res.json({ success: true, data: { period } });
    } catch (err) {
      console.error('Reopen period error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Bank Reconciliation
  // ═══════════════════════════════════════════════════════════════════

  // B5: the Reconcile screen (Finance › Accounts › Reconcile) — one bank /
  // cash account at a time; see bankReconciliation.service.js.
  async listReconciliations(req, res) {
    try {
      let q = db('bank_reconciliation as br')
        .leftJoin('bank_accounts as ba', 'br.bank_account_id', 'ba.id')
        .leftJoin('users as u', 'br.reconciled_by', 'u.id')
        .select('br.*', 'ba.name as bank_account_name', 'ba.currency as bank_account_currency', 'u.full_name as reconciled_by_name')
        .orderBy('br.statement_date', 'desc')
        .orderBy('br.id', 'desc');
      const accountId = parseInt(req.query.bank_account_id, 10);
      if (accountId) q = q.where('br.bank_account_id', accountId);
      const reconciliations = await q;
      return res.json({ success: true, data: { reconciliations } });
    } catch (err) {
      console.error('List reconciliations error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createReconciliation(req, res) {
    try {
      const { bank_account_id, statement_date, statement_balance, notes } = req.body;
      if (!bank_account_id || !statement_date || statement_balance == null || statement_balance === '') {
        return res.status(400).json({
          success: false,
          message: 'bank_account_id, statement_date, and statement_balance are required.',
        });
      }
      const reconciliation = await bankReconciliation.create({
        bankAccountId: bank_account_id,
        statementDate: statement_date,
        statementBalance: statement_balance,
        notes,
        userId: req.user?.id,
      });
      return res.status(201).json({ success: true, data: { reconciliation } });
    } catch (err) {
      return reconError(res, err, 'Create reconciliation error:');
    }
  },

  async getReconciliation(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(404).json({ success: false, message: 'Reconciliation not found.' });
      const workspace = await bankReconciliation.getWorkspace(id);
      const items = await db('bank_reconciliation_items').where({ reconciliation_id: id }).orderBy('date');
      return res.json({ success: true, data: { ...workspace, items } });
    } catch (err) {
      return reconError(res, err, 'Get reconciliation error:');
    }
  },

  // Save progress: the ticked bank_transactions rows (replaces the set).
  async saveReconciliationTicks(req, res) {
    try {
      const { bank_transaction_ids, statement_balance } = req.body;
      const workspace = await bankReconciliation.saveTicks(parseInt(req.params.id, 10), {
        bankTransactionIds: bank_transaction_ids,
        statementBalance: statement_balance,
      });
      return res.json({ success: true, data: workspace });
    } catch (err) {
      return reconError(res, err, 'Save reconciliation error:');
    }
  },

  // Statement lines (CSV import) — used to suggest ticks by amount + date.
  async addReconciliationItems(req, res) {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'items array is required.' });
      }
      const workspace = await bankReconciliation.addStatementLines(parseInt(req.params.id, 10), items);
      return res.status(201).json({ success: true, data: workspace });
    } catch (err) {
      return reconError(res, err, 'Add reconciliation items error:');
    }
  },

  async matchReconciliationItems(req, res) {
    try {
      const { book_item_id, bank_item_id } = req.body;

      if (!book_item_id || !bank_item_id) {
        return res.status(400).json({ success: false, message: 'book_item_id and bank_item_id are required.' });
      }

      const result = await db.transaction(async (trx) => {
        return accountingService.matchItems(trx, {
          bookItemId: book_item_id,
          bankItemId: bank_item_id,
        });
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Match reconciliation items error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Complete — only when the cleared balance equals the statement (409 otherwise).
  async completeReconciliation(req, res) {
    try {
      const workspace = await bankReconciliation.complete(parseInt(req.params.id, 10), req.user?.id);
      return res.json({ success: true, data: workspace });
    } catch (err) {
      return reconError(res, err, 'Complete reconciliation error:');
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // FX Rates
  // ═══════════════════════════════════════════════════════════════════

  async listFxRates(req, res) {
    try {
      const { from_currency, to_currency } = req.query;

      let query = db('fx_rates')
        .leftJoin('users as u', 'fx_rates.created_by', 'u.id')
        .select('fx_rates.*', 'u.full_name as created_by_name');

      if (from_currency) query = query.where('fx_rates.from_currency', from_currency);
      if (to_currency) query = query.where('fx_rates.to_currency', to_currency);

      const rates = await query.orderBy('fx_rates.effective_date', 'desc').limit(100);

      return res.json({ success: true, data: { rates } });
    } catch (err) {
      console.error('List FX rates error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async setFxRate(req, res) {
    try {
      const { from_currency, to_currency, rate, effective_date } = req.body;

      if (!from_currency || !to_currency || !rate || !effective_date) {
        return res.status(400).json({
          success: false,
          message: 'from_currency, to_currency, rate, and effective_date are required.',
        });
      }

      const fxRate = await db.transaction(async (trx) => {
        return accountingService.setFxRate(trx, {
          fromCurrency: from_currency,
          toCurrency: to_currency,
          rate,
          effectiveDate: effective_date,
          userId: req.user?.id,
        });
      });

      return res.status(201).json({ success: true, data: { fx_rate: fxRate } });
    } catch (err) {
      console.error('Set FX rate error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Financial Statements
  // ═══════════════════════════════════════════════════════════════════

  async trialBalance(req, res) {
    try {
      const { period_id, entity, as_of_date } = req.query;

      const result = await accountingService.getTrialBalance({
        periodId: period_id ? parseInt(period_id) : null,
        entity: entity || null,
        asOfDate: as_of_date || null,
      });

      // ?format=csv — the full statement as a spreadsheet (P4-14).
      if (wantsCsv(req)) {
        return sendCsv(res, { filename: `trial-balance${as_of_date ? `_${as_of_date}` : ''}`, columns: statementCsv.ACCOUNT_COLUMNS, rows: statementCsv.trialBalanceRows(result) });
      }
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Trial balance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async profitAndLoss(req, res) {
    try {
      const { period_start, period_end, entity } = req.query;

      const result = await accountingService.getProfitAndLoss({
        periodStart: period_start || null,
        periodEnd: period_end || null,
        entity: entity || null,
      });

      if (wantsCsv(req)) {
        return sendCsv(res, { filename: `profit-and-loss${period_start ? `_${period_start}` : ''}${period_end ? `_${period_end}` : ''}`, columns: statementCsv.ACCOUNT_COLUMNS, rows: statementCsv.profitLossRows(result) });
      }
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Profit & Loss error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async balanceSheet(req, res) {
    try {
      const { as_of_date, entity } = req.query;

      const result = await accountingService.getBalanceSheet({
        asOfDate: as_of_date || null,
        entity: entity || null,
      });

      if (wantsCsv(req)) {
        return sendCsv(res, { filename: `balance-sheet${as_of_date ? `_${as_of_date}` : ''}`, columns: statementCsv.ACCOUNT_COLUMNS, rows: statementCsv.balanceSheetRows(result) });
      }
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Balance sheet error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async cashFlow(req, res) {
    try {
      const { period_start, period_end, entity } = req.query;

      const result = await accountingService.getCashFlow({
        periodStart: period_start || null,
        periodEnd: period_end || null,
        entity: entity || null,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Cash flow error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async customerStatement(req, res) {
    try {
      const { id } = req.params;
      const { date_from, date_to } = req.query;

      const result = await accountingService.getCustomerStatement(parseInt(id), {
        dateFrom: date_from || null,
        dateTo: date_to || null,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Customer statement error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async supplierStatement(req, res) {
    try {
      const { id } = req.params;
      const { date_from, date_to } = req.query;

      const result = await accountingService.getSupplierStatement(parseInt(id), {
        dateFrom: date_from || null,
        dateTo: date_to || null,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Supplier statement error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Invoice↔payment allocation ledger for a party (customer | supplier).
  async partyAllocation(req, res) {
    try {
      const { type, id } = req.params;
      if (type !== 'customer' && type !== 'supplier') {
        return res.status(400).json({ success: false, message: 'type must be customer or supplier.' });
      }
      const result = await accountingService.getPartyAllocation(type, parseInt(id));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Party allocation error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Account Queries
  // ═══════════════════════════════════════════════════════════════════

  async accountBalance(req, res) {
    try {
      const { id } = req.params;
      const { as_of_date } = req.query;

      const result = await accountingService.getAccountBalance(parseInt(id), as_of_date || null);

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Account balance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async accountTransactions(req, res) {
    try {
      const { id } = req.params;
      const { date_from, date_to } = req.query;

      const transactions = await accountingService.getAccountTransactions(parseInt(id), {
        dateFrom: date_from || null,
        dateTo: date_to || null,
      });

      return res.json({ success: true, data: { transactions } });
    } catch (err) {
      console.error('Account transactions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = accountingController;
