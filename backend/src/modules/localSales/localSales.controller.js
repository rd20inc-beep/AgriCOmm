/**
 * Local Sales Controller — Sell inventory in the domestic market (PKR).
 */

const db = require('../../config/database');
const uc = require('../../services/unitConversion');
const inventoryService = require('../../services/inventoryService');

async function generateSaleNo(trx) {
  const count = await (trx || db)('local_sales').count('id as c').first();
  return `LS-${String((parseInt(count?.c) || 0) + 1).padStart(4, '0')}`;
}

module.exports = {

  // List all local sales
  async list(req, res) {
    try {
      const { page = 1, limit = 50, status, lot_id, customer_id, from_date, to_date, search } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade'
        );

      if (status && status !== 'all') query = query.where('ls.status', status);
      if (lot_id) query = query.where('ls.lot_id', lot_id);
      if (customer_id) query = query.where('ls.customer_id', customer_id);
      if (from_date) query = query.where('ls.sale_date', '>=', from_date);
      if (to_date) query = query.where('ls.sale_date', '<=', to_date);
      if (search) {
        query = query.where(function () {
          this.where('ls.sale_no', 'ilike', `%${search}%`)
            .orWhere('ls.item_name', 'ilike', `%${search}%`)
            .orWhere('ls.buyer_name', 'ilike', `%${search}%`)
            .orWhere('c.name', 'ilike', `%${search}%`);
        });
      }

      const [{ count: total }] = await query.clone().clearSelect().count('ls.id as count');
      const sales = await query.orderBy('ls.sale_date', 'desc').limit(limit).offset(offset);

      return res.json({ success: true, data: { sales, pagination: { page: +page, limit: +limit, total: +total } } });
    } catch (err) {
      console.error('Local sales list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get single sale
  async getById(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const where = isNumeric ? { 'ls.id': parseInt(id) } : { 'ls.sale_no': id };

      const sale = await db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'il.supplier_id as lot_supplier_id'
        )
        .where(where).first();

      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data: { sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Create local sale — deducts from inventory lot
  async create(req, res) {
    try {
      const {
        sale_date, customer_id, buyer_name, buyer_phone, buyer_address,
        lot_id, item_name, item_type,
        quantity_input, quantity_unit = 'kg', bag_weight_kg = 50,
        rate_input, rate_unit = 'kg',
        payment_mode = 'cash', paid_amount, payment_reference,
        vehicle_no, driver_name, dispatched = true,
        notes,
      } = req.body;

      if (!item_name || !quantity_input || !rate_input) {
        return res.status(400).json({ success: false, message: 'item_name, quantity_input, and rate_input are required.' });
      }

      const bagWt = parseFloat(bag_weight_kg) || 50;
      const qtyKg = uc.toKg(quantity_input, quantity_unit, bagWt);
      const ratePerKg = uc.rateToPerKg(rate_input, rate_unit, bagWt);
      const totalAmount = uc.round2(qtyKg * ratePerKg);
      const paidAmt = parseFloat(paid_amount) ?? totalAmount;
      const dueAmt = Math.max(0, uc.round2(totalAmount - paidAmt));
      const bags = Math.round(qtyKg / bagWt);
      const paymentStatus = dueAmt <= 0 ? 'Paid' : paidAmt > 0 ? 'Partial' : (payment_mode === 'credit' ? 'Credit' : 'Unpaid');

      // Fetch lot cost data for profit calculation
      let costPerKg = 0;
      let landedCostTotal = 0;
      let lotData = null;

      if (lot_id) {
        lotData = await db('inventory_lots').where({ id: lot_id }).first();
        if (lotData) {
          // Get landed cost — try landed_cost_per_kg first, fall back to cost_per_unit/1000
          costPerKg = parseFloat(lotData.landed_cost_per_kg) || (parseFloat(lotData.cost_per_unit) || 0) / 1000 || (parseFloat(lotData.rate_per_kg) || 0);
          landedCostTotal = uc.round2(qtyKg * costPerKg);
        }
      }
      const grossProfit = uc.round2(totalAmount - landedCostTotal);
      const profitPerKg = qtyKg > 0 ? uc.round4(grossProfit / qtyKg) : 0;
      const marginPct = totalAmount > 0 ? uc.round2((grossProfit / totalAmount) * 100) : 0;

      const result = await db.transaction(async (trx) => {
        const saleNo = await generateSaleNo(trx);

        // Deduct from inventory lot if specified
        if (lot_id) {
          const lot = lotData || await trx('inventory_lots').where({ id: lot_id }).first();
          if (!lot) throw new Error('Inventory lot not found');

          const availKg = (parseFloat(lot.available_qty) || 0) * 1000;
          if (qtyKg > availKg + 0.01) {
            throw new Error(`Insufficient stock: need ${qtyKg} kg but only ${availKg.toFixed(0)} kg available in ${lot.lot_no}`);
          }

          // Post sales dispatch movement
          try {
            await inventoryService.postMovement(trx, {
              movementType: 'export_dispatch', // reuse dispatch type for local sales
              lotId: lot.id,
              qty: qtyKg / 1000, // convert to MT for legacy
              fromWarehouseId: lot.warehouse_id,
              sourceEntity: lot.entity,
              linkedRef: saleNo,
              notes: `Local sale ${saleNo} to ${buyer_name || 'customer'}`,
              costPerUnit: parseFloat(lot.cost_per_unit) || 0,
              currency: 'PKR',
              userId: req.user?.id,
            });
          } catch (e) {
            console.warn('Inventory movement for local sale failed:', e.message);
          }

          // Update lot sold_weight_kg
          await trx('inventory_lots').where({ id: lot_id }).update({
            sold_weight_kg: (parseFloat(lot.sold_weight_kg) || 0) + qtyKg,
          });
        }

        const [sale] = await trx('local_sales').insert({
          sale_no: saleNo,
          sale_date: sale_date || new Date().toISOString().split('T')[0],
          entity: 'mill',
          customer_id: customer_id || null,
          buyer_name: buyer_name || null,
          buyer_phone: buyer_phone || null,
          buyer_address: buyer_address || null,
          lot_id: lot_id || null,
          lot_no: lot_id ? (await trx('inventory_lots').where({ id: lot_id }).select('lot_no').first())?.lot_no : null,
          item_name,
          item_type: item_type || null,
          quantity_unit,
          quantity_input: parseFloat(quantity_input),
          quantity_kg: qtyKg,
          quantity_bags: bags,
          bag_weight_kg: bagWt,
          rate_unit,
          rate_input: parseFloat(rate_input),
          rate_per_kg: ratePerKg,
          total_amount: totalAmount,
          currency: 'PKR',
          payment_mode: payment_mode || 'cash',
          payment_status: paymentStatus,
          paid_amount: paidAmt,
          due_amount: dueAmt,
          payment_reference: payment_reference || null,
          vehicle_no: vehicle_no || null,
          driver_name: driver_name || null,
          dispatched: !!dispatched,
          dispatch_date: dispatched ? (sale_date || new Date().toISOString().split('T')[0]) : null,
          notes: notes || null,
          status: 'Completed',
          created_by: req.user?.id || null,
          // Costing fields (auto from lot)
          cost_per_kg: costPerKg,
          landed_cost_total: landedCostTotal,
          gross_profit: grossProfit,
          profit_per_kg: profitPerKg,
          margin_pct: marginPct,
        }).returning('*');

        // Create payment record if paid
        if (paidAmt > 0) {
          const payCount = await trx('payments').count('id as c').first();
          await trx('payments').insert({
            payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`,
            type: 'receipt',
            amount: paidAmt,
            currency: 'PKR',
            payment_method: payment_mode || 'cash',
            bank_reference: payment_reference || null,
            payment_date: sale_date || trx.fn.now(),
            notes: `Local sale ${saleNo} — ${item_name}`,
            local_sale_id: sale.id,
            created_by: req.user?.id || null,
          });
        }

        // Create receivable for credit/partial sales
        if (dueAmt > 0) {
          const rcvCount = await trx('receivables').count('id as c').first();
          await trx('receivables').insert({
            recv_no: `RCV-LS-${(parseInt(rcvCount?.c) || 0) + 1}`,
            entity: 'mill',
            customer_id: customer_id || null,
            local_sale_id: sale.id,
            type: 'Local Sale',
            expected_amount: totalAmount,
            received_amount: paidAmt,
            outstanding: dueAmt,
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: paidAmt > 0 ? 'Partial' : 'Pending',
            currency: 'PKR',
            aging: 0,
            notes: `Local sale ${saleNo} — ${buyer_name || 'walk-in'} — ${item_name}`,
          });
        }

        // Phase 5: Lock COGS on sale
        if (sale.id && lot_id) {
          await inventoryService.lockSaleCOGS(trx, sale.id);
        }

        return sale;
      });

      return res.status(201).json({ success: true, data: { sale: result } });
    } catch (err) {
      console.error('Local sale create error:', err);
      const status = err.message.includes('Insufficient') ? 400 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // Accept payment against a local sale
  async acceptPayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, payment_method = 'cash', payment_date, reference, notes } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      }

      const sale = await db('local_sales').where({ id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      const payAmount = parseFloat(amount);
      const currentDue = parseFloat(sale.due_amount) || 0;

      if (payAmount > currentDue + 0.01) {
        return res.status(400).json({ success: false, message: `Cannot pay Rs ${payAmount} — only Rs ${currentDue.toFixed(2)} remaining.` });
      }

      const newPaid = (parseFloat(sale.paid_amount) || 0) + payAmount;
      const newDue = Math.max(0, (parseFloat(sale.total_amount) || 0) - newPaid);
      const newStatus = newDue <= 0 ? 'Paid' : 'Partial';

      await db.transaction(async (trx) => {
        // Update sale
        await trx('local_sales').where({ id }).update({
          paid_amount: uc.round2(newPaid),
          due_amount: uc.round2(newDue),
          payment_status: newStatus,
          updated_at: trx.fn.now(),
        });

        // Create payment record
        const payCount = await trx('payments').count('id as c').first();
        await trx('payments').insert({
          payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`,
          type: 'receipt',
          amount: payAmount,
          currency: 'PKR',
          payment_method: payment_method,
          bank_reference: reference || null,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Payment for local sale ${sale.sale_no}`,
          local_sale_id: parseInt(id),
          created_by: req.user?.id || null,
        });

        // Update linked receivable — prefer FK, fall back to notes search
        const receivable = await trx('receivables')
          .where('local_sale_id', id)
          .first()
          || await trx('receivables')
            .where('notes', 'ilike', `%${sale.sale_no}%`)
            .first();
        if (receivable) {
          const rcvNewReceived = (parseFloat(receivable.received_amount) || 0) + payAmount;
          const rcvNewOutstanding = Math.max(0, (parseFloat(receivable.expected_amount) || 0) - rcvNewReceived);
          await trx('receivables').where({ id: receivable.id }).update({
            received_amount: uc.round2(rcvNewReceived),
            outstanding: uc.round2(rcvNewOutstanding),
            status: rcvNewOutstanding <= 0 ? 'Received' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }
      });

      const updated = await db('local_sales').where({ id }).first();
      return res.json({ success: true, data: { sale: updated } });
    } catch (err) {
      console.error('Accept payment error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get payment history for a sale
  async getPayments(req, res) {
    try {
      const { id } = req.params;
      const sale = await db('local_sales').where({ id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      // Prefer FK, fall back to notes search for legacy records
      let payments = await db('payments')
        .where('local_sale_id', id)
        .orderBy('payment_date', 'desc');
      if (payments.length === 0) {
        payments = await db('payments')
          .where('notes', 'ilike', `%${sale.sale_no}%`)
          .orderBy('payment_date', 'desc');
      }

      return res.json({ success: true, data: { payments, sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Summary stats
  async summary(req, res) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      const [todayStats, monthStats, totalStats, profitStats] = await Promise.all([
        db('local_sales').where('sale_date', today).where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(quantity_kg),0) as qty_kg')).first(),
        db('local_sales').where('sale_date', '>=', monthStart).where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(quantity_kg),0) as qty_kg')).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(due_amount),0) as due')).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COALESCE(SUM(total_amount),0) as revenue, COALESCE(SUM(landed_cost_total),0) as cost, COALESCE(SUM(gross_profit),0) as profit, COALESCE(SUM(paid_amount),0) as collected')).first(),
      ]);

      return res.json({
        success: true,
        data: {
          today: { count: parseInt(todayStats.count), total: parseFloat(todayStats.total), qtyKg: parseFloat(todayStats.qty_kg) },
          month: { count: parseInt(monthStats.count), total: parseFloat(monthStats.total), qtyKg: parseFloat(monthStats.qty_kg) },
          all: { count: parseInt(totalStats.count), total: parseFloat(totalStats.total), due: parseFloat(totalStats.due) },
          profit: { revenue: parseFloat(profitStats.revenue), cost: parseFloat(profitStats.cost), grossProfit: parseFloat(profitStats.profit), collected: parseFloat(profitStats.collected) },
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};
