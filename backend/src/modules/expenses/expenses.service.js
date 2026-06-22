const db = require('../../config/database');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const accountingService = require('../accounting/accounting.service');

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
  async create(data, userId) {
    const {
      expense_type, category, subcategory, amount, currency, fx_rate,
      supplier_id, vendor_name, expense_date, due_date, invoice_reference,
      description, notes, batch_id, order_id,
      pay_now, bank_account_id, payment_method, payment_reference,
    } = data;

    if (!amount || Number(amount) <= 0) throw new ValidationError('Amount must be positive.');
    if (!expense_date) throw new ValidationError('Expense date is required.');

    const amountNum = Number(amount);
    const rate = Number(fx_rate) || (currency === 'PKR' ? 1 : 280);
    const amountPkr = currency === 'PKR' ? amountNum : Number((amountNum * rate).toFixed(2));

    return db.transaction(async (trx) => {
      const expenseNo = await generateExpenseNo(trx);

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
        payment_status: pay_now ? 'Paid' : 'Pending',
        bank_account_id: pay_now ? (bank_account_id || null) : null,
        paid_date: pay_now ? expense_date : null,
        payment_method: pay_now ? (payment_method || 'bank') : null,
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
      await trx('payables').insert({
        pay_no: payNo,
        entity: expense_type === 'mill' ? 'mill' : expense_type === 'export' ? 'export' : 'general',
        category: category || 'miscellaneous',
        supplier_id: supplier_id || null,
        linked_ref: vendorLabel,
        original_amount: amountPkr,
        paid_amount: pay_now ? amountPkr : 0,
        outstanding: pay_now ? 0 : amountPkr,
        currency: 'PKR',
        due_date: due_date || expense_date,
        status: pay_now ? 'Paid' : 'Pending',
        source_table: 'business_expenses',
        source_id: expense.id,
        payable_type: 'expense',
        notes: description || null,
      });

      // ─── If paid now, update bank balance ───
      if (pay_now && bank_account_id) {
        await trx('bank_accounts').where('id', bank_account_id).update({
          current_balance: trx.raw('current_balance - ?', [amountPkr]),
          updated_at: trx.fn.now(),
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
        });
      } catch (e) {
        console.warn('Expense journal post failed:', e.message);
      }

      return expense;
    });
  },

  async list({ expense_type, category, payment_status, from_date, to_date, limit = 50, offset = 0 } = {}) {
    const q = db('business_expenses as e')
      .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .leftJoin('milling_batches as mb', 'mb.id', 'e.batch_id')
      .leftJoin('export_orders as eo', 'eo.id', 'e.order_id')
      .leftJoin('bank_accounts as ba', 'ba.id', 'e.bank_account_id')
      .select(
        'e.*',
        's.name as supplier_name_joined',
        'u.full_name as created_by_name',
        'mb.batch_no',
        'eo.order_no',
        'ba.name as bank_name',
        'ba.type as bank_type'
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
      .select('e.*', 's.name as supplier_name_joined', 'u.full_name as created_by_name', 'ba.name as bank_name')
      .where('e.id', id)
      .first();
    if (!row) throw new NotFoundError('Expense not found.');
    return row;
  },

  async markPaid(id, { bank_account_id, payment_method, payment_reference, paid_date, due_date }, userId) {
    const expense = await db('business_expenses').where('id', id).first();
    if (!expense) throw new NotFoundError('Expense not found.');
    if (expense.payment_status === 'Paid') throw new ValidationError('Already paid.');

    const payDate = paid_date || new Date().toISOString().split('T')[0];
    // A post-dated cheque records but does NOT mark the expense paid until it
    // clears — insert the uncleared payment and stop.
    const isPostDated = payment_method === 'cheque' && due_date && new Date(due_date) > new Date(new Date().toDateString());
    if (isPostDated) {
      return db.transaction(async (trx) => {
        const payable = await trx('payables').where({ source_table: 'business_expenses', source_id: id }).first();
        const payCount = await trx('payments').count('id as c').first();
        await trx('payments').insert({
          payment_no: `EXP-PAY-${(parseInt(payCount?.c) || 0) + 1}`,
          type: 'payment', amount: expense.amount_pkr, currency: 'PKR', fx_rate: 1, base_amount_pkr: expense.amount_pkr,
          payment_method, bank_account_id: bank_account_id || null, bank_reference: payment_reference || null,
          due_date: due_date || null, cleared: false,
          linked_payable_id: payable ? payable.id : null,
          source_table: 'business_expenses', source_id: parseInt(id, 10), payment_date: payDate,
          notes: `Pending cheque for ${expense.expense_no}`, created_by: userId || null,
        });
        return expense;
      });
    }
    return db.transaction(async (trx) => {
      const [updated] = await trx('business_expenses').where('id', id).update({
        payment_status: 'Paid',
        bank_account_id: bank_account_id || null,
        payment_method: payment_method || 'bank',
        payment_reference: payment_reference || null,
        paid_date: payDate,
        updated_at: trx.fn.now(),
      }).returning('*');

      // Update payable
      const payable = await trx('payables').where({ source_table: 'business_expenses', source_id: id }).first();
      if (payable) {
        await trx('payables').where({ id: payable.id }).update({ paid_amount: expense.amount_pkr, outstanding: 0, status: 'Paid' });
      }

      // Canonical payment row (so the payment-trail + dashboard cheque view see it).
      const payCount = await trx('payments').count('id as c').first();
      await trx('payments').insert({
        payment_no: `EXP-PAY-${(parseInt(payCount?.c) || 0) + 1}`,
        type: 'payment', amount: expense.amount_pkr, currency: 'PKR', fx_rate: 1, base_amount_pkr: expense.amount_pkr,
        payment_method: payment_method || 'bank', bank_account_id: bank_account_id || null,
        bank_reference: payment_reference || null, due_date: due_date || null,
        linked_payable_id: payable ? payable.id : null,
        payment_date: payDate, notes: `Payment for ${expense.expense_no}`, created_by: userId || null,
      });

      // Debit bank
      if (bank_account_id) {
        await trx('bank_accounts').where('id', bank_account_id).update({
          current_balance: trx.raw('current_balance - ?', [expense.amount_pkr]),
          updated_at: trx.fn.now(),
        });
      }

      return updated;
    });
  },

  async getSummary() {
    const [totals, byType, byCategory, unpaid] = await Promise.all([
      db('business_expenses')
        .select(db.raw('COUNT(*) as count, COALESCE(SUM(amount_pkr),0) as total_pkr'))
        .first(),
      db('business_expenses')
        .select('expense_type')
        .count({ count: 'id' })
        .sum({ total_pkr: 'amount_pkr' })
        .groupBy('expense_type'),
      db('business_expenses')
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
