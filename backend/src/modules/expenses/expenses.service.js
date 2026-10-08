const db = require('../../config/database');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const { nextDocNo } = require('../../utils/docNumber');
const accountingService = require('../accounting/accounting.service');
const { resolveCashAccountId } = require('../../shared/cashAccounts');
const { assertAccountCurrency } = require('../../shared/accountCurrency');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const { pendingChequeTotal, round2, isCheque } = require('../finance/paymentSettlement');

// Settlement journal posted when an expense is PAID: DR Supplier Payable (2010)
// CR Cash & Bank (1000). The obligation was booked at create (CR 2010 via the
// expense_recorded rule); this clears it and lands the cash/bank outflow on the
// GL — mirroring finance recordPayment for Money In/Out. Cash payments (no bank
// account) still credit the 1000 control account. A journal failure (closed
// period, unbalanced, missing account) is rethrown so the caller's transaction
// rolls the payment back with it: a payment with no journal is a gap in the
// books, and a database error here has already aborted the transaction anyway.
// Returns nothing.
async function postExpenseSettlement(trx, { expense, paymentNo, payDate, userId }) {
  try {
    // Settle against the SAME payable the accrual credited: salaries credit
    // 2040 Salaries Payable, everything else credits 2010 Supplier Payable. The
    // settlement must debit that account back or the payable never clears.
    const payableCode = expense.category === 'salaries' ? '2040' : '2010';
    let [ap, cash] = await Promise.all([
      trx('chart_of_accounts').where({ code: payableCode }).first(),
      trx('chart_of_accounts').where({ code: '1000' }).first(),
    ]);
    // Fall back to Supplier Payable if the dedicated account is missing (older DB).
    if (!ap && payableCode !== '2010') ap = await trx('chart_of_accounts').where({ code: '2010' }).first();
    if (!ap || !cash) throw missingAccounts([payableCode, '1000']);
    const amt = parseFloat(expense.amount_pkr) || 0;
    if (amt <= 0) return;
    const entity = expense.expense_type === 'mill' ? 'mill' : expense.expense_type === 'export' ? 'export' : 'general';
    const journal = await accountingService.createJournal(trx, {
      date: payDate,
      entity,
      refType: 'Payment',
      refNo: paymentNo,
      description: `Payment ${paymentNo} for ${expense.expense_no}`,
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType: expense.supplier_id ? 'supplier' : null,
      partyId: expense.supplier_id || null,
      lines: [
        { account_id: ap.id, account: ap.name, debit: amt, credit: 0, narration: `DR ${ap.code} ${ap.name} — ${paymentNo}` },
        { account_id: cash.id, account: cash.name, debit: 0, credit: amt, narration: `CR ${cash.code} ${cash.name} — ${paymentNo}` },
      ],
    });
    if (journal?.id) await accountingService.postJournal(trx, journal.id);
  } catch (e) {
    throw ledgerFailure(e);
  }
}

const CATEGORY_MAP = {
  general: [
    'utility_bill', 'rent', 'insurance', 'license', 'professional_fees',
    'office_supplies', 'bank_charges', 'inspection', 'miscellaneous',
  ],
  mill: [
    'electricity', 'diesel', 'maintenance', 'labor', 'inspection',
    'fumigation', 'salaries', 'transport', 'rent', 'insurance', 'miscellaneous',
  ],
  export: [
    'clearing', 'freight', 'inspection', 'insurance', 'commission',
    'documentation', 'bags', 'transport', 'miscellaneous',
  ],
};

async function generateExpenseNo(trx) {
  const year = new Date().getFullYear();
  const prefix = `EXP-${year}-`;
  const last = await trx('business_expenses')
    .where('expense_no', 'like', `${prefix}%`)
    .orderBy('id', 'desc')
    .select('expense_no')
    .first();
  let seq = 1;
  if (last?.expense_no) {
    const n = parseInt(last.expense_no.replace(prefix, ''), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

const expensesService = {
  async create(data, userId, existingTrx = null) {
    const {
      expense_type, category, subcategory, amount, currency, fx_rate,
      supplier_id, vendor_name, expense_date, due_date, invoice_reference,
      description, notes, batch_id, order_id,
      pay_now, bank_account_id, payment_method, payment_reference,
      employee_id, is_recurring, recurrence,
    } = data;

    if (!amount || Number(amount) <= 0) throw new ValidationError('Amount must be positive.');
    if (!expense_date) throw new ValidationError('Expense date is required.');

    const amountNum = Number(amount);
    // Paying by cheque at create records the cheque but settles nothing: the
    // expense stays unpaid until the cheque clears in Due Dates.
    const payByCheque = !!pay_now && isCheque(payment_method);
    const settledNow = !!pay_now && !payByCheque;
    const rate = Number(fx_rate) || (currency === 'PKR' ? 1 : 280);
    const amountPkr = currency === 'PKR' ? amountNum : Number((amountNum * rate).toFixed(2));

    // Run inside a caller-supplied transaction when given, so the expense +
    // cash-out + GL commit atomically with the caller's own work (e.g. payroll
    // pay marking lines paid). Otherwise open our own.
    const run = async (trx) => {
      const expenseNo = await generateExpenseNo(trx);

      // For a cash payment with no explicit account, draw from the paying entity's
      // cash float: the Mill's cash (Mill Cash) for mill expenses, Office Petty Cash
      // for Head Office / general — so each entity's cash balance stays accurate.
      let resolvedAccountId = bank_account_id || null;
      if (pay_now && !resolvedAccountId && payment_method === 'cash') {
        resolvedAccountId = await resolveCashAccountId(trx, { entity: expense_type || 'general' });
      }

      // Route salaries to dedicated GL accounts (Phase 9/10): DR 6135 Salaries &
      // Wages (instead of generic 6000) and CR 2040 Salaries Payable (instead of
      // generic 2010 Supplier Payable). Either falls back to the rule default if
      // the account is missing on an older DB.
      let salaryDebitAccountId = null;
      let salaryCreditAccountId = null;
      if (category === 'salaries') {
        const [salDr, salCr] = await Promise.all([
          trx('chart_of_accounts').where('code', '6135').first(),
          trx('chart_of_accounts').where('code', '2040').first(),
        ]);
        if (salDr) salaryDebitAccountId = salDr.id;
        if (salCr) salaryCreditAccountId = salCr.id;
      }

      const [expense] = await trx('business_expenses').insert({
        expense_no: expenseNo,
        expense_type: expense_type || 'general',
        category,
        subcategory: subcategory || null,
        amount: amountNum,
        currency: currency || 'PKR',
        fx_rate: rate,
        amount_pkr: amountPkr,
        supplier_id: supplier_id || null,
        vendor_name: vendor_name || null,
        expense_date,
        due_date: due_date || null,
        invoice_reference: invoice_reference || null,
        description: description || null,
        notes: notes || null,
        batch_id: batch_id || null,
        order_id: order_id || null,
        employee_id: employee_id || null,
        is_recurring: !!is_recurring,
        recurrence: is_recurring ? (recurrence || 'monthly') : null,
        payment_status: settledNow ? 'Paid' : 'Pending',
        // Same figure the payable records, so the two never disagree.
        paid_amount: settledNow ? amountPkr : 0,
        bank_account_id: settledNow ? resolvedAccountId : null,
        paid_date: settledNow ? expense_date : null,
        payment_method: pay_now ? normalizePaymentMethod(payment_method) : null,
        payment_reference: pay_now ? (payment_reference || null) : null,
        created_by: userId,
      }).returning('*');

      // ─── Link to batch costs if mill ───
      if (batch_id && expense_type === 'mill') {
        const costCat = category || 'miscellaneous';
        const existing = await trx('milling_costs')
          .where({ batch_id, category: costCat })
          .first();
        if (existing) {
          await trx('milling_costs').where('id', existing.id).update({
            amount: trx.raw('amount + ?', [amountPkr]),
            notes: `Updated via business expense ${expenseNo}`,
            updated_at: trx.fn.now(),
          });
        } else {
          await trx('milling_costs').insert({
            batch_id, category: costCat, amount: amountPkr,
            currency: 'PKR', notes: `From business expense ${expenseNo}`,
          });
        }
      }

      // ─── Link to order costs if export ───
      if (order_id && expense_type === 'export') {
        // Per the PKR-only outflow rule (migration 079), every row in
        // export_order_costs is stored in PKR — no FX conversion is
        // applied at write or read time. Whatever the user entered in
        // PKR goes straight in. (Foreign-currency expenses get
        // converted to PKR via amount_pkr at the top of this method.)
        await trx('export_order_costs').insert({
          order_id,
          category: category || 'miscellaneous',
          amount: amountPkr,
          currency: 'PKR',
          fx_rate: 1,
          base_amount_pkr: amountPkr,
          notes: `From business expense ${expenseNo}`,
        });
      }

      // ─── Create payable row ───
      // payables schema: entity, category, supplier_id, linked_ref, original_amount,
      // paid_amount, outstanding, due_date, status, currency, source_table, source_id, payable_type
      const vendorLabel = vendor_name || (supplier_id ? (await trx('suppliers').where('id', supplier_id).first())?.name : null) || 'Vendor';
      // Generate a pay_no so the row shows as e.g. PAY-EXP0042 on the
      // Money Out tab (rather than a blank Ref column).
      const lastPay = await trx('payables')
        .where('pay_no', 'like', 'PAY-EXP%')
        .orderBy('id', 'desc').first();
      const nextSeq = lastPay
        ? (parseInt(String(lastPay.pay_no).replace(/^PAY-EXP/, ''), 10) || 0) + 1
        : 1;
      const payNo = `PAY-EXP${String(nextSeq).padStart(4, '0')}`;
      const [payableRow] = await trx('payables').insert({
        pay_no: payNo,
        entity: expense_type === 'mill' ? 'mill' : expense_type === 'export' ? 'export' : 'general',
        category: category || 'miscellaneous',
        supplier_id: supplier_id || null,
        linked_ref: vendorLabel,
        original_amount: amountPkr,
        paid_amount: settledNow ? amountPkr : 0,
        outstanding: settledNow ? 0 : amountPkr,
        currency: 'PKR',
        due_date: due_date || expense_date,
        status: settledNow ? 'Paid' : 'Pending',
        source_table: 'business_expenses',
        source_id: expense.id,
        payable_type: 'expense',
        notes: description || null,
      }).returning('id');

      // ─── If paid now: record the payment row, debit the bank, and post the
      // settlement journal — so a pay-at-create expense is fully consistent
      // with the pay-later (markPaid) flow (payment trail + GL both move). ───
      if (payByCheque) {
        const payDate = (expense_date instanceof Date ? expense_date.toISOString().slice(0, 10) : expense_date) || new Date().toISOString().split('T')[0];
        const clearsOn = due_date ? (due_date instanceof Date ? due_date.toISOString().slice(0, 10) : due_date) : payDate;
        await trx('payments').insert({
          payment_no: await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'EXP-PAY-', pad: 0 }),
          type: 'payment', amount: amountPkr, currency: 'PKR', fx_rate: 1, base_amount_pkr: amountPkr,
          payment_method: 'cheque', bank_account_id: bank_account_id || null,
          bank_reference: payment_reference || null, due_date: clearsOn, cleared: false,
          linked_payable_id: payableRow?.id || null,
          source_table: 'business_expenses', source_id: expense.id,
          payment_date: payDate, notes: `Pending cheque for ${expenseNo}`, created_by: userId || null,
        });
      } else if (pay_now) {
        const payDate = (expense_date instanceof Date ? expense_date.toISOString().slice(0, 10) : expense_date) || new Date().toISOString().split('T')[0];
        const paymentNo = await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'EXP-PAY-', pad: 0 });
        // Canonical on BOTH columns. This used to normalise only the payments
        // row, leaving business_expenses holding 'bank' for the same payment.
        // (cash/bank_transfer/cheque/...); the UI shorthand 'bank' maps to
        // 'bank_transfer' so a bank-paid expense doesn't violate the CHECK.
        const payMethod = normalizePaymentMethod(payment_method);
        // Expenses are paid in PKR — a non-PKR account cannot be moved by it.
        if (resolvedAccountId) assertAccountCurrency(await trx('bank_accounts').where('id', resolvedAccountId).first(), 'PKR');
        await trx('payments').insert({
          payment_no: paymentNo,
          type: 'payment', amount: amountPkr, currency: 'PKR', fx_rate: 1, base_amount_pkr: amountPkr,
          payment_method: payMethod, bank_account_id: resolvedAccountId,
          bank_reference: payment_reference || null,
          linked_payable_id: payableRow?.id || null,
          payment_date: payDate, notes: `Payment for ${expenseNo}`, created_by: userId || null,
        });
        if (resolvedAccountId) {
          await trx('bank_accounts').where('id', resolvedAccountId).update({
            current_balance: trx.raw('current_balance - ?', [amountPkr]),
            updated_at: trx.fn.now(),
          });
          // Record the cash/bank outflow on the account's transaction ledger so
          // the Bank/Cash statement shows the payout (mirrors the receipt side
          // in localSales.postReceiptToAccount).
          // A failed insert aborts the transaction, so it is not swallowed:
          // carrying on would report success for a payment COMMIT discards.
          const acct = await trx('bank_accounts').where('id', resolvedAccountId).first();
          const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-' });
          const paymentRow = await trx('payments').where('payment_no', paymentNo).first();
          await trx('bank_transactions').insert({
            transaction_no: btNo,
            bank_account_id: resolvedAccountId,
            type: 'debit',
            amount: amountPkr,
            currency: 'PKR',
            status: 'posted',
            transaction_date: payDate,
            reference: paymentNo,
            notes: `Payment for ${expenseNo}`,
            source: category === 'salaries' ? 'salaries' : 'expense',
            linked_payment_id: paymentRow?.id || null,
            running_balance: acct ? acct.current_balance : null,
            category: category || 'expense',
            counterparty: vendorLabel,
            created_by: userId || null,
          });
        }
        await postExpenseSettlement(trx, {
          expense: { amount_pkr: amountPkr, supplier_id, expense_type, expense_no: expenseNo, category },
          paymentNo, payDate, userId,
        });
      }

      // ─── Auto-post journal entry ───
      // expense_recorded rule: DR Operating Expenses, CR Supplier Payable.
      // Wrapped in try/catch so accounting failures never block the
      // user-facing expense save (matches the pattern in other flows).
      try {
        await accountingService.autoPost(trx, {
          triggerEvent: 'expense_recorded',
          entity: expense_type === 'mill' ? 'mill' : expense_type === 'export' ? 'export' : 'general',
          amount: amountPkr,
          currency: 'PKR',
          refType: 'Business Expense',
          refNo: expenseNo,
          description: `${vendorLabel}: ${(category || 'expense').replace(/_/g, ' ')} — ${description || 'no description'}`.slice(0, 240),
          userId,
          partyType: supplier_id ? 'supplier' : null,
          partyId: supplier_id || null,
          debitAccountId: salaryDebitAccountId,
          creditAccountId: salaryCreditAccountId,
        });
      } catch (e) {
        console.warn('Expense journal post failed:', e.message);
      }

      return expense;
    };

    return existingTrx ? run(existingTrx) : db.transaction(run);
  },

  async list({ expense_type, category, payment_status, from_date, to_date, limit = 50, offset = 0 } = {}) {
    const q = db('business_expenses as e')
      .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .leftJoin('milling_batches as mb', 'mb.id', 'e.batch_id')
      .leftJoin('export_orders as eo', 'eo.id', 'e.order_id')
      .leftJoin('bank_accounts as ba', 'ba.id', 'e.bank_account_id')
      // The payable carries running paid/outstanding for partial payments.
      .leftJoin('payables as pe', function () {
        this.on('pe.source_id', '=', 'e.id').andOnVal('pe.source_table', '=', 'business_expenses');
      })
      .select(
        'e.*',
        's.name as supplier_name_joined',
        'u.full_name as created_by_name',
        'mb.batch_no',
        'eo.order_no',
        'ba.name as bank_name',
        'ba.type as bank_type',
        'pe.paid_amount as paid_pkr',
        'pe.outstanding as outstanding_pkr'
      );

    if (expense_type) q.where('e.expense_type', expense_type);
    if (category) q.where('e.category', category);
    if (payment_status) q.where('e.payment_status', payment_status);
    if (from_date) q.where('e.expense_date', '>=', from_date);
    if (to_date) q.where('e.expense_date', '<=', to_date);

    const [items, totalRow] = await Promise.all([
      q.clone().orderBy('e.expense_date', 'desc').orderBy('e.id', 'desc').limit(limit).offset(offset),
      q.clone().clearSelect().clearOrder().count({ c: 'e.id' }).first(),
    ]);
    return { items, total: Number(totalRow?.c || 0) };
  },

  async getById(id) {
    const row = await db('business_expenses as e')
      .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .leftJoin('bank_accounts as ba', 'ba.id', 'e.bank_account_id')
      .leftJoin('payables as pe', function () {
        this.on('pe.source_id', '=', 'e.id').andOnVal('pe.source_table', '=', 'business_expenses');
      })
      .select('e.*', 's.name as supplier_name_joined', 'u.full_name as created_by_name', 'ba.name as bank_name',
        'pe.paid_amount as paid_pkr', 'pe.outstanding as outstanding_pkr')
      .where('e.id', id)
      .first();
    if (!row) throw new NotFoundError('Expense not found.');
    return row;
  },

  /**
   * Attach a supplier to an expense that was recorded without one.
   *
   * Both supplier-kind categories were mapped to expense_vendors presets, and
   * the preset list overrode the supplier picker — so every expense ever written
   * carries supplier_id NULL and none of them appear on a supplier's statement.
   * The form is fixed; this is how the ones already recorded get attached.
   *
   * It writes the link everywhere the ledger reads: the expense row, its payable,
   * AND the party stamp on its posted journals — so a linked expense is identical
   * to one created with a supplier from the start.
   *
   * Stamping the journals is NOT optional. Leaving them unstamped makes the
   * statement take the bill from the synthesized payable, which carries the
   * payment too — while the PAYMENT journal is stamped at pay time and
   * contributes the same payment again. A paid expense then read as a CREDIT
   * balance (Rs -221,000 on a settled Rs 221,000 bill). With the journals
   * stamped the payable is recognised as already represented and synthesizes
   * nothing, so each figure appears exactly once.
   *
   * Only the party columns are touched — no amount, account or date moves, so
   * the trial balance is untouched.
   *
   * Reversible: passing null unlinks it and clears the stamps.
   */
  async linkSupplier(id, supplierId, userId) {
    const expense = await db('business_expenses').where('id', id).first();
    if (!expense) throw new NotFoundError('Expense not found.');

    let supplier = null;
    if (supplierId) {
      supplier = await db('suppliers').where('id', supplierId).first('id', 'name');
      if (!supplier) throw new ValidationError('Supplier not found.');
    }

    return db.transaction(async (trx) => {
      await trx('business_expenses').where('id', id).update({
        supplier_id: supplier ? supplier.id : null,
        // The typed payee is kept when there was one — it is what was written on
        // the bill — and only filled from the supplier when it was blank.
        vendor_name: expense.vendor_name || (supplier ? supplier.name : null),
        updated_at: trx.fn.now(),
      });

      // The payable is what the statement falls back to when there is no
      // party-stamped journal.
      const updated = await trx('payables')
        .where({ source_table: 'business_expenses', source_id: id })
        .update({
          supplier_id: supplier ? supplier.id : null,
          linked_ref: expense.vendor_name || (supplier ? supplier.name : 'Vendor'),
          updated_at: trx.fn.now(),
        });

      // The journals: this expense's own, plus every payment settled against it.
      // A payment journal is posted under its payment_no, so collect those too or
      // a payment made before the link stays invisible.
      const payable = await trx('payables')
        .where({ source_table: 'business_expenses', source_id: id }).first('id');
      const paymentNos = payable
        ? await trx('payments').where('linked_payable_id', payable.id).pluck('payment_no')
        : [];
      const refs = [expense.expense_no, ...paymentNos].filter(Boolean);
      const stamped = refs.length
        ? await trx('journal_entries').whereIn('ref_no', refs).update({
          party_type: supplier ? 'supplier' : null,
          party_id: supplier ? supplier.id : null,
          updated_at: trx.fn.now(),
        })
        : 0;

      await trx('audit_logs').insert({
        user_id: userId || null,
        action: supplier ? 'link_supplier' : 'unlink_supplier',
        entity_type: 'business_expense',
        entity_id: String(id),
        details: JSON.stringify({
          expense_no: expense.expense_no,
          supplier_id: supplier ? supplier.id : null,
          supplier_name: supplier ? supplier.name : null,
          payables_updated: updated,
          journals_stamped: stamped,
          journal_refs: refs,
        }),
      }).catch(() => { /* audit is best-effort; the link still stands */ });

      return trx('business_expenses').where('id', id).first();
    });
  },

  // `existingTrx` lets a caller (payroll settle) commit the payment atomically
  // with its own writes, as create() already allows.
  async markPaid(id, { amount, bank_account_id, payment_method, payment_reference, paid_date, due_date, notes }, userId, existingTrx = null) {
    // Joi parses paid_date into a Date; normalize to a YYYY-MM-DD string so the
    // GL journal's date math (createJournal does string ops) doesn't choke.
    const rawPayDate = paid_date || new Date().toISOString().split('T')[0];
    const payDate = rawPayDate instanceof Date ? rawPayDate.toISOString().slice(0, 10) : rawPayDate;
    // A cheque — same-day included — is not money in the bank until it clears.
    const isPostDated = isCheque(payment_method);

    const run = async (trx) => {
      // The expense and its payable are read UNDER A LOCK inside the same
      // transaction that writes them. They used to be read before it opened,
      // so two installments submitted together both saw the same remaining
      // balance, both passed the cap, and together paid more than was owed.
      const expense = await trx('business_expenses').where('id', id).forUpdate().first();
      if (!expense) throw new NotFoundError('Expense not found.');
      if (expense.payment_status === 'Paid') throw new ValidationError('Already paid.');
      const payable = await trx('payables').where({ source_table: 'business_expenses', source_id: id }).forUpdate().first();

      // Partial payments: the payable (source_table=business_expenses) tracks
      // paid_amount/outstanding. `amount` (PKR) is this installment; if omitted it
      // settles the full remaining. Capped at the outstanding — less any cheque
      // already written against it and not yet cleared — so it never overpays.
      const totalPkr = parseFloat(expense.amount_pkr) || 0;
      const alreadyPaid = payable ? (parseFloat(payable.paid_amount) || 0) : (parseFloat(expense.paid_amount) || 0);
      const pending = await pendingChequeTotal(trx, payable ? { payableId: payable.id } : { sourceTable: 'business_expenses', sourceId: expense.id });
      const remaining = Math.max(0, round2(totalPkr - alreadyPaid - pending));
      const payAmt = (amount !== undefined && amount !== null && amount !== '')
        ? parseFloat(amount)
        : remaining;
      if (!(payAmt > 0)) throw new ValidationError('Payment amount must be greater than zero.');
      if (payAmt > remaining + 0.01) {
        throw new ValidationError(`Payment (Rs ${payAmt.toFixed(2)}) exceeds the outstanding balance (Rs ${remaining.toFixed(2)}).`);
      }
      const newPaid = round2(alreadyPaid + payAmt);
      const fullyPaid = newPaid >= totalPkr - 0.01;

      // A cheque records but does NOT settle, move the bank or journal until it
      // clears — insert the uncleared payment (for this installment), carrying
      // the expense as its source, and stop. Clear Cheque does the rest.
      if (isPostDated) {
        await trx('payments').insert({
          payment_no: await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'EXP-PAY-', pad: 0 }),
          type: 'payment', amount: payAmt, currency: 'PKR', fx_rate: 1, base_amount_pkr: payAmt,
          payment_method: normalizePaymentMethod(payment_method), bank_account_id: bank_account_id || null,
          bank_reference: payment_reference || null,
          due_date: due_date || payDate, cleared: false,
          linked_payable_id: payable ? payable.id : null,
          source_table: 'business_expenses', source_id: parseInt(id, 10), payment_date: payDate,
          notes: notes || `Pending cheque for ${expense.expense_no}`, created_by: userId || null,
        });
        return expense;
      }

      // Cash with no explicit account → the paying entity's cash float (Mill Cash
      // for mill expenses, Office Petty Cash for Head Office / general).
      const acctId = bank_account_id || (payment_method === 'cash' ? await resolveCashAccountId(trx, { entity: expense.expense_type || 'general' }) : null);
      // Expenses are paid in PKR — a non-PKR account cannot be moved by it.
      if (acctId) assertAccountCurrency(await trx('bank_accounts').where('id', acctId).first(), 'PKR');
      const payMethod = normalizePaymentMethod(payment_method);
      // paid_amount moves with the payable: the Expenses tab and the Purchases
      // tab both read it, and it used to stay at 0 here while the payable said
      // the expense was part-paid.
      const [updated] = await trx('business_expenses').where('id', id).update({
        paid_amount: newPaid,
        payment_status: fullyPaid ? 'Paid' : 'Partial',
        bank_account_id: acctId,
        payment_method: payMethod,
        payment_reference: payment_reference || null,
        paid_date: payDate,
        updated_at: trx.fn.now(),
      }).returning('*');

      // Update payable — running paid/outstanding (Partial until fully settled).
      if (payable) {
        await trx('payables').where({ id: payable.id }).update({
          paid_amount: newPaid,
          outstanding: Math.max(0, round2(totalPkr - newPaid)),
          status: fullyPaid ? 'Paid' : 'Partial',
        });
      }

      // Canonical payment row for this installment.
      const paymentNo = await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'EXP-PAY-', pad: 0 });
      const [payRow] = await trx('payments').insert({
        payment_no: paymentNo,
        type: 'payment', amount: payAmt, currency: 'PKR', fx_rate: 1, base_amount_pkr: payAmt,
        payment_method: payMethod, bank_account_id: acctId,
        bank_reference: payment_reference || null, due_date: due_date || null,
        linked_payable_id: payable ? payable.id : null,
        payment_date: payDate, notes: notes || `Payment for ${expense.expense_no}`, created_by: userId || null,
      }).returning('id');

      // Debit the resolved cash/bank account for this installment + record the
      // outflow on the account's transaction ledger (mirrors create()'s pay-now).
      if (acctId) {
        await trx('bank_accounts').where('id', acctId).update({
          current_balance: trx.raw('current_balance - ?', [payAmt]),
          updated_at: trx.fn.now(),
        });
        // A failed insert aborts the transaction, so it is not swallowed:
        // carrying on would report success for a payment COMMIT discards.
        const acct = await trx('bank_accounts').where('id', acctId).first();
        const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-' });
        await trx('bank_transactions').insert({
          transaction_no: btNo,
          bank_account_id: acctId,
          type: 'debit',
          amount: payAmt,
          currency: 'PKR',
          status: 'posted',
          transaction_date: payDate,
          reference: paymentNo,
          notes: notes || `Payment for ${expense.expense_no}`,
          source: expense.category === 'salaries' ? 'salaries' : 'expense',
          linked_payment_id: payRow?.id || null,
          running_balance: acct ? acct.current_balance : null,
          category: expense.category || 'expense',
          counterparty: expense.vendor_name || null,
          created_by: userId || null,
        });
      }

      // GL settlement for this installment: DR Supplier Payable / CR Cash & Bank.
      await postExpenseSettlement(trx, { expense: { ...expense, amount_pkr: payAmt }, paymentNo, payDate, userId });

      return updated;
    };
    return existingTrx ? run(existingTrx) : db.transaction(run);
  },

  async getSummary() {
    // A Reversed expense (payroll undo / advance delete / settlement reversal)
    // stays listed for the audit trail but is not spending.
    const live = () => db('business_expenses').whereNot('payment_status', 'Reversed');
    const [totals, byType, byCategory, unpaid] = await Promise.all([
      live()
        .select(db.raw('COUNT(*) as count, COALESCE(SUM(amount_pkr),0) as total_pkr'))
        .first(),
      live()
        .select('expense_type')
        .count({ count: 'id' })
        .sum({ total_pkr: 'amount_pkr' })
        .groupBy('expense_type'),
      live()
        .select('category')
        .count({ count: 'id' })
        .sum({ total_pkr: 'amount_pkr' })
        .groupBy('category')
        .orderBy(db.raw('SUM(amount_pkr)'), 'desc')
        .limit(10),
      db('business_expenses')
        .whereIn('payment_status', ['Pending', 'Partial'])
        .select(db.raw('COUNT(*) as count, COALESCE(SUM(amount_pkr),0) as total_pkr'))
        .first(),
    ]);

    return {
      total_expenses: Number(totals?.count || 0),
      total_amount_pkr: Number(totals?.total_pkr || 0),
      unpaid_count: Number(unpaid?.count || 0),
      unpaid_amount_pkr: Number(unpaid?.total_pkr || 0),
      by_type: byType,
      by_category: byCategory,
    };
  },

  getCategories() {
    return CATEGORY_MAP;
  },
};

module.exports = expensesService;
