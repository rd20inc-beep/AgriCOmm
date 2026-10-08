const db = require('../../config/database');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const accountingService = require('../accounting/accounting.service');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { pendingChequeTotal, round2 } = require('../finance/paymentSettlement');
const { recordMoneyMovement } = require('../finance/paymentEngine');
const { postProcessingDelta } = require('../milling/millingCompletionJournal');

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
    // Paying at create goes through the payment engine once the expense and
    // its payable exist (a cheque records but settles nothing until it clears).
    const rate = Number(fx_rate) || (currency === 'PKR' ? 1 : 280);
    const amountPkr = currency === 'PKR' ? amountNum : Number((amountNum * rate).toFixed(2));

    // Run inside a caller-supplied transaction when given, so the expense +
    // cash-out + GL commit atomically with the caller's own work (e.g. payroll
    // pay marking lines paid). Otherwise open our own.
    const run = async (trx) => {
      const expenseNo = await generateExpenseNo(trx);

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
        // Unpaid until a payment settles it (pay-now settles it below, through
        // the same engine as every other payment).
        payment_status: 'Pending',
        paid_amount: 0,
        bank_account_id: null,
        paid_date: null,
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
        paid_amount: 0,
        outstanding: amountPkr,
        currency: 'PKR',
        due_date: due_date || expense_date,
        status: 'Pending',
        source_table: 'business_expenses',
        source_id: expense.id,
        payable_type: 'expense',
        notes: description || null,
      }).returning('*');

      // ─── If paid now: the payment engine records the payment (stamped with
      // this expense), moves the account with its bank_transactions row, posts
      // Dr 2010 (2040 for salaries) / Cr 1000 and settles the payable and the
      // expense — exactly what paying it later does. A cheque records only.
      if (pay_now) {
        const payDate = (expense_date instanceof Date ? expense_date.toISOString().slice(0, 10) : expense_date) || new Date().toISOString().split('T')[0];
        await recordMoneyMovement(trx, {
          type: 'payment',
          payable: payableRow,
          source: { table: 'business_expenses', id: expense.id },
          amount: amountPkr,
          currency: 'PKR', // expenses are paid in PKR
          method: normalizePaymentMethod(payment_method),
          bankAccountId: bank_account_id || null,
          accountEntity: expense_type || 'general',
          paymentDate: payDate,
          dueDate: due_date ? (due_date instanceof Date ? due_date.toISOString().slice(0, 10) : due_date) : null,
          bankReference: payment_reference || null,
          notes: `Payment for ${expenseNo}`,
          userId: userId || null,
          checkOutstanding: false,
          bt: {
            source: category === 'salaries' ? 'salaries' : 'expense',
            category: category || 'expense',
            counterparty: vendorLabel,
            notes: `Payment for ${expenseNo}`,
          },
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

      // A mill expense booked against a batch whose completion is already on
      // the books joins its cost sheet above; capitalise it into the batch's
      // finished stock now — Dr 1220 / Cr the expense account it was charged
      // to (A3b). Before the completion, the completion absorbs it.
      if (batch_id && expense_type === 'mill') {
        const batch = await trx('milling_batches').where({ id: batch_id }).first();
        if (batch) {
          await postProcessingDelta(trx, accountingService, {
            batch, delta: amountPkr, label: `${category || 'expense'} (${expenseNo})`, userId,
            counterCode: salaryDebitAccountId ? '6135' : '6000',
          });
        }
      }

      return pay_now ? trx('business_expenses').where('id', expense.id).first() : expense;
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
      // The payment engine records the installment (stamped with this
      // expense), moves the account (cash with none picked → the paying
      // entity's cash float) with its bank_transactions row, posts Dr 2010
      // (2040 for salaries) / Cr 1000 and settles the payable and the expense.
      // A cheque records only; Clear Cheque settles it.
      await recordMoneyMovement(trx, {
        type: 'payment',
        payable: payable || null,
        source: { table: 'business_expenses', id: expense.id },
        amount: payAmt,
        currency: 'PKR', // expenses are paid in PKR
        method: normalizePaymentMethod(payment_method),
        bankAccountId: bank_account_id || null,
        accountEntity: expense.expense_type || 'general',
        paymentDate: payDate,
        dueDate: due_date ? (due_date instanceof Date ? due_date.toISOString().slice(0, 10) : due_date) : null,
        bankReference: payment_reference || null,
        notes: notes || `Payment for ${expense.expense_no}`,
        userId: userId || null,
        checkOutstanding: false, // capped above, net of uncleared cheques
        bt: {
          source: expense.category === 'salaries' ? 'salaries' : 'expense',
          category: expense.category || 'expense',
          counterparty: expense.vendor_name || null,
          notes: notes || `Payment for ${expense.expense_no}`,
        },
      });
      return trx('business_expenses').where('id', id).first();
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
