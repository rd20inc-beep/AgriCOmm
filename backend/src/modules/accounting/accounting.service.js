const db = require('../../config/database');
const fxRateService = require('../finance/fxRate.service');

/**
 * Currency conversion helpers for party statements. Journals are stored in
 * their transaction currency (export AR is USD with an fx_rate stamped, mill
 * flows are PKR), but ledgers are presented in PKR base so every party reads
 * consistently regardless of how each journal was denominated.
 *
 * Returns:
 *  - statementCurrency: always 'PKR'.
 *  - factorSql: SQL expression converting a native amount to PKR (native ×
 *    fx_rate; ×1 for PKR journals). Constant string, safe to inline in a SUM.
 *  - conv / convPkr(amount, currency, fxRate): JS equivalents per line.
 */
async function currencyMode() {
  // Party ledgers are presented in PKR base — every line converted via its
  // journal's fx_rate — so they read consistently regardless of how each
  // journal was denominated (some advances were posted native-USD, others
  // PKR). The original transaction currency stays visible in the journal
  // description. PartyLedger hides the redundant PKR sub-line since the
  // primary is already PKR.
  const statementCurrency = 'PKR';
  const toPkr = true;
  // PKR-base factor: native amount × fx_rate (×1 for PKR journals). Always valid.
  const pkrFactorSql = "CASE WHEN COALESCE(je.currency,'PKR')='PKR' THEN 1 ELSE COALESCE(je.fx_rate,1) END";
  // Display factor: native when the statement is shown in a single foreign
  // currency, PKR-base when it falls back to PKR.
  const factorSql = toPkr ? pkrFactorSql : '1';
  const toPkrAmt = (amt, cur, fx) => amt * ((cur || 'PKR') === 'PKR' ? 1 : (parseFloat(fx) || 1));
  const conv = (amt, cur, fx) => (toPkr ? toPkrAmt(amt, cur, fx) : amt);
  const convPkr = (amt, cur, fx) => toPkrAmt(amt, cur, fx);
  return { factorSql, pkrFactorSql, conv, convPkr, statementCurrency };
}

// ── Voucher-type classification for party ledgers (LedgerReport.pdf footer) ──
// The PDF tallies every ledger line by voucher type. We mirror the same nine
// buckets; for our data a debtor's charges are Sales / receipts are Receipt,
// and a creditor's bills are Purchase / settlements are Payment. A line whose
// reference looks like a manual journal/contra is bucketed accordingly.
const VCH_TYPES = ['Sales', 'Receipt', 'Sales Return', 'Purchase', 'Payment', 'Purchases Return', 'Manufacturing', 'Journal', 'Contra'];
const vchKey = (s) => s.toLowerCase().replace(/\s+/g, '_');
const emptyTypeCounts = () => {
  const o = {};
  VCH_TYPES.forEach((t) => { o[vchKey(t)] = 0; });
  o.total = 0;
  return o;
};
// Short voucher number for the VCH NO column: the trailing numeric segment of
// a document ref (LS-0005 → 0005, PAY-004 → 004); the full ref if none.
const vchNoOf = (ref) => {
  if (!ref) return '';
  const m = String(ref).match(/(\d+)(?!.*\d)/);
  return m ? m[1] : String(ref);
};
// party: 'customer' (AR, debit = charge) | 'supplier' (AP, credit = bill).
const classifyVch = (party, ref, debit, credit) => {
  const r = (ref || '').toUpperCase();
  if (/^(JE|JV|JNL)/.test(r)) return 'Journal';
  if (/^(CN|CV)/.test(r)) return 'Contra';
  if (party === 'customer') {
    if (debit > 0) return /(RET|CN-)/.test(r) ? 'Sales Return' : 'Sales';
    if (credit > 0) return 'Receipt';
  } else {
    if (credit > 0) return /(RET|DN-)/.test(r) ? 'Purchases Return' : 'Purchase';
    if (debit > 0) return 'Payment';
  }
  return 'Journal';
};

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
    // Party stamping — let statements filter journals by the customer/supplier
    // they belong to instead of fragile ref_no string matching. Both optional;
    // partyType is 'customer' | 'supplier'.
    partyType = null, partyId = null,
    // Original-currency metadata. Lines are ALWAYS PKR (GL is PKR-base); these
    // record the foreign currency + rate of the transaction so statements can
    // show an exact USD equivalent. Optional.
    origCurrency = null, origFxRate = null,
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
          // fx_rate is NOT NULL on journal_entries; default PKR to 1
          fx_rate: fxRate || 1,
          is_auto: isAuto,
          posting_rule_id: postingRuleId || null,
          period_id: period ? period.id : null,
          total_debit: totalDebit,
          total_credit: totalCredit,
          created_by: userId || null,
          party_type: partyType || null,
          party_id: partyId || null,
          orig_currency: origCurrency || null,
          orig_fx_rate: origFxRate || null,
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
   * Reverse a posted journal by marking it 'Reversed'.
   *
   * Every balance/report query (trial balance, P&L, balance sheet, account &
   * party ledgers) filters status='Posted', so flipping the entry to 'Reversed'
   * cleanly nets it out of the GL. We deliberately do NOT post a mirror/contra
   * entry: a contra is itself 'Posted', and against a Posted-only sum the
   * original is ALREADY excluded — so a contra would double-count the reversal
   * (move the books by -2x the entry) and pile up rows on repeated edits. The
   * reason + reverser are recorded on the entry; it still appears (labelled
   * 'Reversed') in the journal audit list. The status guard below also blocks
   * re-reversing an already-reversed entry for free.
   */
  async reverseJournal(trx, { journalId, reason, userId }) {
    const execute = async (knex) => {
      const original = await knex('journal_entries').where({ id: journalId }).first();
      if (!original) throw new Error(`Journal entry ${journalId} not found.`);
      if (original.status !== 'Posted') throw new Error('Only posted journals can be reversed.');

      const note = reason ? ` [Reversed: ${reason}]` : ' [Reversed]';
      await knex('journal_entries')
        .where({ id: journalId })
        .update({
          status: 'Reversed',
          description: `${original.description || ''}${note}`.slice(0, 1000),
          updated_at: knex.fn.now(),
        });

      return knex('journal_entries').where({ id: journalId }).first();
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
    // Party stamping — passed straight through to createJournal so
    // posting-rule-driven journals (receipts, bills, expenses) carry the
    // customer/supplier they belong to.
    partyType = null, partyId = null,
    // Original-currency metadata, passed through to createJournal.
    origCurrency = null, origFxRate = null,
    // Optional debit-account override (e.g. route salaries to a dedicated
    // Salaries & Wages account instead of the rule's generic 6000).
    debitAccountId = null,
    // Optional credit-account override (e.g. credit Salaries Payable instead of
    // the rule's generic Supplier Payable for an accrued payroll expense).
    creditAccountId = null,
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

      // Allow the caller to override the rule's debit/credit accounts (e.g.
      // salaries → DR 6135 Salaries & Wages / CR 2040 Salaries Payable).
      const debitId = debitAccountId || rule.debit_account_id;
      const creditId = creditAccountId || rule.credit_account_id;

      // Fetch account names for narration
      const [debitAcc, creditAcc] = await Promise.all([
        knex('chart_of_accounts').where({ id: debitId }).first(),
        knex('chart_of_accounts').where({ id: creditId }).first(),
      ]);

      const lines = [
        {
          account_id: debitId,
          account: debitAcc ? debitAcc.name : '',
          debit: parsedAmount,
          credit: 0,
          narration: `DR ${debitAcc ? debitAcc.code + ' ' + debitAcc.name : ''} — ${description || rule.description}`,
        },
        {
          account_id: creditId,
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
        partyType,
        partyId,
        origCurrency,
        origFxRate,
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
    const cid = parseInt(customerId);
    // Journals are matched to a customer in two ways:
    //   1. Authoritatively, via party_type/party_id stamped at post time.
    //   2. For older / unstamped journals, by the legacy ref_no heuristic —
    //      export order numbers, receivable numbers, and the payment numbers
    //      of receipts against this customer's receivables.
    // The ref set below feeds the fallback only; stamped journals win.
    const orders = await db('export_orders')
      .where({ customer_id: cid })
      .select('order_no');
    const receivables = await db('receivables')
      .where({ customer_id: cid })
      .select('id', 'recv_no');
    const recvIds = receivables.map((r) => r.id);
    const payments = recvIds.length
      ? await db('payments').whereIn('linked_receivable_id', recvIds).select('payment_no')
      : [];

    const refNos = [...new Set([
      ...orders.map((o) => o.order_no),
      ...receivables.map((r) => r.recv_no),
      ...payments.map((p) => p.payment_no),
    ].filter(Boolean))];

    // Receivable + customer-advance accounts (debit-normal). BOTH the
    // opening balance and the in-period lines are scoped to these account
    // ids so each journal contributes only its AR leg — without this scope
    // a balanced entry (DR AR / CR Revenue) nets to zero and the running
    // balance never moves.
    const arAccounts = await db('chart_of_accounts')
      .whereIn('code', ['1100', '1110', '1120', '1130', '1310'])
      .select('id');
    const arIds = arAccounts.map((a) => a.id);

    // A line counts if its journal is stamped to this customer, OR (for
    // unstamped legacy journals) its ref_no matches the heuristic set. The
    // party stamp is authoritative, so a journal stamped to another party is
    // never pulled in by a coincidental ref match.
    const lineBase = () => db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .whereIn('jl.account_id', arIds)
      .where((qb) => {
        qb.where((q) => q.where('je.party_type', 'customer').where('je.party_id', cid));
        if (refNos.length) {
          qb.orWhere((q) => q.whereNull('je.party_id').whereIn('je.ref_no', refNos));
        }
      });

    // Ledgers are presented in PKR base (primary), with a USD equivalent shown
    // as a sub-line on every amount. usdOf is EXACT when the journal carries its
    // original currency: a natively-USD line is itself the USD, and a PKR line
    // with orig metadata divides by its original rate. Only journals with no
    // original-currency info fall back to the current USD→PKR rate.
    const { factorSql, conv, statementCurrency } = await currencyMode();
    const usdRate = (await fxRateService.getLatestRate('USD')).rate || 280;
    const usdOf = (native, cur, fx, origRate, origCur) => {
      const c = (cur || 'PKR').toUpperCase();
      if (c === 'USD') return native;
      const pkr = native * (c === 'PKR' ? 1 : (parseFloat(fx) || 1));
      const oRate = parseFloat(origRate) || 0;
      if (oRate > 0 && (origCur || '').toUpperCase() === 'USD') return pkr / oRate;
      return usdRate ? pkr / usdRate : 0;
    };

    // Opening balance (before dateFrom), in PKR with a USD approximation.
    let openingBalance = 0;
    if (dateFrom) {
      const openingResult = await lineBase()
        .where('je.date', '<', dateFrom)
        .select(db.raw(`COALESCE(SUM((jl.debit - jl.credit) * (${factorSql})), 0)::numeric as balance`))
        .first();
      openingBalance = parseFloat(openingResult.balance);
    }
    // Local-sales (mill) transactions — credit/cash local sales create
    // receivables but NOT party-stamped AR journals, so the journal scan above
    // misses them. Pull them in directly: each sale is a debit (charge), each
    // receipt against it a credit. (Export customers have no local sales → no-op.)
    // Match sales linked to the customer, AND walk-in sales (customer_id NULL)
    // recorded under the same buyer name — a cash walk-in often isn't linked to
    // the customer record that was registered later.
    const custRow = await db('customers').where({ id: cid }).first();
    const localSalesRows = await db('local_sales')
      .where(function () {
        this.where('customer_id', cid);
        if (custRow && custRow.name) {
          this.orWhere(function () {
            this.whereNull('customer_id').whereRaw('LOWER(buyer_name) = LOWER(?)', [custRow.name]);
          });
        }
      })
      .select('id', 'sale_no', 'total_amount', 'due_amount', 'paid_amount', 'created_at', 'item_name', 'item_type',
        'quantity_kg', 'quantity_bags', 'bag_weight_kg', 'lot_no', 'notes', 'collection_location');
    const lsIds = localSalesRows.map((s) => s.id);
    const lsPays = lsIds.length
      ? await db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        .whereIn('p.local_sale_id', lsIds)
        .select('p.amount', 'p.payment_date', 'p.payment_no', 'p.payment_method', 'p.bank_reference', 'p.local_sale_id', 'ba.name as account_name')
      : [];
    const saleById = Object.fromEntries(localSalesRows.map((s) => [s.id, s]));
    const methodLbl = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', online: 'Online', mobile: 'Mobile' };
    const localRaw = [
      ...localSalesRows.map((s) => {
        const qty = parseFloat(s.quantity_kg) || 0;
        const total = parseFloat(s.total_amount) || 0;
        const rate = qty > 0 ? total / qty : 0;
        // Full sale narration: item (+ type) · quantity (kg + bags) · rate/kg ·
        // source lot · pickup location, then any free-text note.
        const detail = [
          s.item_name,
          s.item_type && s.item_type.toLowerCase() !== String(s.item_name || '').toLowerCase() ? s.item_type : '',
          qty > 0 ? `${Math.round(qty).toLocaleString()} kg` : '',
          s.quantity_bags ? `${s.quantity_bags} bag${s.quantity_bags === 1 ? '' : 's'}${parseFloat(s.bag_weight_kg) > 0 ? ` × ${parseFloat(s.bag_weight_kg)}kg` : ''}` : '',
          rate > 0 ? `@ Rs ${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/kg` : '',
          s.lot_no ? `Lot ${s.lot_no}` : '',
          s.collection_location,
        ].filter(Boolean).join(' · ');
        const due = parseFloat(s.due_amount) || 0;
        const status = due <= 0.01 ? 'Paid' : ((total - due) > 0 ? 'Partial' : 'Unpaid');
        return { date: s.created_at, ref_no: s.sale_no, description: `Local sale${detail ? ` — ${detail}` : ''}${s.notes ? ` (${s.notes})` : ''}`, d: total, c: 0, status };
      }),
      ...lsPays.map((p) => {
        // Reference the sale this receipt settles (which item/lot), so a receipt
        // line isn't just "Receipt — Cash" with no context.
        const sale = saleById[p.local_sale_id];
        const saleDesc = sale ? [sale.item_name, sale.lot_no ? `Lot ${sale.lot_no}` : ''].filter(Boolean).join(' ') : '';
        const bits = [
          methodLbl[p.payment_method] || p.payment_method,
          p.account_name,                       // which account received it
          p.bank_reference,
          sale?.sale_no ? `for ${sale.sale_no}${saleDesc ? ` (${saleDesc})` : ''}` : '',
        ].filter(Boolean).join(' · ');
        return { date: p.payment_date, ref_no: p.payment_no, description: `Receipt${bits ? ` — ${bits}` : ''}`, d: 0, c: parseFloat(p.amount) || 0 };
      }),
    ];
    // Local rows before the window add to the opening balance.
    for (const t of localRaw) {
      if (dateFrom && t.date && new Date(t.date) < new Date(dateFrom)) openingBalance += (t.d - t.c);
    }
    const openingBalanceUsd = usdRate ? openingBalance / usdRate : 0;

    // Transactions within period (journal lines)
    let txnQuery = lineBase()
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id');

    if (dateFrom) txnQuery = txnQuery.where('je.date', '>=', dateFrom);
    if (dateTo) txnQuery = txnQuery.where('je.date', '<=', dateTo);

    const journalTxns = await txnQuery
      .select(
        'je.date', 'je.journal_no', 'je.ref_no', 'je.description',
        'coa.code as account_code', 'coa.name as account_name',
        'jl.debit', 'jl.credit', 'je.currency', 'je.fx_rate',
        'je.orig_currency', 'je.orig_fx_rate'
      )
      .orderBy(['je.date', 'je.id']);

    // Detailed sale narration for export lines: an EX- journal line links to an
    // export_orders row with the product, quantity, price and incoterm. Append
    // that summary so the ledger carries the full sale, not just "Adv rcpt EX-1".
    const exRefs = [...new Set(journalTxns.map((t) => t.ref_no).filter((r) => r && /^EX-/i.test(r)))];
    // A PAY- line settles a receivable that links back to an export order, so
    // resolve payment_no → receivable → order to enrich those lines too (else a
    // receipt against an export sale reads as a bare "Payment PAY-003"). Two
    // paths to the receivable: the payment row's linked_receivable_id, and —
    // when that link is missing — the "receivable #N" the journal stamps into
    // its own description.
    const exPayRefs = [...new Set(journalTxns.map((t) => t.ref_no).filter((r) => r && /^PAY-/i.test(r)))];
    const exPayRows = exPayRefs.length
      ? await db('payments').whereIn('payment_no', exPayRefs).select('payment_no', 'linked_receivable_id')
      : [];
    const descRecvIds = journalTxns
      .map((t) => { const m = /receivable #(\d+)/i.exec(t.description || ''); return m ? parseInt(m[1]) : null; })
      .filter(Boolean);
    const exRecvIds = [...new Set([
      ...exPayRows.map((p) => p.linked_receivable_id),
      ...descRecvIds,
    ].filter(Boolean))];
    const exRecvRows = exRecvIds.length
      ? await db('receivables').whereIn('id', exRecvIds).select('id', 'order_id')
      : [];
    const recvOrderId = Object.fromEntries(exRecvRows.map((r) => [r.id, r.order_id]));
    const payOrderId = Object.fromEntries(exPayRows.map((p) => [p.payment_no, recvOrderId[p.linked_receivable_id]]));
    const orderIds = [...new Set(Object.values(recvOrderId).filter(Boolean))];
    const exOrders = (exRefs.length || orderIds.length)
      ? await db('export_orders')
        .where(function () {
          if (exRefs.length) this.whereIn('order_no', exRefs);
          if (orderIds.length) this.orWhereIn('id', orderIds);
        })
        .select('id', 'order_no', 'product_name', 'qty_mt', 'quantity_unit', 'price_per_mt', 'incoterm', 'total_bags')
      : [];
    const exByNo = Object.fromEntries(exOrders.map((o) => [o.order_no, o]));
    const exById = Object.fromEntries(exOrders.map((o) => [o.id, o]));
    const orderSummary = (o) => {
      const qty = parseFloat(o.qty_mt) || 0;
      const price = parseFloat(o.price_per_mt) || 0;
      const perKg = price > 0 ? price / 1000 : 0;
      return [
        o.product_name,
        qty > 0 ? `${qty} ${o.quantity_unit || 'MT'}` : '',
        price > 0 ? `@ ${price.toLocaleString()}/MT (${perKg.toLocaleString(undefined, { maximumFractionDigits: 3 })}/kg)` : '',
        o.incoterm,
        o.total_bags ? `${o.total_bags} bags` : '',
      ].filter(Boolean).join(' · ');
    };
    const enrichExport = (refNo, desc) => {
      let o = (refNo && exByNo[refNo]) || (refNo && exById[payOrderId[refNo]]);
      if (!o && desc) {
        const m = /receivable #(\d+)/i.exec(desc);
        if (m) o = exById[recvOrderId[parseInt(m[1])]];
      }
      if (!o) return desc;
      const summary = orderSummary(o);
      if (!summary) return desc;
      // Don't double up if the product name is already in the description.
      return (desc && o.product_name && desc.includes(o.product_name)) ? desc : `${desc || refNo} — ${summary}`;
    };

    // Merge journal + local-sales rows into one date-sorted ledger.
    const merged = [
      ...journalTxns.map((t) => ({
        date: t.date, journal_no: t.journal_no, ref_no: t.ref_no, description: enrichExport(t.ref_no, t.description),
        account_code: t.account_code, account_name: t.account_name,
        nd: parseFloat(t.debit), nc: parseFloat(t.credit), status: null,
        currency: t.currency, fx_rate: t.fx_rate, orig_fx_rate: t.orig_fx_rate, orig_currency: t.orig_currency,
      })),
      ...localRaw.filter((t) => {
        if (dateFrom && t.date && new Date(t.date) < new Date(dateFrom)) return false;
        if (dateTo && t.date && new Date(t.date) > new Date(dateTo)) return false;
        return true;
      }).map((t) => ({
        date: t.date, journal_no: null, ref_no: t.ref_no, description: t.description,
        account_code: '1120', account_name: 'Local Sales A/R',
        nd: t.d, nc: t.c, status: t.status || null, currency: 'PKR', fx_rate: 1, orig_fx_rate: null, orig_currency: null,
      })),
    ].sort((a, b) => {
      // Compare by DAY (a sale's created_at carries a time, a payment_date is
      // midnight — so they're never "equal" without truncating to the day).
      const dayA = new Date(a.date).setHours(0, 0, 0, 0);
      const dayB = new Date(b.date).setHours(0, 0, 0, 0);
      // Same day: charges (debits) before receipts (credits) so the running
      // balance doesn't dip negative when a sale and its payment share a date.
      return (dayA - dayB) || ((a.nc > 0 ? 1 : 0) - (b.nc > 0 ? 1 : 0));
    });

    // Closing balance
    let runningBalance = openingBalance;
    let runningBalanceUsd = openingBalanceUsd;
    const typeCounts = emptyTypeCounts();
    let totalDebit = 0;
    let totalCredit = 0;
    const formattedTxns = merged.map((t) => {
      const debit = conv(t.nd, t.currency, t.fx_rate);
      const credit = conv(t.nc, t.currency, t.fx_rate);
      const debitUsd = usdOf(t.nd, t.currency, t.fx_rate, t.orig_fx_rate, t.orig_currency);
      const creditUsd = usdOf(t.nc, t.currency, t.fx_rate, t.orig_fx_rate, t.orig_currency);
      runningBalance += (debit - credit);
      runningBalanceUsd += (debitUsd - creditUsd);
      totalDebit += debit;
      totalCredit += credit;
      const vchType = classifyVch('customer', t.ref_no, debit, credit);
      typeCounts[vchKey(vchType)] += 1;
      typeCounts.total += 1;
      return {
        date: t.date,
        journal_no: t.journal_no,
        ref_no: t.ref_no,
        vch_type: vchType,
        vch_no: vchNoOf(t.ref_no),
        description: t.description,
        account_code: t.account_code,
        account_name: t.account_name,
        status: t.status || null,
        debit: parseFloat(debit.toFixed(2)),
        credit: parseFloat(credit.toFixed(2)),
        debit_usd: parseFloat(debitUsd.toFixed(2)),
        credit_usd: parseFloat(creditUsd.toFixed(2)),
        currency: statementCurrency,
        running_balance: parseFloat(runningBalance.toFixed(2)),
        running_balance_usd: parseFloat(runningBalanceUsd.toFixed(2)),
      };
    });

    // Open receivables NOT carried on the GL ledger — e.g. export orders still
    // "Awaiting Advance" create expected receivable rows but no posted journal,
    // so they show in Due Dates yet leave the (GL-based) statement empty.
    // Surface them so the statement explains what's still owed. Local-sale
    // receivables are excluded — those are already merged in as ledger lines.
    const openRecv = await db('receivables as r')
      .leftJoin('export_orders as o', 'o.id', 'r.order_id')
      .where('r.customer_id', cid)
      .whereNot('r.status', 'Paid')
      .where('r.outstanding', '>', 0)
      .whereNull('r.local_sale_id')
      .orderBy('r.due_date')
      .select('r.recv_no', 'r.type', 'r.outstanding', 'r.expected_amount', 'r.received_amount',
        'r.currency', 'r.due_date', 'r.status', 'o.order_no', 'o.product_name', 'o.qty_mt',
        'o.quantity_unit', 'o.price_per_mt', 'o.incoterm', 'o.total_bags');
    const openItems = openRecv.map((r) => {
      const qty = parseFloat(r.qty_mt) || 0;
      const price = parseFloat(r.price_per_mt) || 0;
      const detail = [
        r.product_name,
        qty > 0 ? `${qty} ${r.quantity_unit || 'MT'}` : '',
        price > 0 ? `@ ${price.toLocaleString()}/MT (${(price / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}/kg)` : '',
        r.incoterm,
        r.total_bags ? `${r.total_bags} bags` : '',
      ].filter(Boolean).join(' · ') || null;
      return {
        ref: r.recv_no, label: r.type || 'Receivable', detail, order_no: r.order_no || null,
        currency: r.currency || 'PKR', outstanding: parseFloat(r.outstanding) || 0,
        expected: parseFloat(r.expected_amount) || 0, received: parseFloat(r.received_amount) || 0,
        due_date: r.due_date, status: r.status,
      };
    });

    return {
      customer_id: cid,
      currency: statementCurrency,
      usd_rate: usdRate,
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      opening_balance_usd: parseFloat(openingBalanceUsd.toFixed(2)),
      transactions: formattedTxns,
      type_counts: typeCounts,
      total_debit: parseFloat(totalDebit.toFixed(2)),
      total_credit: parseFloat(totalCredit.toFixed(2)),
      closing_balance: parseFloat(runningBalance.toFixed(2)),
      closing_balance_usd: parseFloat(runningBalanceUsd.toFixed(2)),
      open_items: openItems,
    };
  },

  /**
   * Supplier statement: opening balance + transactions + closing balance.
   */
  async getSupplierStatement(supplierId, { dateFrom, dateTo }) {
    const sid = parseInt(supplierId);
    // Journals are matched to a supplier in two ways:
    //   1. Authoritatively, via party_type/party_id stamped at post time.
    //   2. For older / unstamped journals, by the legacy ref_no heuristic —
    //      payable linked_ref / pay_no and the payment numbers of settlements
    //      against this supplier's payables.
    // The ref set below feeds the fallback only; stamped journals win.
    const payables = await db('payables')
      .where({ supplier_id: sid })
      .select('id', 'pay_no', 'linked_ref', 'original_amount', 'paid_amount',
        'currency', 'due_date', 'created_at', 'category', 'source_table', 'notes');

    // Paid status per payable, keyed by both its refs, so each bill row in the
    // ledger can be tinted Paid / Partial / Unpaid.
    const payableStatusByRef = {};
    for (const p of payables) {
      const orig = parseFloat(p.original_amount) || 0;
      const paid = parseFloat(p.paid_amount) || 0;
      const st = (orig - paid) <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid');
      if (p.pay_no) payableStatusByRef[p.pay_no] = st;
      if (p.linked_ref) payableStatusByRef[p.linked_ref] = st;
    }

    // Detailed purchase narration: raw-rice payables link to an inventory_lots
    // row (by lot_no = linked_ref) carrying the full buy — rice type, variety,
    // grade, net weight, rate/kg, bags, moisture. Pull them once so each
    // purchase line in the ledger reads like the PDF narration rather than a
    // bare "Payable PAY-001".
    const lotRefs = [...new Set([
      ...payables.map((p) => p.linked_ref),
      ...payables.map((p) => p.pay_no),
    ].filter(Boolean))];
    const lotRows = lotRefs.length
      ? await db('inventory_lots').whereIn('lot_no', lotRefs)
        .select('lot_no', 'product_id', 'variety', 'grade', 'net_weight_kg', 'received_net_weight_kg',
          'gross_weight_kg', 'rate_per_kg', 'total_bags', 'moisture_pct')
      : [];
    // Some raw-rice payables are keyed by a milling BATCH (source milling_raw_rice,
    // linked_ref = batch_no like "M-003") rather than an inventory lot — the buy
    // detail (raw qty, cost, product) lives on milling_batches instead.
    const batchRows = lotRefs.length
      ? await db('milling_batches').whereIn('batch_no', lotRefs)
        .select('batch_no', 'product_id', 'raw_qty_kg', 'raw_cost_total', 'purchase_price_per_kg')
      : [];
    const lotProdIds = [...new Set([
      ...lotRows.map((l) => l.product_id),
      ...batchRows.map((b) => b.product_id),
    ].filter(Boolean))];
    const lotProds = lotProdIds.length
      ? await db('products').whereIn('id', lotProdIds).select('id', 'name')
      : [];
    const lotProdName = Object.fromEntries(lotProds.map((p) => [p.id, p.name]));
    const lotByNo = {};
    lotRows.forEach((l) => { lotByNo[l.lot_no] = l; });
    const batchByNo = {};
    batchRows.forEach((b) => { batchByNo[b.batch_no] = b; });
    const num0 = (v) => parseFloat(v) || 0;
    // Full purchase narration for a lot: rice type · variety · grade · weight
    // (purchased net, falling back through received/gross) · rate/kg · bags ·
    // moisture. Empty string when the ref isn't a known lot.
    const lotNarration = (lotNo, includeName = true) => {
      const lot = lotNo && lotByNo[lotNo];
      if (!lot) return '';
      const kg = num0(lot.received_net_weight_kg) || num0(lot.net_weight_kg) || num0(lot.gross_weight_kg);
      const mt = kg / 1000;
      const rate = num0(lot.rate_per_kg);
      const name = lotProdName[lot.product_id] || 'Raw rice';
      // Variety is often identical to the product name — only show it if it adds
      // information.
      const variety = lot.variety && lot.variety.trim().toLowerCase() !== name.trim().toLowerCase()
        ? lot.variety : '';
      return [
        includeName ? name : '',
        includeName ? variety : '',
        lot.grade ? `Grade ${lot.grade}` : '',
        kg > 0 ? `${Math.round(kg).toLocaleString()} kg${mt >= 1 ? ` (${mt.toFixed(2)} MT)` : ''}` : '',
        rate > 0 ? `@ Rs ${rate.toLocaleString()}/kg` : '',
        lot.total_bags ? `${lot.total_bags} bags` : '',
        num0(lot.moisture_pct) > 0 ? `${lot.moisture_pct}% moisture` : '',
      ].filter(Boolean).join(' · ');
    };
    // Same shape for a milling-batch raw-rice buy (no lot): qty/rate derived from
    // the batch's raw_qty_mt + raw_cost_total.
    const batchNarration = (batchNo, includeName = true) => {
      const b = batchNo && batchByNo[batchNo];
      if (!b) return '';
      const kg = num0(b.raw_qty_kg);
      const mt = kg / 1000;
      const total = num0(b.raw_cost_total);
      const rate = num0(b.purchase_price_per_kg) || (kg > 0 ? total / kg : 0);
      const name = lotProdName[b.product_id] || 'Raw rice';
      return [
        includeName ? name : '',
        kg > 0 ? `${Math.round(kg).toLocaleString()} kg${mt >= 1 ? ` (${mt.toFixed(2)} MT)` : ''}` : '',
        rate > 0 ? `@ Rs ${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/kg` : '',
      ].filter(Boolean).join(' · ');
    };
    const purchaseNarration = (ref, includeName = true) =>
      lotNarration(ref, includeName) || batchNarration(ref, includeName);
    const describePurchase = (p) => {
      const ref = p.linked_ref || p.pay_no || '';
      const nar = purchaseNarration(p.linked_ref) || purchaseNarration(p.pay_no);
      if (nar) return `Purchase ${ref} — ${nar}`;
      const tail = [p.category, p.notes].filter(Boolean).join(' · ');
      return `Purchase ${ref}${tail ? ` — ${tail}` : ''}`.trim();
    };
    // GL-backed purchase lines carry a terse journal description ("Purchase lot
    // X (GL reconciled)" / "Rice purchase — <product> (batch M-003)"); append the
    // quantity/rate/bags narration so they read in full too. If the product name
    // (or variety) is already in the description, append the metrics WITHOUT
    // repeating the name — never skip the whole narration.
    const enrichGlPurchase = (refNo, desc, isCredit) => {
      if (!isCredit) return desc;
      const src = lotByNo[refNo] || batchByNo[refNo];
      if (!src) return desc;
      const name = lotProdName[src.product_id] || '';
      const variety = src.variety || '';
      const hasName = desc && ((name && desc.includes(name)) || (variety && desc.includes(variety)));
      const nar = purchaseNarration(refNo, !hasName);
      if (!nar) return desc;
      return `${desc || `Purchase ${refNo}`} — ${nar}`;
    };
    const payableIds = payables.map((p) => p.id);
    const payments = payableIds.length
      ? await db('payments').whereIn('linked_payable_id', payableIds).select('payment_no')
      : [];

    const refNos = [...new Set([
      ...payables.map((p) => p.linked_ref),
      ...payables.map((p) => p.pay_no),
      ...payments.map((p) => p.payment_no),
    ].filter(Boolean))];

    // Payable + accrual accounts (credit-normal). Scoped on BOTH the
    // opening balance and the in-period lines so each journal contributes
    // only its AP leg (see the customer statement note above).
    const apAccounts = await db('chart_of_accounts')
      .whereIn('code', ['2000', '2010', '2020', '2030', '2110'])
      .select('id');
    const apIds = apAccounts.map((a) => a.id);

    // Stamped-to-this-supplier OR (unstamped legacy journal whose ref_no
    // matches the heuristic set). Party stamp is authoritative.
    const lineBase = () => db('journal_lines as jl')
      .join('journal_entries as je', 'jl.journal_id', 'je.id')
      .where('je.status', 'Posted')
      .whereIn('jl.account_id', apIds)
      .where((qb) => {
        qb.where((q) => q.where('je.party_type', 'supplier').where('je.party_id', sid));
        if (refNos.length) {
          qb.orWhere((q) => q.whereNull('je.party_id').whereIn('je.ref_no', refNos));
        }
      });

    // PKR base (primary) with a USD sub-line on every amount. usdOf is exact
    // from the journal's original-currency metadata; see the customer note.
    const { factorSql, conv, statementCurrency } = await currencyMode();
    const usdRate = (await fxRateService.getLatestRate('USD')).rate || 280;
    const usdOf = (native, cur, fx, origRate, origCur) => {
      const c = (cur || 'PKR').toUpperCase();
      if (c === 'USD') return native;
      const pkr = native * (c === 'PKR' ? 1 : (parseFloat(fx) || 1));
      const oRate = parseFloat(origRate) || 0;
      if (oRate > 0 && (origCur || '').toUpperCase() === 'USD') return pkr / oRate;
      return usdRate ? pkr / usdRate : 0;
    };

    // ── Payable-derived lines for payables with NO GL representation ──
    // Mill paddy purchases (source milling_costs) create a payable but never
    // post a party-stamped AP journal, so they would be invisible in a purely
    // GL-based statement (the directory shows them, the ledger didn't). We
    // synthesize ledger lines for those payables only: a payable already
    // represented by a posted AP journal (its pay_no/linked_ref appears on a
    // matched line) is skipped, so nothing is double-counted. Additive — a
    // supplier whose payables are all properly posted is unchanged.
    const glRefRows = await lineBase().distinct('je.ref_no');
    const glRefs = new Set(glRefRows.map((r) => r.ref_no).filter(Boolean));
    const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    const synthetic = [];
    for (const p of payables) {
      const covered = (p.pay_no && glRefs.has(p.pay_no)) || (p.linked_ref && glRefs.has(p.linked_ref));
      if (covered) continue;
      const cur = p.currency || 'PKR';
      const billed = parseFloat(p.original_amount) || 0;
      const paid = parseFloat(p.paid_amount) || 0;
      const date = dayOf(p.due_date) || dayOf(p.created_at);
      const refNo = p.pay_no || p.linked_ref || null;
      const label = describePurchase(p);
      const base = { date, journal_no: null, ref_no: refNo, account_code: '2000',
        account_name: 'Accounts Payable', currency: cur, fx_rate: 1, orig_currency: cur, orig_fx_rate: 0 };
      if (billed) synthetic.push({ ...base, description: label, debit: 0, credit: billed });
      if (paid) synthetic.push({ ...base, description: `Payment against ${p.linked_ref || refNo || 'payable'}`, debit: paid, credit: 0 });
    }

    // Normalize one raw line (GL or synthetic) into PKR/USD figures.
    const normalize = (t) => {
      const nd = parseFloat(t.debit) || 0, nc = parseFloat(t.credit) || 0;
      return {
        date: t.date, journal_no: t.journal_no, ref_no: t.ref_no, description: t.description,
        account_code: t.account_code, account_name: t.account_name,
        debit: conv(nd, t.currency, t.fx_rate), credit: conv(nc, t.currency, t.fx_rate),
        debit_usd: usdOf(nd, t.currency, t.fx_rate, t.orig_fx_rate, t.orig_currency),
        credit_usd: usdOf(nc, t.currency, t.fx_rate, t.orig_fx_rate, t.orig_currency),
      };
    };

    // Opening balance (before dateFrom): GL + synthetic, PKR with USD approx.
    let openingBalance = 0;
    if (dateFrom) {
      const openingResult = await lineBase()
        .where('je.date', '<', dateFrom)
        .select(db.raw(`COALESCE(SUM((jl.credit - jl.debit) * (${factorSql})), 0)::numeric as balance`))
        .first();
      openingBalance = parseFloat(openingResult.balance);
      for (const s of synthetic) {
        if (s.date && s.date < dateFrom) { const n = normalize(s); openingBalance += (n.credit - n.debit); }
      }
    }
    const openingBalanceUsd = usdRate ? openingBalance / usdRate : 0;

    // In-period GL lines
    let txnQuery = lineBase()
      .join('chart_of_accounts as coa', 'jl.account_id', 'coa.id');
    if (dateFrom) txnQuery = txnQuery.where('je.date', '>=', dateFrom);
    if (dateTo) txnQuery = txnQuery.where('je.date', '<=', dateTo);
    const glTxns = await txnQuery
      .select(
        'je.date', 'je.journal_no', 'je.ref_no', 'je.description',
        'coa.code as account_code', 'coa.name as account_name',
        'jl.debit', 'jl.credit', 'je.currency', 'je.fx_rate', 'je.orig_currency', 'je.orig_fx_rate'
      )
      .orderBy(['je.date', 'je.id']);

    // How each payment was made (method + bank/cash account) lives on the
    // payments table, not the journal. Match by ref_no = payment_no so the
    // statement can show "Paid via <bank>" / "Paid via Cash".
    const payRefs = [...new Set(glTxns.map((t) => t.ref_no).filter((r) => r && /^PAY-/i.test(r)))];
    const payInfo = {};
    if (payRefs.length) {
      const payRows = await db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        .whereIn('p.payment_no', payRefs)
        .select('p.payment_no', 'p.payment_method', 'ba.name as bank_name', 'ba.type as bank_type');
      for (const r of payRows) {
        const isCash = r.bank_type === 'cash' || r.payment_method === 'cash';
        payInfo[r.payment_no] = {
          payment_method: r.payment_method || null,
          paid_via: r.bank_name || (isCash ? 'Cash' : null),
        };
      }
    }

    // In-period synthetic lines
    const synthInPeriod = synthetic.filter((s) =>
      (!dateFrom || (s.date && s.date >= dateFrom)) && (!dateTo || (s.date && s.date <= dateTo)));

    // Merge GL + synthetic, normalize, stable-sort by date, one balance pass.
    // GL purchase lines get the lot narration appended before normalizing.
    const glEnriched = glTxns.map((t) => ({
      ...t,
      description: enrichGlPurchase(t.ref_no, t.description, (parseFloat(t.credit) || 0) > 0),
    }));
    const merged = [...glEnriched, ...synthInPeriod]
      .map(normalize)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let runningBalance = openingBalance;
    let runningBalanceUsd = openingBalanceUsd;
    const typeCounts = emptyTypeCounts();
    let totalDebit = 0;
    let totalCredit = 0;
    const formattedTxns = merged.map((n) => {
      runningBalance += (n.credit - n.debit);
      runningBalanceUsd += (n.credit_usd - n.debit_usd);
      totalDebit += n.debit;
      totalCredit += n.credit;
      const vchType = classifyVch('supplier', n.ref_no, n.debit, n.credit);
      typeCounts[vchKey(vchType)] += 1;
      typeCounts.total += 1;
      // Only bill (credit) rows carry a paid status; payments don't.
      const status = n.credit > 0 ? (payableStatusByRef[n.ref_no] || null) : null;
      // For a payment (debit) row, fold the method + the account it was paid
      // from into the description so "how it was paid" is visible in the ledger.
      const pv = n.ref_no ? payInfo[n.ref_no] : null;
      let description = n.description;
      if (n.debit > 0 && pv && (pv.paid_via || pv.payment_method)) {
        const mLbl = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', online: 'Online', mobile: 'Mobile' }[pv.payment_method] || pv.payment_method;
        const tail = [mLbl, pv.paid_via].filter(Boolean).filter((v, idx, a) => a.indexOf(v) === idx).join(' · ');
        if (tail) description = `${n.description} — ${tail}`;
      }
      return {
        date: n.date,
        journal_no: n.journal_no,
        ref_no: n.ref_no,
        vch_type: vchType,
        vch_no: vchNoOf(n.ref_no),
        description,
        account_code: n.account_code,
        account_name: n.account_name,
        status,
        debit: parseFloat(n.debit.toFixed(2)),
        credit: parseFloat(n.credit.toFixed(2)),
        debit_usd: parseFloat(n.debit_usd.toFixed(2)),
        credit_usd: parseFloat(n.credit_usd.toFixed(2)),
        currency: statementCurrency,
        running_balance: parseFloat(runningBalance.toFixed(2)),
        running_balance_usd: parseFloat(runningBalanceUsd.toFixed(2)),
        // Present only on payment rows: how it was paid (method + bank/cash).
        payment_method: (n.ref_no && payInfo[n.ref_no]?.payment_method) || null,
        paid_via: (n.ref_no && payInfo[n.ref_no]?.paid_via) || null,
      };
    });

    // Open (unsettled) payables for this supplier — an at-a-glance "what's still
    // owed" aging that mirrors the Due Dates list.
    const openPay = await db('payables')
      .where('supplier_id', sid)
      .whereNot('status', 'Paid')
      .where('outstanding', '>', 0)
      .orderBy('due_date')
      .select('pay_no', 'linked_ref', 'category', 'outstanding', 'original_amount', 'paid_amount',
        'currency', 'due_date', 'status');
    // Friendlier "Type": show the product (rice type) for raw-rice payables that
    // link to a lot/batch; otherwise a cleaned-up category ("Raw Material" /
    // "office_supplies" → "Raw rice" / "Office supplies").
    const cleanCat = (c) => {
      if (!c) return 'Payable';
      if (/^raw\s*(material|rice)$/i.test(c)) return 'Raw rice';
      return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    };
    const openItems = openPay.map((p) => {
      const src = (p.linked_ref && (lotByNo[p.linked_ref] || batchByNo[p.linked_ref])) || null;
      const product = src && lotProdName[src.product_id];
      // Full buy detail (weight · rate/kg · bags …) without repeating the product
      // name, so the not-yet-settled line carries the same info as the ledger.
      const detail = purchaseNarration(p.linked_ref, false) || purchaseNarration(p.pay_no, false) || null;
      return {
        ref: p.linked_ref || p.pay_no, label: product || cleanCat(p.category), detail, order_no: null,
        currency: p.currency || 'PKR', outstanding: parseFloat(p.outstanding) || 0,
        expected: parseFloat(p.original_amount) || 0, received: parseFloat(p.paid_amount) || 0,
        due_date: p.due_date, status: p.status,
      };
    });

    return {
      supplier_id: sid,
      currency: statementCurrency,
      usd_rate: usdRate,
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      opening_balance_usd: parseFloat(openingBalanceUsd.toFixed(2)),
      transactions: formattedTxns,
      type_counts: typeCounts,
      total_debit: parseFloat(totalDebit.toFixed(2)),
      total_credit: parseFloat(totalCredit.toFixed(2)),
      closing_balance: parseFloat(runningBalance.toFixed(2)),
      closing_balance_usd: parseFloat(runningBalanceUsd.toFixed(2)),
      open_items: openItems,
    };
  },

  /**
   * Invoice ↔ payment allocation ledger (the LedgerReport.pdf format): every
   * invoice with the payments applied to it + its outstanding, plus a footer of
   * totals & counts. Customer invoices = local sales (payments by local_sale_id);
   * supplier invoices = payables (payments by linked_payable_id).
   */
  async getPartyAllocation(partyType, partyId) {
    const id = parseInt(partyId);
    const num = (v) => parseFloat(v) || 0;
    const isCustomer = partyType === 'customer';

    let partyName = '';
    let invoiceRows = [];   // { id, ref, supplierRef, date, particulars, notes, amount }
    let payRows = [];       // { ref, date, amount, method, reference, invId }

    if (isCustomer) {
      const cust = await db('customers').where({ id }).first();
      partyName = cust ? cust.name : '';
      const sales = await db('local_sales')
        .where(function () {
          this.where('customer_id', id);
          if (cust && cust.name) this.orWhere(function () { this.whereNull('customer_id').whereRaw('LOWER(buyer_name) = LOWER(?)', [cust.name]); });
        })
        .orderBy('created_at')
        .select('id', 'sale_no', 'total_amount', 'created_at', 'item_name', 'quantity_kg', 'collection_location', 'notes');
      invoiceRows = sales.map((s) => ({
        id: s.id, ref: s.sale_no, supplierRef: null, date: s.created_at,
        particulars: [s.item_name, num(s.quantity_kg) > 0 ? `${Math.round(num(s.quantity_kg)).toLocaleString()} kg` : '', s.collection_location].filter(Boolean).join(' · '),
        notes: s.notes || null, amount: num(s.total_amount),
      }));
      const saleIds = sales.map((s) => s.id);
      // Don't count an uncleared post-dated cheque as paid — money hasn't moved
      // until it clears (cash/bank/online settle immediately).
      const pays = saleIds.length ? await db('payments').whereIn('local_sale_id', saleIds)
        .where((qb) => qb.whereNot('payment_method', 'cheque').orWhere('cleared', true))
        .orderBy('payment_date')
        .select('payment_no', 'amount', 'payment_date', 'payment_method', 'bank_reference', 'local_sale_id') : [];
      payRows = pays.map((p) => ({ ref: p.payment_no, date: p.payment_date, amount: num(p.amount), method: p.payment_method, reference: p.bank_reference || null, invId: p.local_sale_id }));
    } else {
      const sup = await db('suppliers').where({ id }).first();
      partyName = sup ? sup.name : '';
      const payables = await db('payables').where({ supplier_id: id }).orderBy('created_at')
        .select('id', 'pay_no', 'linked_ref', 'category', 'original_amount', 'created_at', 'due_date', 'notes');
      invoiceRows = payables.map((p) => ({
        id: p.id, ref: p.linked_ref || p.pay_no, supplierRef: p.linked_ref || null, date: p.created_at || p.due_date,
        particulars: p.category || '', notes: p.notes || null, amount: num(p.original_amount),
      }));
      const payIds = payables.map((p) => p.id);
      // Skip uncleared post-dated cheques — they haven't settled the bill yet.
      const pays = payIds.length ? await db('payments').whereIn('linked_payable_id', payIds)
        .where((qb) => qb.whereNot('payment_method', 'cheque').orWhere('cleared', true))
        .orderBy('payment_date')
        .select('payment_no', 'amount', 'payment_date', 'payment_method', 'bank_reference', 'linked_payable_id') : [];
      payRows = pays.map((p) => ({ ref: p.payment_no, date: p.payment_date, amount: num(p.amount), method: p.payment_method, reference: p.bank_reference || null, invId: p.linked_payable_id }));
    }

    const paysByInv = {};
    payRows.forEach((p) => { (paysByInv[p.invId] ||= []).push(p); });

    const invoices = invoiceRows.map((inv) => {
      const ps = (paysByInv[inv.id] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      const paid = ps.reduce((s, p) => s + p.amount, 0);
      const outstanding = Math.max(0, inv.amount - paid);
      return {
        ref: inv.ref, supplier_ref: inv.supplierRef, date: inv.date, particulars: inv.particulars, notes: inv.notes,
        amount: parseFloat(inv.amount.toFixed(2)), paid: parseFloat(paid.toFixed(2)), outstanding: parseFloat(outstanding.toFixed(2)),
        status: outstanding <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid'),
        payments: ps.map((p) => ({ ref: p.ref, date: p.date, amount: parseFloat(p.amount.toFixed(2)), method: p.method, reference: p.reference })),
      };
    });

    const totals = {
      billed: parseFloat(invoices.reduce((s, i) => s + i.amount, 0).toFixed(2)),
      paid: parseFloat(invoices.reduce((s, i) => s + i.paid, 0).toFixed(2)),
      outstanding: parseFloat(invoices.reduce((s, i) => s + i.outstanding, 0).toFixed(2)),
    };
    return {
      party_type: partyType, name: partyName, currency: 'PKR',
      invoices, totals,
      counts: { invoices: invoices.length, payments: payRows.length },
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
