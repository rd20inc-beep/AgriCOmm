/**
 * Local Sales Controller — Sell inventory in the domestic market (PKR).
 */

const db = require('../../config/database');
const uc = require('../../services/unitConversion');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../accounting/accounting.service');

async function generateSaleNo(trx) {
  const count = await (trx || db)('local_sales').count('id as c').first();
  return `LS-${String((parseInt(count?.c) || 0) + 1).padStart(4, '0')}`;
}

// Which account a receipt lands in: cash → the cash-type account; bank transfer
// → the chosen bank account; cheque (uncleared) / credit (unpaid) → none.
async function resolveReceiptAccountId(trx, { paymentMode, bankAccountId, amount }) {
  if (!(amount > 0)) return null;
  if (paymentMode === 'bank_transfer') return bankAccountId || null;
  if (paymentMode === 'cash') {
    const cashAcct = await trx('bank_accounts').where({ type: 'cash', is_active: true }).orderBy('id').first();
    return cashAcct ? cashAcct.id : null;
  }
  return null;
}

// Move a receiving account's balance by the amount received and drop a Cash &
// Bank sub-ledger row (linked to the payment so a delete can reverse it).
async function postReceiptToAccount(trx, { accountId, amount, paymentId, reference, notes, date, userId }) {
  if (!accountId || !(amount > 0)) return;
  await trx('bank_accounts').where({ id: accountId }).increment('current_balance', amount);
  const lastBt = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
  const seq = lastBt ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
  await trx('bank_transactions').insert({
    transaction_no: `BT-${String(seq).padStart(4, '0')}`, bank_account_id: accountId,
    type: 'credit', amount, currency: 'PKR', status: 'posted',
    transaction_date: date || new Date(), reference: reference || null,
    notes: notes || null, source: 'local_sale', linked_payment_id: paymentId, created_by: userId || null,
  });
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
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'u.full_name as created_by_name'
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
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'il.supplier_id as lot_supplier_id', 'u.full_name as created_by_name'
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
        payment_mode = 'cash', paid_amount, payment_reference,
        collection_location, bank_account_id, due_date,
        vehicle_no, driver_name, dispatched = true, notes,
      } = req.body;

      // One sale can carry several inventory items (multi-item). Accept items[]
      // or fall back to the legacy single top-level item fields (backward compat).
      const rawItems = (Array.isArray(req.body.items) && req.body.items.length)
        ? req.body.items
        : [{
            lot_id: req.body.lot_id, item_name: req.body.item_name, item_type: req.body.item_type,
            quantity_input: req.body.quantity_input, quantity_unit: req.body.quantity_unit,
            bag_weight_kg: req.body.bag_weight_kg, rate_input: req.body.rate_input, rate_unit: req.body.rate_unit,
          }];

      // Validate + price every line up front.
      const lines = rawItems.map((it, i) => {
        if (!it.item_name || !it.quantity_input || !it.rate_input) {
          const e = new Error(`Item ${i + 1}: item_name, quantity and rate are required.`); e.status = 400; throw e;
        }
        // A mill-store packaging line (e.g. empty katta) is COUNT-based: pieces ×
        // rate, deducting mill_stock — no weight/unit conversion.
        if (it.mill_item_id) {
          const count = parseFloat(it.quantity_input) || 0;
          const rate = parseFloat(it.rate_input) || 0;
          return {
            isMillItem: true, mill_item_id: it.mill_item_id, lot_id: null,
            item_name: it.item_name, item_type: 'packaging', count,
            quantity_input: count, quantity_unit: 'pcs', rate_input: rate, rate_unit: 'pcs',
            bagWt: 0, qtyKg: count, ratePerKg: rate, total: uc.round2(count * rate),
          };
        }
        const bagWt = parseFloat(it.bag_weight_kg) || 50;
        const qtyKg = uc.toKg(it.quantity_input, it.quantity_unit || 'kg', bagWt);
        const ratePerKg = uc.rateToPerKg(it.rate_input, it.rate_unit || 'kg', bagWt);
        return {
          lot_id: it.lot_id || null, item_name: it.item_name, item_type: it.item_type || null,
          quantity_input: parseFloat(it.quantity_input), quantity_unit: it.quantity_unit || 'kg',
          rate_input: parseFloat(it.rate_input), rate_unit: it.rate_unit || 'kg',
          bagWt, qtyKg, ratePerKg, total: uc.round2(qtyKg * ratePerKg),
        };
      });

      const grandTotal = uc.round2(lines.reduce((s, l) => s + l.total, 0));
      // Explicit amount wins; otherwise credit mode defaults to UNPAID (the whole
      // amount is owed), every other mode defaults to fully paid.
      const totalPaid = (paid_amount != null && paid_amount !== '')
        ? (parseFloat(paid_amount) || 0)
        : (payment_mode === 'credit' ? 0 : grandTotal);
      // Allocate the single tendered amount across lines proportionally; the last
      // line absorbs the rounding remainder so Σ(line paid) === totalPaid exactly.
      let allocated = 0;
      lines.forEach((l, i) => {
        if (i === lines.length - 1) l.paid = uc.round2(Math.max(0, totalPaid - allocated));
        else { l.paid = grandTotal > 0 ? uc.round2(totalPaid * (l.total / grandTotal)) : 0; allocated += l.paid; }
      });
      // A credit / partial sale leaves a balance owed → a receivable, which needs
      // a customer to chase. (receivables.customer_id is NOT NULL.)
      const hasDue = totalPaid < grandTotal - 0.01;

      const result = await db.transaction(async (trx) => {
        // Resolve the customer for any owed balance: use the selected one, else
        // auto-register the walk-in buyer (dedupe by name) so credit sales work
        // without a manual registration step. A fully-paid walk-in stays anonymous.
        let resolvedCustomerId = customer_id || null;
        if (hasDue && !resolvedCustomerId) {
          const nm = (buyer_name || '').trim();
          if (!nm) { const e = new Error('A credit or partial sale needs a buyer name (or a registered customer) so the balance can be tracked.'); e.status = 400; throw e; }
          let cust = await trx('customers').whereRaw('LOWER(name) = LOWER(?)', [nm]).first();
          if (!cust) {
            [cust] = await trx('customers').insert({
              name: nm, phone: buyer_phone || null, payment_terms: 'Credit', currency: 'PKR',
              is_active: true, approval_status: 'pending',
              submitted_by: req.user?.id || null, submitted_at: trx.fn.now(),
            }).returning('*');
          }
          resolvedCustomerId = cust.id;
        }

        // Cash / bank receipts move the receiving account's balance with the money.
        const receiptAccountId = await resolveReceiptAccountId(trx, { paymentMode: payment_mode, bankAccountId: bank_account_id, amount: totalPaid });

        let groupNo = null;
        const created = [];

        for (const l of lines) {
          const saleNo = await generateSaleNo(trx);
          if (!groupNo) groupNo = saleNo; // first line's number identifies the group

          let costPerKg = 0, landedCostTotal = 0, lotNo = null;
          if (l.isMillItem) {
            // Sell a mill-store packaging item (empty katta) — deduct mill_stock.
            const mi = await trx('mill_items').where({ id: l.mill_item_id }).first();
            if (!mi) throw new Error('Packaging item not found');
            const ms = await trx('mill_stock').where({ item_id: l.mill_item_id, warehouse_id: null }).first();
            const avail = parseFloat(ms && ms.quantity_available) || 0;
            if (l.count > avail + 0.01) {
              const e = new Error(`Insufficient ${mi.name}: ${Math.round(avail)} in stock, ${l.count} needed.`); e.status = 400; throw e;
            }
            await trx('mill_stock').where({ id: ms.id }).update({
              quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [l.count]), updated_at: trx.fn.now(),
            });
            await trx('mill_stock_movements').insert({
              item_id: l.mill_item_id, warehouse_id: null, movement_type: 'consumption', quantity: -l.count,
              reference_type: 'local_sale', reference_id: null, reason: `Sold ${l.count} ${mi.unit || 'pcs'} — ${saleNo}`, performed_by: req.user?.id || null,
            });
            costPerKg = parseFloat(mi.avg_cost_per_unit) || 0; // per piece
            landedCostTotal = uc.round2(l.count * costPerKg);
          } else if (l.lot_id) {
            const lot = await trx('inventory_lots').where({ id: l.lot_id }).first();
            if (!lot) throw new Error('Inventory lot not found');
            const availKg = (parseFloat(lot.available_qty) || 0) * 1000;
            if (l.qtyKg > availKg + 0.01) {
              const e = new Error(`Insufficient stock: ${l.item_name} needs ${Math.round(l.qtyKg)} kg but only ${availKg.toFixed(0)} kg available in ${lot.lot_no}`);
              e.status = 400; throw e;
            }
            // Atomic outbound movement — draws the lot down + writes the ledger;
            // no try/catch so a failed deduction rolls the whole sale back.
            await inventoryService.postMovement(trx, {
              movementType: 'local_sale', lotId: lot.id, qty: l.qtyKg / 1000,
              fromWarehouseId: lot.warehouse_id, sourceEntity: lot.entity, linkedRef: saleNo,
              notes: `Local sale ${saleNo} to ${buyer_name || 'customer'}`,
              costPerUnit: parseFloat(lot.cost_per_unit) || 0, currency: 'PKR', userId: req.user?.id,
            });
            await trx('inventory_lots').where({ id: l.lot_id }).update({
              sold_weight_kg: (parseFloat(lot.sold_weight_kg) || 0) + l.qtyKg,
            });
            costPerKg = parseFloat(lot.landed_cost_per_kg) || (parseFloat(lot.cost_per_unit) || 0) / 1000 || (parseFloat(lot.rate_per_kg) || 0);
            landedCostTotal = uc.round2(l.qtyKg * costPerKg);
            lotNo = lot.lot_no;
          }

          const dueAmt = Math.max(0, uc.round2(l.total - l.paid));
          const paymentStatus = dueAmt <= 0 ? 'Paid' : l.paid > 0 ? 'Partial' : (payment_mode === 'credit' ? 'Credit' : 'Unpaid');
          const grossProfit = uc.round2(l.total - landedCostTotal);

          const [sale] = await trx('local_sales').insert({
            sale_no: saleNo, sale_group_no: groupNo,
            sale_date: sale_date || new Date().toISOString().split('T')[0],
            entity: 'mill', customer_id: resolvedCustomerId,
            buyer_name: buyer_name || null, buyer_phone: buyer_phone || null, buyer_address: buyer_address || null,
            lot_id: l.lot_id, lot_no: lotNo, mill_item_id: l.mill_item_id || null,
            item_name: l.item_name, item_type: l.item_type,
            quantity_unit: l.quantity_unit, quantity_input: l.quantity_input, quantity_kg: l.qtyKg,
            quantity_bags: l.isMillItem ? l.count : (l.bagWt > 0 ? Math.round(l.qtyKg / l.bagWt) : 0), bag_weight_kg: l.isMillItem ? null : l.bagWt,
            rate_unit: l.rate_unit, rate_input: l.rate_input, rate_per_kg: l.ratePerKg,
            total_amount: l.total, currency: 'PKR',
            payment_mode: payment_mode || 'cash', payment_status: paymentStatus,
            paid_amount: l.paid, due_amount: dueAmt, payment_reference: payment_reference || null,
            collection_location: collection_location || null, due_date: due_date || null,
            vehicle_no: vehicle_no || null, driver_name: driver_name || null,
            dispatched: !!dispatched, dispatch_date: dispatched ? (sale_date || new Date().toISOString().split('T')[0]) : null,
            notes: notes || null, status: 'Completed', created_by: req.user?.id || null,
            cost_per_kg: costPerKg, landed_cost_total: landedCostTotal, gross_profit: grossProfit,
            profit_per_kg: l.qtyKg > 0 ? uc.round4(grossProfit / l.qtyKg) : 0,
            margin_pct: l.total > 0 ? uc.round2((grossProfit / l.total) * 100) : 0,
          }).returning('*');

          if (l.paid > 0) {
            const payCount = await trx('payments').count('id as c').first();
            // 'credit' is a sale MODE, not a tender method — an actual receipt
            // (partial payment on a credit sale) is recorded as cash so it passes
            // the payments.payment_method check constraint.
            const payMethod = (payment_mode && payment_mode !== 'credit') ? payment_mode : 'cash';
            const [payRow] = await trx('payments').insert({
              payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`, type: 'receipt',
              amount: l.paid, currency: 'PKR', fx_rate: 1, base_amount_pkr: l.paid,
              payment_method: payMethod, bank_reference: payment_reference || null,
              bank_account_id: receiptAccountId || bank_account_id || null, due_date: due_date || null,
              payment_date: sale_date || trx.fn.now(), notes: `Local sale ${saleNo} — ${l.item_name}`,
              local_sale_id: sale.id, created_by: req.user?.id || null,
            }).returning('id');

            await postReceiptToAccount(trx, {
              accountId: receiptAccountId, amount: l.paid, paymentId: payRow.id,
              reference: payment_reference || saleNo, notes: `Local sale ${saleNo} receipt — ${l.item_name}`,
              date: sale_date, userId: req.user?.id,
            });
          }

          if (dueAmt > 0) {
            const rcvCount = await trx('receivables').count('id as c').first();
            await trx('receivables').insert({
              recv_no: `RCV-LS-${(parseInt(rcvCount?.c) || 0) + 1}`, entity: 'mill',
              customer_id: resolvedCustomerId, local_sale_id: sale.id, type: 'Local Sale',
              expected_amount: l.total, received_amount: l.paid, outstanding: dueAmt,
              due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              status: l.paid > 0 ? 'Partial' : 'Pending', currency: 'PKR', aging: 0,
              notes: `Local sale ${saleNo} — ${buyer_name || 'walk-in'} — ${l.item_name}`,
            });
          }

          if (sale.id && l.lot_id) await inventoryService.lockSaleCOGS(trx, sale.id);

          try {
            await accountingService.autoPost(trx, {
              triggerEvent: 'local_sale_recorded', entity: 'mill', amount: l.total, currency: 'PKR',
              refType: 'Local Sale', refNo: saleNo,
              description: `Local sale ${saleNo} — ${buyer_name || 'walk-in'} — ${l.item_name}`.slice(0, 240),
              userId: req.user?.id,
            });
          } catch (e) { console.warn('Local sale journal post failed:', e.message); }

          created.push(sale);
        }

        return { groupNo, sales: created };
      });

      return res.status(201).json({
        success: true,
        data: { sale: result.sales[0], sales: result.sales, group_no: result.groupNo, item_count: result.sales.length },
      });
    } catch (err) {
      console.error('Local sale create error:', err);
      const status = err.status || (String(err.message).includes('Insufficient') ? 400 : 500);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // Accept payment against a local sale
  async acceptPayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, payment_method = 'cash', payment_date, reference, notes, bank_account_id, due_date, collection_location } = req.body;

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

      // A post-dated cheque (cheque with a future due_date) is recorded but does
      // NOT settle the sale until it clears — the sale stays Partial/Unpaid.
      const today = new Date(new Date().toDateString());
      const isPostDated = payment_method === 'cheque' && due_date && new Date(due_date) > today;

      const newPaid = (parseFloat(sale.paid_amount) || 0) + payAmount;
      const newDue = Math.max(0, (parseFloat(sale.total_amount) || 0) - newPaid);
      const newStatus = newDue <= 0 ? 'Paid' : 'Partial';

      await db.transaction(async (trx) => {
        if (!isPostDated) {
          await trx('local_sales').where({ id }).update({
            paid_amount: uc.round2(newPaid),
            due_amount: uc.round2(newDue),
            payment_status: newStatus,
            // Record WHERE this cash/udhaar was collected (Mill / Head Office).
            ...(collection_location ? { collection_location } : {}),
            updated_at: trx.fn.now(),
          });
        }

        // Create payment record (cleared=false for an uncleared post-dated cheque).
        const receiptAccountId = isPostDated ? null : await resolveReceiptAccountId(trx, { paymentMode: payment_method, bankAccountId: bank_account_id, amount: payAmount });
        const payCount = await trx('payments').count('id as c').first();
        const [payRow] = await trx('payments').insert({
          payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`,
          type: 'receipt',
          amount: payAmount,
          currency: 'PKR',
          fx_rate: 1,
          base_amount_pkr: payAmount,
          payment_method: payment_method,
          due_date: due_date || null,
          cleared: !isPostDated,
          bank_reference: reference || null,
          bank_account_id: receiptAccountId || bank_account_id || null,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Payment for local sale ${sale.sale_no}${collection_location && payment_method === 'cash' ? ` (collected at ${collection_location})` : ''}`,
          local_sale_id: parseInt(id),
          created_by: req.user?.id || null,
        }).returning('id');

        if (!isPostDated) {
          // Cash / bank receipt → move the receiving account's balance.
          await postReceiptToAccount(trx, {
            accountId: receiptAccountId, amount: payAmount, paymentId: payRow.id,
            reference: reference || sale.sale_no, notes: `Payment for local sale ${sale.sale_no}`,
            date: payment_date, userId: req.user?.id,
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
              status: rcvNewOutstanding <= 0 ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });
          }
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
