const db = require('../../config/database');
const accountingService = require('../../services/accountingService');

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

  async createJournal(req, res) {
    try {
      const { date, entity, ref_type, ref_no, description, lines, currency, fx_rate } = req.body;

      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ success: false, message: 'At least 2 journal lines are required.' });
      }

      const journal = await db.transaction(async (trx) => {
        return accountingService.createJournal(trx, {
          date,
          entity,
          refType: ref_type,
          refNo: ref_no,
          description,
          lines,
          currency,
          fxRate: fx_rate,
          isAuto: false,
          userId: req.user?.id,
        });
      });

      return res.status(201).json({ success: true, data: { journal } });
    } catch (err) {
      console.error('Create journal error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async postJournal(req, res) {
    try {
      const { id } = req.params;

      const journal = await db.transaction(async (trx) => {
        return accountingService.postJournal(trx, parseInt(id));
      });

      return res.json({ success: true, data: { journal } });
    } catch (err) {
      console.error('Post journal error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async reverseJournal(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const reversal = await db.transaction(async (trx) => {
        return accountingService.reverseJournal(trx, {
          journalId: parseInt(id),
          reason,
          userId: req.user?.id,
        });
      });

      return res.json({ success: true, data: { journal: reversal } });
    } catch (err) {
      console.error('Reverse journal error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Auto-Posting (for testing)
  // ═══════════════════════════════════════════════════════════════════

  async triggerAutoPost(req, res) {
    try {
      const { trigger_event, entity, amount, currency, ref_type, ref_no, description } = req.body;

      if (!trigger_event || !amount) {
        return res.status(400).json({ success: false, message: 'trigger_event and amount are required.' });
      }

      const journal = await db.transaction(async (trx) => {
        return accountingService.autoPost(trx, {
          triggerEvent: trigger_event,
          entity,
          amount: parseFloat(amount),
          currency,
          refType: ref_type,
          refNo: ref_no,
          description,
          userId: req.user?.id,
        });
      });

      if (!journal) {
        return res.json({ success: true, data: null, message: 'No matching posting rule found.' });
      }

      return res.status(201).json({ success: true, data: { journal } });
    } catch (err) {
      console.error('Auto-post error:', err);
      return res.status(400).json({ success: false, message: err.message });
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
        return accountingService.closePeriod(trx, {
          periodId: parseInt(id),
          userId: req.user?.id,
        });
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
        return accountingService.reopenPeriod(trx, {
          periodId: parseInt(id),
          userId: req.user?.id,
        });
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

  async listReconciliations(req, res) {
    try {
      const reconciliations = await db('bank_reconciliation as br')
        .leftJoin('bank_accounts as ba', 'br.bank_account_id', 'ba.id')
        .leftJoin('users as u', 'br.reconciled_by', 'u.id')
        .select('br.*', 'ba.name as bank_account_name', 'u.full_name as reconciled_by_name')
        .orderBy('br.statement_date', 'desc');

      return res.json({ success: true, data: { reconciliations } });
    } catch (err) {
      console.error('List reconciliations error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createReconciliation(req, res) {
    try {
      const { bank_account_id, statement_date, statement_balance } = req.body;

      if (!bank_account_id || !statement_date || statement_balance == null) {
        return res.status(400).json({
          success: false,
          message: 'bank_account_id, statement_date, and statement_balance are required.',
        });
      }

      const reconciliation = await db.transaction(async (trx) => {
        return accountingService.createReconciliation(trx, {
          bankAccountId: bank_account_id,
          statementDate: statement_date,
          statementBalance: statement_balance,
          userId: req.user?.id,
        });
      });

      return res.status(201).json({ success: true, data: { reconciliation } });
    } catch (err) {
      console.error('Create reconciliation error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getReconciliation(req, res) {
    try {
      const { id } = req.params;

      const reconciliation = await db('bank_reconciliation as br')
        .leftJoin('bank_accounts as ba', 'br.bank_account_id', 'ba.id')
        .leftJoin('users as u', 'br.reconciled_by', 'u.id')
        .select('br.*', 'ba.name as bank_account_name', 'u.full_name as reconciled_by_name')
        .where('br.id', id)
        .first();

      if (!reconciliation) {
        return res.status(404).json({ success: false, message: 'Reconciliation not found.' });
      }

      const items = await db('bank_reconciliation_items')
        .where({ reconciliation_id: id })
        .orderBy('date');

      return res.json({ success: true, data: { reconciliation, items } });
    } catch (err) {
      console.error('Get reconciliation error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addReconciliationItems(req, res) {
    try {
      const { id } = req.params;
      const { items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'items array is required.' });
      }

      const inserted = await db.transaction(async (trx) => {
        return accountingService.addReconciliationItems(trx, {
          reconciliationId: parseInt(id),
          items,
        });
      });

      return res.status(201).json({ success: true, data: { items: inserted } });
    } catch (err) {
      console.error('Add reconciliation items error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
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

  async completeReconciliation(req, res) {
    try {
      const { id } = req.params;

      const reconciliation = await db.transaction(async (trx) => {
        return accountingService.completeReconciliation(trx, {
          reconciliationId: parseInt(id),
          userId: req.user?.id,
        });
      });

      return res.json({ success: true, data: { reconciliation } });
    } catch (err) {
      console.error('Complete reconciliation error:', err);
      return res.status(400).json({ success: false, message: err.message });
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
