const db = require('../config/database');

/**
 * Accounting Engine — Core double-entry bookkeeping service
 * All monetary operations produce balanced journal entries.
 */
const accountingService = {
  // ═══════════════════════════════════════════════════════════════════
  // Journal Posting
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new journal entry with lines.
   * @param {Object} trx - Knex transaction
   * @param {Object} params
   * @param {string}   params.date
   * @param {string}   params.entity         - 'mill' | 'export' | null
   * @param {string}   params.refType        - e.g. 'Export Order'
   * @param {string}   params.refNo          - e.g. 'EX-001'
   * @param {string}   params.description
   * @param {Array}    params.lines          - [{account_id, debit, credit, narration}]
   * @param {string}   [params.currency]
   * @param {number}   [params.fxRate]
   * @param {boolean}  [params.isAuto]
   * @param {number}   [params.postingRuleId]
   * @param {number}   [params.userId]
   * @returns {Object} journal with lines
   */
  async createJournal(trx, {
    date, entity, refType, refNo, description, lines,
    currency = 'PKR', fxRate, isAuto = false, postingRuleId, userId,
  }) {
    // Wrap in a transaction if one was not provided, to ensure
    // journal_entries + journal_lines are inserted atomically.
    const execute = async (knex) => {
      // ── Validate lines balance ──
      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of lines) {
        totalDebit += parseFloat(line.debit) || 0;
        totalCredit += parseFloat(line.credit) || 0;
      }
      totalDebit = parseFloat(totalDebit.toFixed(2));
      totalCredit = parseFloat(totalCredit.toFixed(2));

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(
          `Journal is unbalanced: debit=${totalDebit}, credit=${totalCredit}. Difference=${(totalDebit - totalCredit).toFixed(2)}`
        );
      }

      // ── Validate all account_ids exist ──
      const accountIds = lines.map((l) => l.account_id);
      const existing = await knex('chart_of_accounts').whereIn('id', accountIds).select('id');
      const existingIds = new Set(existing.map((r) => r.id));
      for (const id of accountIds) {
        if (!existingIds.has(id)) {
          throw new Error(`Account ID ${id} does not exist in chart of accounts.`);
        }
      }

      // ── Resolve accounting period ──
      const journalDate = date || new Date().toISOString().slice(0, 10);
      const period = await knex('accounting_periods')
        .where('period_start', '<=', journalDate)
        .andWhere('period_end', '>=', journalDate)
        .first();

      if (period && period.status !== 'Open') {
        throw new Error(`Accounting period '${period.name}' is ${period.status}. Cannot post journals.`);
      }

      // ── Generate journal number: JE-YYYYMM-XXXX ──
      const ym = journalDate.slice(0, 7).replace('-', '');
      const lastJE = await knex('journal_entries')
        .where('journal_no', 'like', `JE-${ym}-%`)
        .orderBy('id', 'desc')
        .first();

      let seq = 1;
      if (lastJE && lastJE.journal_no) {
        const parts = lastJE.journal_no.split('-');
        const lastSeq = parseInt(parts[2], 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      const journalNo = `JE-${ym}-${String(seq).padStart(4, '0')}`;

      // ── Insert journal entry ──
      const [journal] = await knex('journal_entries')
        .insert({
          journal_no: journalNo,
          date: journalDate,
          entity: entity || null,
          ref_type: refType || null,
          ref_no: refNo || null,
          description: description || null,
          status: 'Draft',
          currency: currency || 'PKR',
          fx_rate: fxRate || null,
          is_auto: isAuto,
          posting_rule_id: postingRuleId || null,
          period_id: period ? period.id : null,
          total_debit: totalDebit,
          total_credit: totalCredit,
          created_by: userId || null,
        })
        .returning('*');

      // ── Insert journal lines ──
      const lineRows = lines.map((line) => ({
        journal_id: journal.id,
        account_id: line.account_id,
        account: line.account || '',
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
        narration: line.narration || null,
      }));

      const insertedLines = await knex('journal_lines')
        .insert(lineRows)
        .returning('*');

      return { ...journal, lines: insertedLines };
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  /**
   * Post a draft journal entry (change status to Posted).
   */
  async postJournal(trx, journalId) {
    const knex = trx || db;

    const journal = await knex('journal_entries').where({ id: journalId }).first();
    if (!journal) throw new Error(`Journal entry ${journalId} not found.`);
    if (journal.status === 'Posted') throw new Error('Journal is already posted.');
    if (journal.status === 'Reversed') throw new Error('Cannot post a reversed journal.');

    // Verify balanced
    const totals = await knex('journal_lines')
      .where({ journal_id: journalId })
      .select(
        knex.raw('COALESCE(SUM(debit), 0) as total_debit'),
        knex.raw('COALESCE(SUM(credit), 0) as total_credit')
      )
      .first();

    const td = parseFloat(totals.total_debit);
    const tc = parseFloat(totals.total_credit);
    if (Math.abs(td - tc) > 0.01) {
      throw new Error(`Cannot post unbalanced journal: debit=${td}, credit=${tc}`);
    }

    const [updated] = await knex('journal_entries')
      .where({ id: journalId })
      .update({
        status: 'Posted',
        total_debit: td,
        total_credit: tc,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated;
  },

  /**
   * Reverse a posted journal by creating a mirror entry.
   */
  async reverseJournal(trx, { journalId, reason, userId }) {
    // Wrap in a transaction if one was not provided, to ensure the
    // reversal journal creation + original status update are atomic.
    const execute = async (knex) => {
      const original = await knex('journal_entries').where({ id: journalId }).first();
      if (!original) throw new Error(`Journal entry ${journalId} not found.`);
      if (original.status !== 'Posted') throw new Error('Only posted journals can be reversed.');

      const originalLines = await knex('journal_lines').where({ journal_id: journalId });

      // Create reversed lines (swap debit/credit)
      const reversedLines = originalLines.map((line) => ({
        account_id: line.account_id,
        account: line.account,
        debit: parseFloat(line.credit) || 0,
        credit: parseFloat(line.debit) || 0,
        narration: `Reversal: ${line.narration || ''}`,
      }));

      const reversalJournal = await accountingService.createJournal(knex, {
        date: new Date().toISOString().slice(0, 10),
        entity: original.entity,
        refType: original.ref_type,
        refNo: original.ref_no,
        description: `Reversal of ${original.journal_no}: ${reason || ''}`,
        lines: reversedLines,
        currency: original.currency,
        fxRate: original.fx_rate,
        isAuto: false,
        userId,
      });

      // Link reversal
      await knex('journal_entries')
        .where({ id: reversalJournal.id })
        .update({ reversal_of: journalId });

      // Mark original as Reversed
      await knex('journal_entries')
        .where({ id: journalId })
        .update({ status: 'Reversed', updated_at: knex.fn.now() });

      // Auto-post the reversal
      const postedReversal = await accountingService.postJournal(knex, reversalJournal.id);

      return postedReversal;
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  // ═══════════════════════════════════════════════════════════════════
  // Auto-Posting (triggered by business events)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Auto-post a journal based on a posting rule triggered by a business event.
   */
  async autoPost(trx, {
    triggerEvent, entity, amount, currency = 'PKR',
    refType, refNo, description, userId,
  }) {
    // Wrap in a transaction if one was not provided, to ensure
    // posting rule lookup + journal creation + posting are atomic.
    const execute = async (knex) => {
      // Look up posting rule
      let query = knex('posting_rules')
        .where({ trigger_event: triggerEvent, is_active: true });

      if (entity) {
        query = query.where(function () {
          this.where({ entity }).orWhereNull('entity');
        });
      }

      const rule = await query.first();
      if (!rule) return null;

      const parsedAmount = parseFloat(amount);
      if (!parsedAmount || parsedAmount <= 0) return null;

      // Fetch account names for narration
      const [debitAcc, creditAcc] = await Promise.all([
        knex('chart_of_accounts').where({ id: rule.debit_account_id }).first(),
        knex('chart_of_accounts').where({ id: rule.credit_account_id }).first(),
      ]);

      const lines = [
        {
          account_id: rule.debit_account_id,
          account: debitAcc ? debitAcc.name : '',
          debit: parsedAmount,
          credit: 0,
          narration: `DR ${debitAcc ? debitAcc.code + ' ' + debitAcc.name : ''} — ${description || rule.description}`,
        },
        {
          account_id: rule.credit_account_id,
          account: creditAcc ? creditAcc.name : '',
          debit: 0,
          credit: parsedAmount,
          narration: `CR ${creditAcc ? creditAcc.code + ' ' + creditAcc.name : ''} — ${description || rule.description}`,
        },
      ];

      // Get FX rate if not PKR
      let fxRate = null;
      if (currency && currency !== 'PKR') {
        const rate = await accountingService.getFxRate(currency, 'PKR', new Date().toISOString().slice(0, 10));
        if (rate) fxRate = rate;
        else console.warn(`No FX rate found for ${currency}/PKR on ${new Date().toISOString().slice(0, 10)}. Posting journal without conversion rate.`);
      }

      const journal = await accountingService.createJournal(knex, {
        date: new Date().toISOString().slice(0, 10),
        entity: entity || rule.entity,
        refType,
        refNo,
        description: description || rule.description,
        lines,
        currency,
        fxRate,
        isAuto: true,
        postingRuleId: rule.id,
        userId,
      });

      // Auto-post immediately
      const posted = await accountingService.postJournal(knex, journal.id);
      return { ...posted, lines: journal.lines };
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  // ═══════════════════════════════════════════════════════════════════
  // Period Management
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Close an accounting period. All journals within must be Posted.
   */
  async closePeriod(trx, { periodId, userId }) {
    const knex = trx || db;

    const period = await knex('accounting_periods').where({ id: periodId }).first();
    if (!period) throw new Error(`Period ${periodId} not found.`);
    if (period.status !== 'Open') throw new Error(`Period is already ${period.status}.`);

    // Check for unposted journals
    const draftCount = await knex('journal_entries')
      .where({ period_id: periodId })
      .whereNot({ status: 'Posted' })
      .whereNot({ status: 'Reversed' })
      .count('id as count')
      .first();

    if (parseInt(draftCount.count) > 0) {
      throw new Error(`Cannot close period: ${draftCount.count} journal(s) are not yet posted.`);
    }

    const [updated] = await knex('accounting_periods')
      .where({ id: periodId })
      .update({
        status: 'Closed',
        closed_by: userId || null,
        closed_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated;
  },

  /**
   * Reopen a closed period.
   */
  async reopenPeriod(trx, { periodId, userId }) {
    const knex = trx || db;

    const period = await knex('accounting_periods').where({ id: periodId }).first();
    if (!period) throw new Error(`Period ${periodId} not found.`);
    if (period.status === 'Open') throw new Error('Period is already open.');
    if (period.status === 'Locked') throw new Error('Locked periods cannot be reopened.');

    const [updated] = await knex('accounting_periods')
      .where({ id: periodId })
      .update({
        status: 'Open',
        closed_by: null,
        closed_at: null,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // ═══════════════════════════════════════════════════════════════════
  // Bank Reconciliation
  // ═══════════════════════════════════════════════════════════════════

  async createReconciliation(trx, { bankAccountId, statementDate, statementBalance, userId }) {
    const knex = trx || db;

    const [recon] = await knex('bank_reconciliation')
      .insert({
        bank_account_id: bankAccountId,
        statement_date: statementDate,
        statement_balance: parseFloat(statementBalance),
        status: 'Draft',
        reconciled_by: userId || null,
      })
      .returning('*');

    return recon;
  },

  async addReconciliationItems(trx, { reconciliationId, items }) {
    // Wrap in a transaction if one was not provided, to ensure
    // item inserts + reconciliation status update are atomic.
    const execute = async (knex) => {
      const rows = items.map((item) => ({
        reconciliation_id: reconciliationId,
        transaction_type: item.transaction_type,
        reference: item.reference || null,
        date: item.date || null,
        amount: parseFloat(item.amount),
        matched: false,
        notes: item.notes || null,
      }));

      const inserted = await knex('bank_reconciliation_items')
        .insert(rows)
        .returning('*');

      // Update status to In Progress
      await knex('bank_reconciliation')
        .where({ id: reconciliationId })
        .update({ status: 'In Progress', updated_at: knex.fn.now() });

      return inserted;
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  async matchItems(trx, { bookItemId, bankItemId }) {
    // Wrap in a transaction if one was not provided, to ensure
    // both reconciliation item updates are atomic.
    const execute = async (knex) => {
      await knex('bank_reconciliation_items')
        .where({ id: bookItemId })
        .update({ matched: true, matched_with_id: bankItemId });

      await knex('bank_reconciliation_items')
        .where({ id: bankItemId })
        .update({ matched: true, matched_with_id: bookItemId });

      return { bookItemId, bankItemId, matched: true };
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  async completeReconciliation(trx, { reconciliationId, userId }) {
    const knex = trx || db;

    const recon = await knex('bank_reconciliation').where({ id: reconciliationId }).first();
    if (!recon) throw new Error(`Reconciliation ${reconciliationId} not found.`);

    // Calculate book balance from matched book items
    const bookTotals = await knex('bank_reconciliation_items')
      .where({ reconciliation_id: reconciliationId, transaction_type: 'book', matched: true })
      .select(knex.raw('COALESCE(SUM(amount), 0) as total'))
      .first();

    const bookBalance = parseFloat(bookTotals.total);
    const statementBalance = parseFloat(recon.statement_balance);
    const difference = parseFloat((statementBalance - bookBalance).toFixed(2));

    const [updated] = await knex('bank_reconciliation')
      .where({ id: reconciliationId })
      .update({
        book_balance: bookBalance,
        difference,
        status: 'Completed',
        reconciled_by: userId || null,
        reconciled_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // ═══════════════════════════════════════════════════════════════════
  // FX Rates
  // ═══════════════════════════════════════════════════════════════════

  async setFxRate(trx, { fromCurrency, toCurrency, rate, effectiveDate, userId }) {
    const knex = trx || db;

    const [fxRate] = await knex('fx_rates')
      .insert({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate: parseFloat(rate),
        effective_date: effectiveDate,
        source: 'manual',
        created_by: userId || null,
      })
      .returning('*');

    return fxRate;
  },

  /**
   * Get the FX rate effective on or before the given date.
   */
  async getFxRate(fromCurrency, toCurrency, date) {
    const row = await db('fx_rates')
      .where({ from_currency: fromCurrency, to_currency: toCurrency })
      .where('effective_date', '<=', date)
      .orderBy('effective_date', 'desc')
      .first();

    return row ? parseFloat(row.rate) : null;
  },

  /**
   * Calculate realized FX gain/loss and auto-post a journal.
   */
  async calculateFxGainLoss(trx, { originalAmount, originalRate, currentRate, currency, refNo, userId }) {
    // Wrap in a transaction if one was not provided, to ensure
    // the FX journal creation + posting are atomic.
    const execute = async (knex) => {
      const parsedAmount = parseFloat(originalAmount);
      const parsedOriginal = parseFloat(originalRate);
      const parsedCurrent = parseFloat(currentRate);
      const gainLoss = parseFloat((parsedAmount * (parsedCurrent - parsedOriginal)).toFixed(2));

      if (Math.abs(gainLoss) < 0.01) return null;

      // FX Gain/Loss account
      const fxAccount = await knex('chart_of_accounts').where({ code: '6210' }).first();
      const bankAccount = await knex('chart_of_accounts').where({ code: '1020' }).first();

      if (!fxAccount || !bankAccount) {
        throw new Error('FX Gain/Loss or Bank account not found in chart of accounts.');
      }

      let lines;
      if (gainLoss > 0) {
        // FX Gain: DR Bank, CR FX Gain/Loss
        lines = [
          { account_id: bankAccount.id, account: bankAccount.name, debit: Math.abs(gainLoss), credit: 0, narration: 'FX Gain' },
          { account_id: fxAccount.id, account: fxAccount.name, debit: 0, credit: Math.abs(gainLoss), narration: 'FX Gain' },
        ];
      } else {
        // FX Loss: DR FX Gain/Loss, CR Bank
        lines = [
          { account_id: fxAccount.id, account: fxAccount.name, debit: Math.abs(gainLoss), credit: 0, narration: 'FX Loss' },
          { account_id: bankAccount.id, account: bankAccount.name, debit: 0, credit: Math.abs(gainLoss), narration: 'FX Loss' },
        ];
      }

      const journal = await accountingService.createJournal(knex, {
        date: new Date().toISOString().slice(0, 10),
        entity: null,
        refType: 'FX Adjustment',
        refNo: refNo || null,
        description: `Realized FX ${gainLoss > 0 ? 'Gain' : 'Loss'} of ${Math.abs(gainLoss)} on ${currency} transaction`,
        lines,
        currency: 'PKR',
        isAuto: true,
        userId,
      });

      await accountingService.postJournal(knex, journal.id);

      return { gainLoss, journal };
    };

    if (trx) {
      return execute(trx);
    }
    return db.transaction(async (autoTrx) => execute(autoTrx));
  },

  // ═══════════════════════════════════════════════════════════════════
  // Financial Statements
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Trial Balance — sum of all journal lines grouped by account.
   */
  async getTrialBalance({ periodId, entity, asOfDate }) {
    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted');

    if (periodId) {
      query = query.where('je.period_id', periodId);
    }
    if (entity) {
      query = query.where(function () {
        this.where('je.entity', entity).orWhereNull('je.entity');
      });
    }
    if (asOfDate) {
      query = query.where('je.date', '<=', asOfDate);
    }

    const rows = await query
      .groupBy('coa.id', 'coa.code', 'coa.name', 'coa.type', 'coa.sub_type', 'coa.normal_balance')
      .select(
        'coa.id as account_id',
        'coa.code',
        'coa.name',
        'coa.type',
        'coa.sub_type',
        'coa.normal_balance',
        db.raw('COALESCE(SUM(jl.debit), 0)::numeric as debit_total'),
        db.raw('COALESCE(SUM(jl.credit), 0)::numeric as credit_total')
      )
      .orderBy('coa.code');

    let grandDebit = 0;
    let grandCredit = 0;

    const accounts = rows.map((row) => {
      const debitTotal = parseFloat(row.debit_total);
      const creditTotal = parseFloat(row.credit_total);
      const balance = debitTotal - creditTotal;
      grandDebit += debitTotal;
      grandCredit += creditTotal;

      return {
        account_id: row.account_id,
        code: row.code,
        name: row.name,
        type: row.type,
        sub_type: row.sub_type,
        normal_balance: row.normal_balance,
        debit_total: debitTotal,
        credit_total: creditTotal,
        balance,
      };
    });

    return {
      accounts,
      grand_debit: parseFloat(grandDebit.toFixed(2)),
      grand_credit: parseFloat(grandCredit.toFixed(2)),
      is_balanced: Math.abs(grandDebit - grandCredit) < 0.01,
    };
  },

  /**
   * Profit & Loss Statement.
   */
  async getProfitAndLoss({ periodStart, periodEnd, entity }) {
    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted')
      .whereIn('coa.type', ['Revenue', 'COGS', 'Expense']);

    if (periodStart) {
      query = query.where('je.date', '>=', periodStart);
    }
    if (periodEnd) {
      query = query.where('je.date', '<=', periodEnd);
    }
    if (entity) {
      query = query.where(function () {
        this.where('je.entity', entity).orWhereNull('je.entity');
      });
    }

    const rows = await query
      .groupBy('coa.id', 'coa.code', 'coa.name', 'coa.type', 'coa.sub_type', 'coa.normal_balance')
      .select(
        'coa.id as account_id',
        'coa.code',
        'coa.name',
        'coa.type',
        'coa.sub_type',
        'coa.normal_balance',
        db.raw('COALESCE(SUM(jl.debit), 0)::numeric as debit_total'),
        db.raw('COALESCE(SUM(jl.credit), 0)::numeric as credit_total')
      )
      .orderBy('coa.code');

    const revenue = [];
    const cogs = [];
    const expenses = [];
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalExpenses = 0;

    for (const row of rows) {
      const debit = parseFloat(row.debit_total);
      const credit = parseFloat(row.credit_total);

      if (row.type === 'Revenue') {
        const amount = credit - debit; // Revenue normal balance is credit
        totalRevenue += amount;
        revenue.push({ ...row, debit_total: debit, credit_total: credit, amount });
      } else if (row.type === 'COGS') {
        const amount = debit - credit; // COGS normal balance is debit
        totalCOGS += amount;
        cogs.push({ ...row, debit_total: debit, credit_total: credit, amount });
      } else if (row.type === 'Expense') {
        const amount = debit - credit; // Expense normal balance is debit
        totalExpenses += amount;
        expenses.push({ ...row, debit_total: debit, credit_total: credit, amount });
      }
    }

    const grossProfit = parseFloat((totalRevenue - totalCOGS).toFixed(2));
    const netProfit = parseFloat((grossProfit - totalExpenses).toFixed(2));

    return {
      period: { start: periodStart, end: periodEnd },
      revenue: { accounts: revenue, total: parseFloat(totalRevenue.toFixed(2)) },
      cogs: { accounts: cogs, total: parseFloat(totalCOGS.toFixed(2)) },
      gross_profit: grossProfit,
      expenses: { accounts: expenses, total: parseFloat(totalExpenses.toFixed(2)) },
      net_profit: netProfit,
    };
  },

  /**
   * Balance Sheet as of a given date.
   */
  async getBalanceSheet({ asOfDate, entity }) {
    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted');

    if (asOfDate) {
      query = query.where('je.date', '<=', asOfDate);
    }
    if (entity) {
      query = query.where(function () {
        this.where('je.entity', entity).orWhereNull('je.entity');
      });
    }

    const rows = await query
      .groupBy('coa.id', 'coa.code', 'coa.name', 'coa.type', 'coa.sub_type', 'coa.normal_balance')
      .select(
        'coa.id as account_id',
        'coa.code',
        'coa.name',
        'coa.type',
        'coa.sub_type',
        'coa.normal_balance',
        db.raw('COALESCE(SUM(jl.debit), 0)::numeric as debit_total'),
        db.raw('COALESCE(SUM(jl.credit), 0)::numeric as credit_total')
      )
      .orderBy('coa.code');

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    // Also compute net income for balance sheet balancing
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalExpenses = 0;

    for (const row of rows) {
      const debit = parseFloat(row.debit_total);
      const credit = parseFloat(row.credit_total);
      const balance = debit - credit;

      if (row.type === 'Asset') {
        totalAssets += balance;
        assets.push({ ...row, debit_total: debit, credit_total: credit, balance });
      } else if (row.type === 'Liability') {
        const bal = credit - debit;
        totalLiabilities += bal;
        liabilities.push({ ...row, debit_total: debit, credit_total: credit, balance: bal });
      } else if (row.type === 'Equity') {
        const bal = credit - debit;
        totalEquity += bal;
        equity.push({ ...row, debit_total: debit, credit_total: credit, balance: bal });
      } else if (row.type === 'Revenue') {
        totalRevenue += (credit - debit);
      } else if (row.type === 'COGS' || row.type === 'Expense') {
        totalExpenses += (debit - credit);
      }
    }

    const netIncome = parseFloat((totalRevenue - totalCOGS - totalExpenses).toFixed(2));
    const totalLiabilitiesEquity = parseFloat((totalLiabilities + totalEquity + netIncome).toFixed(2));

    return {
      as_of_date: asOfDate,
      assets: { accounts: assets, total: parseFloat(totalAssets.toFixed(2)) },
      liabilities: { accounts: liabilities, total: parseFloat(totalLiabilities.toFixed(2)) },
      equity: { accounts: equity, total: parseFloat(totalEquity.toFixed(2)) },
      net_income: netIncome,
      total_liabilities_and_equity: totalLiabilitiesEquity,
      is_balanced: Math.abs(parseFloat(totalAssets.toFixed(2)) - totalLiabilitiesEquity) < 0.01,
    };
  },

  /**
   * Cash Flow Statement — simplified from journal entries touching cash/bank accounts.
   */
  async getCashFlow({ periodStart, periodEnd, entity }) {
    // Cash/bank accounts: 1000-1050
    const cashAccounts = await db('chart_of_accounts')
      .where('code', '>=', '1000')
      .where('code', '<=', '1050')
      .select('id', 'code', 'name');

    const cashAccountIds = cashAccounts.map((a) => a.id);

    if (cashAccountIds.length === 0) {
      return { operating: [], investing: [], financing: [], net_change: 0 };
    }

    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted')
      .whereIn('jl.account_id', cashAccountIds);

    if (periodStart) query = query.where('je.date', '>=', periodStart);
    if (periodEnd) query = query.where('je.date', '<=', periodEnd);
    if (entity) {
      query = query.where(function () {
        this.where('je.entity', entity).orWhereNull('je.entity');
      });
    }

    const entries = await query.select(
      'je.id as journal_id',
      'je.journal_no',
      'je.date',
      'je.description',
      'je.ref_type',
      'je.ref_no',
      'coa.code as account_code',
      'coa.name as account_name',
      db.raw('(jl.debit - jl.credit) as net_amount')
    ).orderBy('je.date');

    // Classify by ref_type
    const operating = [];
    const investing = [];
    const financing = [];
    let totalOperating = 0;
    let totalInvesting = 0;
    let totalFinancing = 0;

    for (const entry of entries) {
      const net = parseFloat(entry.net_amount);
      const refType = (entry.ref_type || '').toLowerCase();

      // Classify: investing = asset purchases, financing = equity/loans, everything else = operating
      if (refType.includes('invest') || refType.includes('asset')) {
        investing.push(entry);
        totalInvesting += net;
      } else if (refType.includes('equity') || refType.includes('loan') || refType.includes('capital')) {
        financing.push(entry);
        totalFinancing += net;
      } else {
        operating.push(entry);
        totalOperating += net;
      }
    }

    return {
      period: { start: periodStart, end: periodEnd },
      operating: { items: operating, total: parseFloat(totalOperating.toFixed(2)) },
      investing: { items: investing, total: parseFloat(totalInvesting.toFixed(2)) },
      financing: { items: financing, total: parseFloat(totalFinancing.toFixed(2)) },
      net_change: parseFloat((totalOperating + totalInvesting + totalFinancing).toFixed(2)),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // Customer / Supplier Statements
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Customer statement: opening balance + transactions + closing balance.
   */
  async getCustomerStatement(customerId, { dateFrom, dateTo }) {
    // Get all export orders for this customer
    const orders = await db('export_orders')
      .where({ customer_id: customerId })
      .select('id', 'order_no');

    const orderNos = orders.map((o) => o.order_no);

    if (orderNos.length === 0) {
      return { customer_id: customerId, opening_balance: 0, transactions: [], closing_balance: 0 };
    }

    // Opening balance: sum of all journal lines for receivable accounts linked to customer orders before dateFrom
    const arAccounts = await db('chart_of_accounts')
      .where('code', '>=', '1100')
      .where('code', '<=', '1130')
      .select('id');
    const arIds = arAccounts.map((a) => a.id);

    let openingQuery = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .whereIn('jl.account_id', arIds)
      .whereIn('je.ref_no', orderNos);

    if (dateFrom) {
      openingQuery = openingQuery.where('je.date', '<', dateFrom);
    }

    const openingResult = await openingQuery
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::numeric as balance'))
      .first();

    const openingBalance = parseFloat(openingResult.balance);

    // Transactions within period
    let txnQuery = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted')
      .whereIn('je.ref_no', orderNos);

    if (dateFrom) txnQuery = txnQuery.where('je.date', '>=', dateFrom);
    if (dateTo) txnQuery = txnQuery.where('je.date', '<=', dateTo);

    const transactions = await txnQuery
      .select(
        'je.date',
        'je.journal_no',
        'je.ref_no',
        'je.description',
        'coa.code as account_code',
        'coa.name as account_name',
        'jl.debit',
        'jl.credit'
      )
      .orderBy('je.date');

    // Closing balance
    let runningBalance = openingBalance;
    const formattedTxns = transactions.map((t) => {
      const debit = parseFloat(t.debit);
      const credit = parseFloat(t.credit);
      runningBalance += (debit - credit);
      return {
        ...t,
        debit,
        credit,
        running_balance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    return {
      customer_id: parseInt(customerId),
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      transactions: formattedTxns,
      closing_balance: parseFloat(runningBalance.toFixed(2)),
    };
  },

  /**
   * Supplier statement: opening balance + transactions + closing balance.
   */
  async getSupplierStatement(supplierId, { dateFrom, dateTo }) {
    // Get payables linked to this supplier
    const payables = await db('payables')
      .where({ supplier_id: supplierId })
      .select('id', 'pay_no', 'linked_ref');

    const linkedRefs = payables.map((p) => p.linked_ref).filter(Boolean);

    // Payable accounts
    const apAccounts = await db('chart_of_accounts')
      .where('code', '>=', '2000')
      .where('code', '<=', '2030')
      .select('id');
    const apIds = apAccounts.map((a) => a.id);

    // Opening balance
    let openingQuery = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .whereIn('jl.account_id', apIds);

    if (linkedRefs.length > 0) {
      openingQuery = openingQuery.whereIn('je.ref_no', linkedRefs);
    } else {
      // No linked refs — return empty
      return { supplier_id: parseInt(supplierId), opening_balance: 0, transactions: [], closing_balance: 0 };
    }

    if (dateFrom) {
      openingQuery = openingQuery.where('je.date', '<', dateFrom);
    }

    const openingResult = await openingQuery
      .select(db.raw('COALESCE(SUM(jl.credit - jl.debit), 0)::numeric as balance'))
      .first();

    const openingBalance = parseFloat(openingResult.balance);

    // Transactions within period
    let txnQuery = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id')
      .where('je.status', 'Posted')
      .whereIn('je.ref_no', linkedRefs);

    if (dateFrom) txnQuery = txnQuery.where('je.date', '>=', dateFrom);
    if (dateTo) txnQuery = txnQuery.where('je.date', '<=', dateTo);

    const transactions = await txnQuery
      .select(
        'je.date',
        'je.journal_no',
        'je.ref_no',
        'je.description',
        'coa.code as account_code',
        'coa.name as account_name',
        'jl.debit',
        'jl.credit'
      )
      .orderBy('je.date');

    let runningBalance = openingBalance;
    const formattedTxns = transactions.map((t) => {
      const debit = parseFloat(t.debit);
      const credit = parseFloat(t.credit);
      runningBalance += (credit - debit);
      return {
        ...t,
        debit,
        credit,
        running_balance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    return {
      supplier_id: parseInt(supplierId),
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      transactions: formattedTxns,
      closing_balance: parseFloat(runningBalance.toFixed(2)),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // Account Queries
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get the balance of a specific account as of a date.
   */
  async getAccountBalance(accountId, asOfDate) {
    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .where('jl.account_id', accountId);

    if (asOfDate) {
      query = query.where('je.date', '<=', asOfDate);
    }

    const result = await query
      .select(
        db.raw('COALESCE(SUM(jl.debit), 0)::numeric as total_debit'),
        db.raw('COALESCE(SUM(jl.credit), 0)::numeric as total_credit')
      )
      .first();

    const account = await db('chart_of_accounts').where({ id: accountId }).first();

    const totalDebit = parseFloat(result.total_debit);
    const totalCredit = parseFloat(result.total_credit);
    const balance = account && account.normal_balance === 'credit'
      ? totalCredit - totalDebit
      : totalDebit - totalCredit;

    return {
      account_id: accountId,
      code: account ? account.code : null,
      name: account ? account.name : null,
      normal_balance: account ? account.normal_balance : null,
      total_debit: totalDebit,
      total_credit: totalCredit,
      balance: parseFloat(balance.toFixed(2)),
      as_of_date: asOfDate || 'all time',
    };
  },

  /**
   * Get all transactions for a specific account within a date range.
   */
  async getAccountTransactions(accountId, { dateFrom, dateTo }) {
    let query = db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .where('jl.account_id', accountId);

    if (dateFrom) query = query.where('je.date', '>=', dateFrom);
    if (dateTo) query = query.where('je.date', '<=', dateTo);

    const transactions = await query
      .select(
        'je.id as journal_id',
        'je.journal_no',
        'je.date',
        'je.entity',
        'je.ref_type',
        'je.ref_no',
        'je.description',
        'jl.debit',
        'jl.credit',
        'jl.narration'
      )
      .orderBy('je.date')
      .orderBy('je.id');

    let runningBalance = 0;
    const enriched = transactions.map((t) => {
      const debit = parseFloat(t.debit);
      const credit = parseFloat(t.credit);
      runningBalance += (debit - credit);
      return {
        ...t,
        debit,
        credit,
        running_balance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    return enriched;
  },

  /**
   * Get the full chart of accounts.
   */
  async getChartOfAccounts() {
    return db('chart_of_accounts')
      .orderBy('code')
      .select('*');
  },
};

module.exports = accountingService;
