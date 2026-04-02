const db = require('../config/database');
const inventoryService = require('../services/inventoryService');
const accountingService = require('../services/accountingService');

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
      const { page = 1, limit = 20, status, customer_id, overdue } = req.query;
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
        query = query.where('r.due_date', '<', db.fn.now()).where('r.status', '!=', 'paid');
      }

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
      const { page = 1, limit = 20, status, supplier_id, overdue } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('payables as p')
        .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
        .select(
          'p.*',
          's.name as supplier_name'
        );

      if (status) {
        query = query.where('p.status', status);
      }
      if (supplier_id) {
        query = query.where('p.supplier_id', supplier_id);
      }
      if (overdue === 'true') {
        query = query.where('p.due_date', '<', db.fn.now()).where('p.status', '!=', 'paid');
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('p.id as total').first();

      const [payables, countResult] = await Promise.all([
        query.orderBy('p.due_date', 'asc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          payables,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
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

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          entries,
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
          .whereNot('status', 'paid')
          .count('id as count')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .where('due_date', '<', today)
          .whereNot('status', 'paid')
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
          .whereNot('status', 'paid')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .whereNot('status', 'paid')
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
              status: fullyPaid ? 'paid' : 'partial',
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
              status: fullyPaid ? 'paid' : 'partial',
              updated_at: trx.fn.now(),
            });
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
          const propagatedCost = parseFloat(t.usd_equivalent || t.total_value_pkr || 0);
          if (propagatedCost > 0) {
            const existingCost = await trx('export_order_costs')
              .where({ order_id: t.export_order_id, category: 'raw_rice' })
              .first();

            if (existingCost) {
              await trx('export_order_costs')
                .where({ id: existingCost.id })
                .update({
                  amount: parseFloat(existingCost.amount || 0) + propagatedCost,
                  notes: `Updated from transfer ${t.transfer_no}`,
                  updated_at: trx.fn.now(),
                });
            } else {
              await trx('export_order_costs').insert({
                order_id: t.export_order_id,
                category: 'raw_rice',
                amount: propagatedCost,
                notes: `Updated from transfer ${t.transfer_no}`,
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

module.exports = financeController;
