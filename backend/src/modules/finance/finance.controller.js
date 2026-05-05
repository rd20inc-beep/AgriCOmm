const db = require('../../config/database');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../../services/accountingService');

// Resolve a payment row to its PKR equivalent using the strongest
// signal we have: stored base_amount_pkr first, then amount × fx_rate
// when the rate is real (>1), then amount × 280 as a final fallback
// for legacy non-PKR rows missing a rate. PKR rows pass through.
function paymentToPkr(p) {
  const base = parseFloat(p.base_amount_pkr);
  if (base && base > 0) return base;
  const amount = parseFloat(p.amount) || 0;
  const cur = (p.currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return amount;
  const rate = parseFloat(p.fx_rate);
  if (rate && rate > 1) return amount * rate;
  return amount * 280;
}

async function generateTransferNo(trx) {
  const last = await (trx || db)('internal_transfers')
    .select('transfer_no')
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last.transfer_no) {
    return 'IT-001';
  }

  const num = parseInt(last.transfer_no.replace('IT-', ''), 10) || 0;
  return `IT-${String(num + 1).padStart(3, '0')}`;
}

async function generatePaymentNo(trx) {
  const last = await (trx || db)('payments')
    .select('payment_no')
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last.payment_no) {
    return 'PAY-001';
  }

  const num = parseInt(last.payment_no.replace('PAY-', ''), 10) || 0;
  return `PAY-${String(num + 1).padStart(3, '0')}`;
}

const financeController = {
  async getReceivables(req, res) {
    try {
      const { page = 1, limit = 20, status, customer_id, overdue, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('receivables as r')
        .leftJoin('customers as c', 'r.customer_id', 'c.id')
        .select(
          'r.*',
          'c.name as customer_name'
        );

      if (status) {
        query = query.where('r.status', status);
      }
      if (customer_id) {
        query = query.where('r.customer_id', customer_id);
      }
      if (overdue === 'true') {
        query = query.where('r.due_date', '<', db.fn.now()).where('r.status', '!=', 'Paid');
      }
      // Honour the global date-range filter from FinanceLayout. Filters
      // on created_at — "this month" means receivables generated this
      // month, not those falling due this month.
      if (from_date) query = query.where('r.created_at', '>=', from_date);
      if (to_date)   query = query.where('r.created_at', '<=', to_date);

      const countQuery = query.clone().clearSelect().clearOrder().count('r.id as total').first();

      const [receivables, countResult] = await Promise.all([
        query.orderBy('r.due_date', 'asc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          receivables,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get receivables error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getPayables(req, res) {
    try {
      const { page = 1, limit = 200, status, supplier_id, overdue, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Check if the payables table has data
      const payableCount = await db('payables').count('* as n').first();
      const hasPayablesTable = parseInt(payableCount?.n || 0) > 0;

      if (hasPayablesTable) {
        let query = db('payables as p')
          .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
          .select('p.*', 's.name as supplier_name')
          .where(function() {
            // Show every real money-out liability:
            //   - 'vendor'   : invoiced supplier debt (legacy)
            //   - 'expense'  : business expense awaiting payment
            //   - 'purchase' : mill-store stock purchase
            //   - NULL       : older rows seeded before the column existed
            // Internal cost allocations were the only thing previously
            // filtered, but those don't actually land in this table —
            // they live on export_order_costs / milling_costs.
            this.whereIn('p.payable_type', ['vendor', 'expense', 'purchase'])
                .orWhereNull('p.payable_type');
          });

        if (status) query = query.where('p.status', status);
        if (supplier_id) query = query.where('p.supplier_id', supplier_id);
        if (overdue === 'true') query = query.where('p.due_date', '<', db.fn.now()).where('p.status', '!=', 'Paid');
        // Honour the global date-range filter from FinanceLayout.
        if (from_date) query = query.where('p.created_at', '>=', from_date);
        if (to_date)   query = query.where('p.created_at', '<=', to_date);

        const countQuery = query.clone().clearSelect().clearOrder().count('p.id as total').first();
        const [payables, countResult] = await Promise.all([
          query.orderBy('p.due_date', 'asc').limit(parseInt(limit)).offset(offset),
          countQuery,
        ]);

        return res.json({
          success: true,
          data: {
            payables,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.total), totalPages: Math.ceil(parseInt(countResult.total) / parseInt(limit)) },
          },
        });
      }

      // Derive payables from cost tables
      const millingCosts = await db('milling_costs as mc')
        .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
        .select(
          'mc.id', 'mc.batch_id', 'mc.category', 'mc.amount', 'mc.currency',
          'mc.created_at', 'mb.batch_no', 'mb.supplier_name',
        )
        .where('mc.amount', '>', 0)
        .orderBy('mc.created_at', 'desc');

      const exportCosts = await db('export_order_costs as eoc')
        .join('export_orders as eo', 'eoc.order_id', 'eo.id')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .select(
          'eoc.id', 'eoc.order_id', 'eoc.category', 'eoc.amount',
          'eoc.created_at', 'eo.order_no', 'c.name as customer_name',
        )
        .where('eoc.amount', '>', 0)
        .orderBy('eoc.created_at', 'desc');

      const millExpenses = await db('mill_expenses')
        .where('amount', '>', 0)
        .select('*')
        .orderBy('expense_date', 'desc');

      // Map to payable-shaped rows
      const derived = [];

      const categoryLabel = (cat) => {
        const map = { raw_rice: 'Raw Rice', transport: 'Transport', electricity: 'Electricity', rent: 'Rent', labor: 'Labor', maintenance: 'Maintenance' };
        return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
      };

      millingCosts.forEach(mc => {
        derived.push({
          id: `MC-${mc.id}`,
          pay_no: `MC-${mc.id}`,
          entity: 'mill',
          category: categoryLabel(mc.category),
          supplier_name: mc.supplier_name || null,
          linked_ref: mc.batch_no,
          original_amount: parseFloat(mc.amount),
          paid_amount: 0,
          outstanding: parseFloat(mc.amount),
          due_date: mc.created_at,
          status: 'Pending',
          currency: mc.currency || 'PKR',
          aging: 0,
          notes: `${categoryLabel(mc.category)} cost for batch ${mc.batch_no}`,
          created_at: mc.created_at,
          source: 'milling_costs',
        });
      });

      exportCosts.forEach(ec => {
        derived.push({
          id: `EC-${ec.id}`,
          pay_no: `EC-${ec.id}`,
          entity: 'export',
          category: categoryLabel(ec.category),
          supplier_name: ec.customer_name || null,
          linked_ref: ec.order_no,
          original_amount: parseFloat(ec.amount),
          paid_amount: 0,
          outstanding: parseFloat(ec.amount),
          due_date: ec.created_at,
          status: 'Pending',
          currency: 'USD',
          aging: 0,
          notes: `${categoryLabel(ec.category)} cost for order ${ec.order_no}`,
          created_at: ec.created_at,
          source: 'export_order_costs',
        });
      });

      millExpenses.forEach(me => {
        derived.push({
          id: `ME-${me.id}`,
          pay_no: `ME-${me.id}`,
          entity: 'mill',
          category: categoryLabel(me.category || 'overhead'),
          supplier_name: null,
          linked_ref: null,
          original_amount: parseFloat(me.amount),
          paid_amount: 0,
          outstanding: parseFloat(me.amount),
          due_date: me.expense_date || me.created_at,
          status: 'Pending',
          currency: 'PKR',
          aging: 0,
          notes: me.description || `Mill expense: ${me.category}`,
          created_at: me.created_at,
          source: 'mill_expenses',
        });
      });

      // Apply filters
      let filtered = derived;
      if (status) filtered = filtered.filter(p => p.status === status);
      if (overdue === 'true') filtered = filtered.filter(p => new Date(p.due_date) < new Date());

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + parseInt(limit));

      return res.json({
        success: true,
        data: {
          payables: paged,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
          source: 'derived_from_costs',
        },
      });
    } catch (err) {
      console.error('Get payables error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getJournalEntries(req, res) {
    try {
      const { page = 1, limit = 20, entity_type, entity_id, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('journal_entries');

      if (entity_type) {
        query = query.where('entity', entity_type);
      }
      if (entity_id) {
        query = query.where('ref_no', entity_id);
      }
      if (from_date) {
        query = query.where('date', '>=', from_date);
      }
      if (to_date) {
        query = query.where('date', '<=', to_date);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

      const [entries, countResult] = await Promise.all([
        query.orderBy('date', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      // Attach the underlying journal_lines so the FE can show the
      // DR/CR account split per entry without a per-row query.
      const entryIds = entries.map(e => e.id);
      const lines = entryIds.length
        ? await db('journal_lines').whereIn('journal_id', entryIds).orderBy(['journal_id', 'id'])
        : [];
      const linesByJournal = lines.reduce((acc, l) => {
        (acc[l.journal_id] = acc[l.journal_id] || []).push(l);
        return acc;
      }, {});
      const entriesWithLines = entries.map(e => ({
        ...e,
        lines: linesByJournal[e.id] || [],
      }));

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          entries: entriesWithLines,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get journal entries error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getAlerts(req, res) {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const [overdueReceivables, overduePayables, pendingOrders] = await Promise.all([
        db('receivables')
          .where('due_date', '<', today)
          .whereNot('status', 'Paid')
          .count('id as count')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .where('due_date', '<', today)
          .whereNot('status', 'Paid')
          .count('id as count')
          .sum('outstanding as total')
          .first(),
        db('export_orders')
          .whereIn('status', ['Draft', 'Awaiting Advance'])
          .count('id as count')
          .first(),
      ]);

      return res.json({
        success: true,
        data: {
          alerts: [
            {
              type: 'overdue_receivables',
              count: parseInt(overdueReceivables.count) || 0,
              total: parseFloat(overdueReceivables.total) || 0,
              severity: parseInt(overdueReceivables.count) > 0 ? 'warning' : 'info',
            },
            {
              type: 'overdue_payables',
              count: parseInt(overduePayables.count) || 0,
              total: parseFloat(overduePayables.total) || 0,
              severity: parseInt(overduePayables.count) > 0 ? 'danger' : 'info',
            },
            {
              type: 'pending_orders',
              count: parseInt(pendingOrders.count) || 0,
              severity: 'info',
            },
          ],
        },
      });
    } catch (err) {
      console.error('Get alerts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getOverview(req, res) {
    try {
      const [
        totalOrders,
        activeOrders,
        totalRevenue,
        totalReceivables,
        totalPayables,
        millingBatches,
      ] = await Promise.all([
        db('export_orders').count('id as count').first(),
        db('export_orders')
          .whereNotIn('status', ['Closed', 'Cancelled'])
          .count('id as count')
          .first(),
        db('export_orders')
          .where('status', 'Closed')
          .sum('contract_value as total')
          .first(),
        db('receivables')
          .whereNot('status', 'Paid')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .whereNot('status', 'Paid')
          .sum('outstanding as total')
          .first(),
        db('milling_batches')
          .whereNotIn('status', ['Completed', 'Cancelled'])
          .count('id as count')
          .first(),
      ]);

      return res.json({
        success: true,
        data: {
          overview: {
            total_orders: parseInt(totalOrders.count) || 0,
            active_orders: parseInt(activeOrders.count) || 0,
            total_revenue: parseFloat(totalRevenue.total) || 0,
            outstanding_receivables: parseFloat(totalReceivables.total) || 0,
            outstanding_payables: parseFloat(totalPayables.total) || 0,
            active_milling_batches: parseInt(millingBatches.count) || 0,
          },
        },
      });
    } catch (err) {
      console.error('Get overview error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Unified payments feed — every receipt and payment from the
  // payments table, joined with receivables/payables/local_sales for
  // human-friendly counterparty + source labels. Powers the Money In
  // and Money Out tabs on the Reports hub.
  async listPayments(req, res) {
    try {
      const { type, from_date, to_date, limit = 500 } = req.query;
      let q = db('payments as p')
        .leftJoin('receivables as r', 'p.linked_receivable_id', 'r.id')
        .leftJoin('payables as pa',   'p.linked_payable_id',    'pa.id')
        .leftJoin('customers as c',   'r.customer_id',          'c.id')
        .leftJoin('suppliers as s',   'pa.supplier_id',         's.id')
        .leftJoin('local_sales as ls','p.local_sale_id',        'ls.id')
        .leftJoin('bank_accounts as ba','p.bank_account_id',    'ba.id')
        .select(
          'p.id', 'p.payment_no', 'p.type', 'p.amount', 'p.currency',
          'p.fx_rate', 'p.base_amount_pkr', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.created_at',
          'p.linked_receivable_id', 'p.linked_payable_id', 'p.local_sale_id',
          'r.recv_no as recv_no', 'r.entity as recv_entity', 'r.type as recv_type',
          'pa.pay_no as pay_no', 'pa.entity as pay_entity', 'pa.payable_type', 'pa.linked_ref as pay_linked_ref',
          'c.name as customer_name',
          's.name as supplier_name',
          'ls.sale_no as sale_no', 'ls.buyer_name as sale_buyer',
          'ba.name as bank_name', 'ba.currency as bank_currency'
        );
      if (type) q = q.where('p.type', type);
      if (from_date) q = q.where('p.payment_date', '>=', from_date);
      if (to_date)   q = q.where('p.payment_date', '<=', to_date);
      const rows = await q.orderBy('p.payment_date', 'desc').limit(parseInt(limit));

      // Compose a single counterparty + source label per row so the FE
      // doesn't have to do the joining gymnastics.
      const enriched = rows.map(r => {
        let counterparty = '—';
        let sourceRef = null;
        let sourceHref = null;
        if (r.type === 'receipt') {
          counterparty = r.customer_name || r.sale_buyer || 'Walk-in customer';
          sourceRef = r.recv_no || r.sale_no || null;
          if (r.recv_no && r.recv_no.startsWith('RCV-LS')) sourceHref = '/local-sales';
        } else {
          counterparty = r.supplier_name || r.pay_linked_ref || 'Vendor';
          sourceRef = r.pay_no || null;
        }
        return { ...r, counterparty, sourceRef, sourceHref };
      });

      // PKR totals across the filtered set. Resolve order:
      //   1. base_amount_pkr if present (post round-094/095 entries)
      //   2. amount × fx_rate if fx_rate > 1
      //   3. for non-PKR currency with no rate, fall back to 280 (the
      //      historical default) so legacy rows don't silently render
      //      as 1× the foreign amount in the PKR total
      //   4. amount as-is for PKR rows
      const totalPkr = enriched.reduce((s, r) => s + paymentToPkr(r), 0);
      // Re-stamp each row with a normalized basePkr field so the FE
      // doesn't have to repeat this fallback chain.
      for (const r of enriched) {
        r.base_amount_pkr_normalized = paymentToPkr(r);
      }

      return res.json({
        success: true,
        data: { payments: enriched, totalPkr: Number(totalPkr.toFixed(2)), count: enriched.length },
      });
    } catch (err) {
      console.error('List payments error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordPayment(req, res) {
    try {
      const {
        type,
        linked_receivable_id,
        linked_payable_id,
        amount,
        currency,
        payment_date,
        payment_method,
        bank_account_id,
        bank_reference,
        notes,
      } = req.body;

      const entity_type = type === 'receipt' ? 'receivable' : 'payable';
      const entity_id = linked_receivable_id || linked_payable_id;

      if (!type || !entity_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'type, linked_receivable_id or linked_payable_id, and a positive amount are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        const paymentNo = await generatePaymentNo(trx);

        // Create payment record
        const [payment] = await trx('payments')
          .insert({
            payment_no: paymentNo,
            type,
            linked_receivable_id: linked_receivable_id || null,
            linked_payable_id: linked_payable_id || null,
            amount: parseFloat(amount),
            currency: currency || 'USD',
            payment_method: payment_method || null,
            bank_account_id: bank_account_id || null,
            bank_reference: bank_reference || null,
            payment_date: payment_date || trx.fn.now(),
            notes: notes || null,
            created_by: req.user.id,
          })
          .returning('*');

        // Update receivable or payable
        if (type === 'receipt' && linked_receivable_id) {
          const receivable = await trx('receivables').where({ id: linked_receivable_id }).first();
          if (receivable) {
            const newPaid = parseFloat(receivable.received_amount || 0) + parseFloat(amount);
            const newOutstanding = parseFloat(receivable.expected_amount) - newPaid;
            const fullyPaid = newOutstanding <= 0;
            await trx('receivables').where({ id: linked_receivable_id }).update({
              received_amount: newPaid,
              outstanding: Math.max(0, newOutstanding),
              // CHECK constraints on receivables.status / payables.status
              // require capitalised values { Pending, Partial, Paid,
              // Overdue, Written Off }. Lowercase silently 23514s.
              status: fullyPaid ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });
          }
          if (bank_account_id) {
            await trx('bank_accounts')
              .where({ id: bank_account_id })
              .increment('current_balance', parseFloat(amount));
          }
        } else if (type === 'payment' && linked_payable_id) {
          const payable = await trx('payables').where({ id: linked_payable_id }).first();
          if (payable) {
            const newPaid = parseFloat(payable.paid_amount || 0) + parseFloat(amount);
            const newOutstanding = parseFloat(payable.original_amount) - newPaid;
            const fullyPaid = newOutstanding <= 0;
            await trx('payables').where({ id: linked_payable_id }).update({
              paid_amount: newPaid,
              outstanding: Math.max(0, newOutstanding),
              // CHECK constraints on receivables.status / payables.status
              // require capitalised values { Pending, Partial, Paid,
              // Overdue, Written Off }. Lowercase silently 23514s.
              status: fullyPaid ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });

            // Mirror the status back to the source row so the Expenses
            // / Mill Purchases tabs reflect the same payment state
            // instead of forever showing Unpaid.
            if (payable.source_table === 'business_expenses' && payable.source_id) {
              await trx('business_expenses')
                .where({ id: payable.source_id })
                .update({
                  payment_status: fullyPaid ? 'Paid' : 'Partial',
                  paid_date: fullyPaid ? new Date() : null,
                  bank_account_id: bank_account_id || null,
                  payment_method: payment_method || null,
                  payment_reference: bank_reference || null,
                  updated_at: trx.fn.now(),
                });
            } else if (payable.source_table === 'mill_purchases' && payable.source_id) {
              await trx('mill_purchases')
                .where({ id: payable.source_id })
                .update({
                  payment_status: fullyPaid ? 'Paid' : 'Partial',
                  updated_at: trx.fn.now(),
                });
            }
          }
          if (bank_account_id) {
            await trx('bank_accounts')
              .where({ id: bank_account_id })
              .increment('current_balance', parseFloat(amount) * -1);
          }
        }

        // Create journal entry via accounting service
        const isReceivable = type === 'receipt';
        await accountingService.autoPost(trx, {
          triggerEvent: isReceivable ? 'payment_receipt' : 'payment_made',
          entity: isReceivable ? 'export' : 'mill',
          amount: parseFloat(amount),
          currency: currency || 'USD',
          refType: 'Payment',
          refNo: paymentNo,
          description: `Payment recorded for ${entity_type} #${entity_id}`,
          userId: req.user.id,
        });

        return payment;
      });

      return res.status(201).json({
        success: true,
        data: { payment: result },
      });
    } catch (err) {
      console.error('Record payment error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getBankAccounts(req, res) {
    try {
      const accounts = await db('bank_accounts').orderBy('name', 'asc');
      return res.json({
        success: true,
        data: { accounts },
      });
    } catch (err) {
      console.error('Get bank accounts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getBankTransactions(req, res) {
    try {
      // Check if table exists (it may not have been created yet)
      const tableExists = await db.schema.hasTable('bank_transactions');
      if (!tableExists) {
        return res.json({ success: true, data: { transactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
      }

      const { page = 1, limit = 20, bank_account_id, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('bank_transactions as bt')
        .leftJoin('bank_accounts as ba', 'bt.bank_account_id', 'ba.id')
        .select('bt.*', 'ba.name as account_name');

      if (bank_account_id) {
        query = query.where('bt.bank_account_id', bank_account_id);
      }
      if (from_date) {
        query = query.where('bt.transaction_date', '>=', from_date);
      }
      if (to_date) {
        query = query.where('bt.transaction_date', '<=', to_date);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('bt.id as total').first();

      const [transactions, countResult] = await Promise.all([
        query.orderBy('bt.transaction_date', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get bank transactions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getInternalTransfers(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('internal_transfers as it')
        .leftJoin('milling_batches as mb', 'it.batch_id', 'mb.id')
        .leftJoin('export_orders as eo', 'it.export_order_id', 'eo.id')
        .select(
          'it.*',
          'mb.batch_no',
          'eo.order_no as export_order_no'
        );

      const countQuery = query.clone().clearSelect().clearOrder().count('it.id as total').first();

      const [transfers, countResult] = await Promise.all([
        query.orderBy('it.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          transfers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get internal transfers error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createInternalTransfer(req, res) {
    try {
      const {
        batch_id,
        export_order_id,
        product_name,
        qty_mt,
        transfer_price_pkr,
        total_value_pkr,
        usd_equivalent,
        pkr_rate,
        dispatch_date,
        status,
      } = req.body;

      if (!batch_id || !export_order_id || !qty_mt || parseFloat(qty_mt) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'batch_id, export_order_id, and a positive qty_mt are required.',
        });
      }

      const transfer = await db.transaction(async (trx) => {
        const transferNo = await generateTransferNo(trx);

        const [t] = await trx('internal_transfers')
          .insert({
            transfer_no: transferNo,
            batch_id,
            export_order_id,
            product_name: product_name || null,
            qty_mt: parseFloat(qty_mt),
            transfer_price_pkr: transfer_price_pkr ? parseFloat(transfer_price_pkr) : null,
            total_value_pkr: total_value_pkr ? parseFloat(total_value_pkr) : null,
            usd_equivalent: usd_equivalent ? parseFloat(usd_equivalent) : null,
            pkr_rate: pkr_rate ? parseFloat(pkr_rate) : 280,
            dispatch_date: dispatch_date || null,
            status: status || 'Pending',
            created_by: req.user.id,
          })
          .returning('*');

        // Post inventory movements
        const millingLot = await trx('inventory_lots')
          .where({ entity: 'mill', type: 'finished' })
          .where('qty', '>=', t.qty_mt)
          .first();

        if (millingLot) {
          await inventoryService.transferToExport(trx, {
            transferId: t.id,
            lotId: millingLot.id,
            qtyMT: t.qty_mt,
            productName: t.product_name,
            orderId: t.export_order_id,
            userId: req.user?.id,
          });
        }

        // Auto-post accounting journals for both entities
        const transferAmount = parseFloat(t.total_value_pkr || 0);
        if (transferAmount > 0) {
          await accountingService.autoPost(trx, {
            triggerEvent: 'internal_transfer_mill',
            entity: 'mill',
            amount: transferAmount,
            currency: 'PKR',
            refType: 'Internal Transfer',
            refNo: t.transfer_no || `IT-${t.id}`,
            description: `Internal transfer (mill side) — ${t.product_name || 'rice'}`,
            userId: req.user?.id,
          });

          await accountingService.autoPost(trx, {
            triggerEvent: 'internal_transfer_export',
            entity: 'export',
            amount: parseFloat(t.usd_equivalent || transferAmount),
            currency: 'USD',
            refType: 'Internal Transfer',
            refNo: t.transfer_no || `IT-${t.id}`,
            description: `Internal transfer (export side) — ${t.product_name || 'rice'}`,
            userId: req.user?.id,
          });
        }

        if (t.export_order_id) {
          // Transfer value is in PKR — convert to order currency using order's locked FX rate
          const linkedOrder = await trx('export_orders').where('id', t.export_order_id).first();
          const orderFxRate = parseFloat(linkedOrder?.booked_fx_rate) || parseFloat(t.pkr_rate) || 280;
          const valuePkr = parseFloat(t.total_value_pkr) || 0;
          const valueInOrderCurrency = valuePkr / orderFxRate;

          if (valueInOrderCurrency > 0) {
            const existingCost = await trx('export_order_costs')
              .where({ order_id: t.export_order_id, category: 'raw_rice' })
              .first();

            if (existingCost) {
              await trx('export_order_costs')
                .where({ id: existingCost.id })
                .update({
                  amount: parseFloat(existingCost.amount || 0) + valueInOrderCurrency,
                  currency: linkedOrder?.currency || 'USD',
                  base_amount_pkr: (parseFloat(existingCost.amount || 0) + valueInOrderCurrency) * orderFxRate,
                  fx_rate: orderFxRate,
                  notes: `Updated from transfer ${t.transfer_no} (PKR ${Math.round(valuePkr).toLocaleString()} ÷ ${orderFxRate})`,
                  updated_at: trx.fn.now(),
                });
            } else {
              await trx('export_order_costs').insert({
                order_id: t.export_order_id,
                category: 'raw_rice',
                amount: valueInOrderCurrency,
                currency: linkedOrder?.currency || 'USD',
                base_amount_pkr: valuePkr,
                fx_rate: orderFxRate,
                notes: `From transfer ${t.transfer_no} (PKR ${Math.round(valuePkr).toLocaleString()} ÷ ${orderFxRate})`,
              });
            }
          }
        }

        return t;
      });

      return res.status(201).json({
        success: true,
        data: { transfer },
      });
    } catch (err) {
      console.error('Create internal transfer error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

// ===================== COST ALLOCATIONS =====================

async function generateCostNo(trx) {
  const last = await (trx || db)('cost_allocations')
    .select('cost_no')
    .orderBy('id', 'desc')
    .first();
  if (!last || !last.cost_no) return 'COST-001';
  const num = parseInt(last.cost_no.replace('COST-', '')) + 1;
  return 'COST-' + String(num).padStart(3, '0');
}

financeController.listCostAllocations = async function (req, res) {
  try {
    const { limit = 200 } = req.query;
    const allocations = await db('cost_allocations')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));

    const allocationIds = allocations.map(a => a.id);
    const lines = allocationIds.length > 0
      ? await db('cost_allocation_lines').whereIn('allocation_id', allocationIds)
      : [];

    const result = allocations.map(a => ({
      ...a,
      lines: lines.filter(l => l.allocation_id === a.id),
    }));

    return res.json({ success: true, data: { allocations: result } });
  } catch (err) {
    console.error('List cost allocations error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.createCostAllocation = async function (req, res) {
  try {
    const { entity, category, vendor, gross_amount, currency, date } = req.body;
    if (!category || !gross_amount) {
      return res.status(400).json({ success: false, message: 'Category and gross_amount are required.' });
    }
    const costNo = await generateCostNo();
    const [id] = await db('cost_allocations').insert({
      cost_no: costNo,
      entity: entity || 'export',
      category,
      vendor: vendor || null,
      gross_amount: parseFloat(gross_amount),
      currency: currency || 'USD',
      date: date || new Date().toISOString().split('T')[0],
      status: 'Unallocated',
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('id');

    const allocation = await db('cost_allocations').where({ id: id.id || id }).first();
    return res.json({ success: true, data: { allocation } });
  } catch (err) {
    console.error('Create cost allocation error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.addAllocationLine = async function (req, res) {
  try {
    const { id } = req.params;
    const { target_type, target_id, amount, pct } = req.body;

    const allocation = await db('cost_allocations').where({ id }).first();
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'Cost allocation not found.' });
    }

    await db('cost_allocation_lines').insert({
      allocation_id: parseInt(id),
      target_type: target_type || 'export_order',
      target_id: target_id || '',
      amount: parseFloat(amount) || 0,
      pct: parseFloat(pct) || 0,
    });

    // Recalculate status
    const lines = await db('cost_allocation_lines').where({ allocation_id: id });
    const totalAllocated = lines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const newStatus = totalAllocated >= parseFloat(allocation.gross_amount) ? 'Allocated' : totalAllocated > 0 ? 'Partial' : 'Unallocated';
    await db('cost_allocations').where({ id }).update({ status: newStatus, updated_at: new Date() });

    const updated = await db('cost_allocations').where({ id }).first();
    updated.lines = lines;
    return res.json({ success: true, data: { allocation: updated } });
  } catch (err) {
    console.error('Add allocation line error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.removeAllocationLine = async function (req, res) {
  try {
    const { allocationId, lineId } = req.params;

    await db('cost_allocation_lines').where({ id: lineId, allocation_id: allocationId }).del();

    const lines = await db('cost_allocation_lines').where({ allocation_id: allocationId });
    const allocation = await db('cost_allocations').where({ id: allocationId }).first();
    const totalAllocated = lines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const newStatus = totalAllocated >= parseFloat(allocation.gross_amount) ? 'Allocated' : totalAllocated > 0 ? 'Partial' : 'Unallocated';
    await db('cost_allocations').where({ id: allocationId }).update({ status: newStatus, updated_at: new Date() });

    return res.json({ success: true, data: { message: 'Allocation line removed.' } });
  } catch (err) {
    console.error('Remove allocation line error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

module.exports = financeController;
