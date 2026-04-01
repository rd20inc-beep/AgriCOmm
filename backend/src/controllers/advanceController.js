const db = require('../config/database');

async function generateAdvanceNo(trx) {
  const last = await trx('advance_payments')
    .select('advance_no')
    .where('advance_no', 'like', 'ADV-%')
    .orderBy('id', 'desc')
    .first();
  const num = last ? (parseInt(last.advance_no.replace('ADV-', ''), 10) || 0) + 1 : 1;
  return `ADV-${String(num).padStart(3, '0')}`;
}

const advanceController = {
  // GET /api/advances — list all buyer advances
  async list(req, res) {
    try {
      const { status, customer_id, page = 1, limit = 50 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('advance_payments as ap')
        .leftJoin('customers as c', 'ap.customer_id', 'c.id')
        .leftJoin('bank_accounts as ba', 'ap.bank_account_id', 'ba.id')
        .select(
          'ap.*',
          'c.name as customer_name',
          'c.country as customer_country',
          'ba.name as bank_account_name'
        );

      if (status) query = query.where('ap.status', status);
      if (customer_id) query = query.where('ap.customer_id', customer_id);

      const countQuery = query.clone().clearSelect().clearOrder().count('ap.id as total').first();

      const [advances, countResult] = await Promise.all([
        query.orderBy('ap.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      // Fetch allocations for each advance
      const advanceIds = advances.map(a => a.id);
      const allocations = advanceIds.length > 0
        ? await db('advance_allocations as aa')
            .leftJoin('export_orders as eo', 'aa.order_id', 'eo.id')
            .whereIn('aa.advance_id', advanceIds)
            .select('aa.*', 'eo.order_no')
        : [];

      const advancesWithAllocations = advances.map(a => ({
        ...a,
        allocations: allocations.filter(al => al.advance_id === a.id),
      }));

      return res.json({
        success: true,
        data: {
          advances: advancesWithAllocations,
          pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.total) },
        },
      });
    } catch (err) {
      console.error('List advances error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // POST /api/advances — record a new buyer advance
  async create(req, res) {
    try {
      const { customer_id, amount, currency, bank_account_id, payment_method, bank_reference, payment_date, notes } = req.body;

      if (!customer_id) return res.status(400).json({ success: false, message: 'Buyer is required.' });
      if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ success: false, message: 'A positive amount is required.' });

      const result = await db.transaction(async (trx) => {
        const advanceNo = await generateAdvanceNo(trx);
        const amt = parseFloat(amount);

        const [advance] = await trx('advance_payments')
          .insert({
            advance_no: advanceNo,
            customer_id,
            amount: amt,
            allocated_amount: 0,
            unallocated_amount: amt,
            currency: currency || 'USD',
            bank_account_id: bank_account_id || null,
            payment_method: payment_method || null,
            bank_reference: bank_reference || null,
            payment_date: payment_date || trx.fn.now(),
            status: 'Unallocated',
            notes: notes || null,
            created_by: req.user.id,
          })
          .returning('*');

        // Credit bank account
        if (bank_account_id) {
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', amt);
        }

        return advance;
      });

      return res.status(201).json({ success: true, data: { advance: result } });
    } catch (err) {
      console.error('Create advance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // PUT /api/advances/:id/allocate — allocate advance to an export order
  async allocate(req, res) {
    try {
      const { id } = req.params;
      const { order_id, amount, notes } = req.body;

      if (!order_id) return res.status(400).json({ success: false, message: 'Order is required.' });
      if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ success: false, message: 'A positive amount is required.' });

      const advance = await db('advance_payments').where({ id }).first();
      if (!advance) return res.status(404).json({ success: false, message: 'Advance not found.' });

      const allocAmt = parseFloat(amount);
      const unallocated = parseFloat(advance.unallocated_amount) || 0;

      if (allocAmt > unallocated + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Cannot allocate ${allocAmt}. Only ${unallocated.toFixed(2)} available.`,
        });
      }

      const order = await db('export_orders').where({ id: order_id }).first();
      if (!order) return res.status(404).json({ success: false, message: 'Export order not found.' });

      await db.transaction(async (trx) => {
        // Create allocation record
        await trx('advance_allocations').insert({
          advance_id: advance.id,
          order_id,
          amount: allocAmt,
          allocated_by: req.user.id,
          notes: notes || `Allocated from ${advance.advance_no}`,
        });

        // Update advance totals
        const newAllocated = parseFloat(advance.allocated_amount) + allocAmt;
        const newUnallocated = parseFloat(advance.amount) - newAllocated;
        const newStatus = newUnallocated <= 0.01 ? 'Allocated' : 'Partial';

        await trx('advance_payments').where({ id }).update({
          allocated_amount: newAllocated,
          unallocated_amount: Math.max(0, newUnallocated),
          status: newStatus,
          updated_at: trx.fn.now(),
        });

        // Update export order advance_received
        const newAdvReceived = parseFloat(order.advance_received || 0) + allocAmt;
        await trx('export_orders').where({ id: order_id }).update({
          advance_received: newAdvReceived,
          advance_date: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

        // Update receivable if exists
        const advReceivable = await trx('receivables')
          .where({ order_id, type: 'Advance' }).first();
        if (advReceivable) {
          const newReceived = parseFloat(advReceivable.received_amount || 0) + allocAmt;
          const newOutstanding = Math.max(0, parseFloat(advReceivable.expected_amount) - newReceived);
          await trx('receivables').where({ id: advReceivable.id }).update({
            received_amount: newReceived,
            outstanding: newOutstanding,
            status: newOutstanding <= 0.01 ? 'Received' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Auto-promote order status if advance fully received
        const workflowService = require('../services/exportOrderWorkflowService');
        const freshOrder = await trx('export_orders').where({ id: order_id }).first();
        await workflowService.maybePromoteAfterAdvance(trx, {
          order: freshOrder,
          newAdvanceReceived: parseFloat(freshOrder.advance_received),
          userId: req.user.id,
          reason: `Advance allocated from ${advance.advance_no}`,
        });
      });

      const updated = await db('advance_payments')
        .leftJoin('customers as c', 'advance_payments.customer_id', 'c.id')
        .select('advance_payments.*', 'c.name as customer_name')
        .where('advance_payments.id', id)
        .first();

      return res.json({ success: true, data: { advance: updated } });
    } catch (err) {
      console.error('Allocate advance error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },
};

module.exports = advanceController;
