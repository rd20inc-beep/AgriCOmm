const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const repo = require('./millStore.repository');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors');

const millStoreService = {
  // ─── Items ───
  async listItems(params) {
    return repo.listItems(params);
  },

  async getItem(id) {
    const item = await repo.getItemById(id);
    if (!item) throw new NotFoundError('Item not found.');
    return item;
  },

  async createItem(data, userId) {
    const existing = await repo.getItemByCode(data.code);
    if (existing) throw new ConflictError(`Item with code ${data.code} already exists.`);
    return repo.createItem({ ...data, created_by: userId });
  },

  async updateItem(id, data) {
    const existing = await repo.getItemById(id);
    if (!existing) throw new NotFoundError('Item not found.');
    return repo.updateItem(id, data);
  },

  async deleteItem(id) {
    const existing = await repo.getItemById(id);
    if (!existing) throw new NotFoundError('Item not found.');
    await repo.softDeleteItem(id);
  },

  // ─── Ratios ───
  async listRatios(params) {
    return repo.listRatios(params);
  },

  async createRatio(data) {
    const item = await repo.getItemById(data.item_id);
    if (!item) throw new NotFoundError('Item not found.');
    return repo.createRatio(data);
  },

  async updateRatio(id, data) {
    return repo.updateRatio(id, data);
  },

  async deleteRatio(id) {
    await repo.deleteRatio(id);
  },

  // ─── Purchases ───
  async createPurchase({ supplier_id, vendor_name, invoice_number, purchase_date, notes, lines }, userId) {
    if (!lines || lines.length === 0) throw new ValidationError('At least one line item is required.');

    // Validate all item_ids exist
    for (const line of lines) {
      const item = await repo.getItemById(line.item_id);
      if (!item) throw new NotFoundError(`Item id ${line.item_id} not found.`);
    }

    // Duplicate invoice check
    if (invoice_number && supplier_id) {
      const dup = await db('mill_purchases')
        .where({ supplier_id, invoice_number })
        .first();
      if (dup) throw new ConflictError(`Purchase with invoice ${invoice_number} for this supplier already exists.`);
    }

    return db.transaction(async (trx) => {
      // Resolve the party. A cash/walk-in vendor name is matched to an existing
      // supplier (case-insensitive) or auto-created as a PENDING supplier — so
      // the purchase always lands on a supplier statement, like credit walk-in
      // customers auto-register. The typed name is kept on vendor_name too.
      let resolvedSupplierId = supplier_id || null;
      const vn = (!resolvedSupplierId && vendor_name) ? String(vendor_name).trim() : null;
      if (!resolvedSupplierId && vn) {
        const existing = await trx('suppliers').whereRaw('LOWER(name) = LOWER(?)', [vn]).first('id');
        if (existing) {
          resolvedSupplierId = existing.id;
        } else {
          const [s] = await trx('suppliers').insert({
            name: vn, type: 'Mill Store Vendor', is_active: true,
            approval_status: 'pending', submitted_by: userId || null, submitted_at: trx.fn.now(),
          }).returning('id');
          resolvedSupplierId = s.id || s;
        }
      }

      const purchaseNo = await repo.generatePurchaseNo(trx);
      const header = {
        purchase_no: purchaseNo,
        supplier_id: resolvedSupplierId,
        vendor_name: vn, // keep the typed walk-in name for reference
        invoice_number: invoice_number || null,
        purchase_date,
        notes: notes || null,
        created_by: userId,
      };
      return repo.createPurchase(trx, header, lines);
    });
  },

  async listPurchases(params) {
    return repo.listPurchases(params);
  },

  async getPurchase(id) {
    const purchase = await repo.getPurchaseById(id);
    if (!purchase) throw new NotFoundError('Purchase not found.');
    return purchase;
  },

  // Record a mill-store purchase payment. With an `amount` it books a real
  // payment — a canonical `payments` row linked to the purchase's payable, the
  // method/account stamped on the purchase, and (for a bank/cash account) a
  // bank-balance movement + `bank_transactions` row — so the Finance payment
  // trail shows where/how it was paid. Status-only calls keep the legacy flip.
  async recordPurchasePayment(id, data, userId) {
    const purchase = await repo.getPurchaseById(id);
    if (!purchase) throw new NotFoundError('Purchase not found.');

    const amount = data.amount != null ? parseFloat(data.amount) : 0;
    // Legacy: status-only toggle (no amount) — just set the status.
    if (!amount) {
      const status = data.payment_status;
      const valid = ['Unpaid', 'Pending', 'Partial', 'Paid'];
      if (!valid.includes(status)) throw new ValidationError(`Payment status must be one of: ${valid.join(', ')}`);
      return repo.updatePurchasePayment(id, status);
    }

    return db.transaction(async (trx) => {
      const total = parseFloat(purchase.total_amount) || 0;
      const already = parseFloat(purchase.paid_amount) || 0;
      const outstanding = Math.max(0, total - already);
      if (amount > outstanding + 0.01) throw new ValidationError(`Amount exceeds the outstanding ${outstanding}.`);
      const newPaid = already + amount;
      const fullyPaid = total - newPaid <= 0.01;
      const status = fullyPaid ? 'Paid' : 'Partial';
      const method = data.payment_method || 'cash';
      const bankId = method === 'cash' ? (data.bank_account_id || null) : (data.bank_account_id || null);
      const payDate = data.payment_date || new Date();

      // A post-dated cheque records but does NOT settle the purchase until it
      // clears — insert the uncleared payment and stop.
      const isPostDated = method === 'cheque' && data.due_date && new Date(data.due_date) > new Date(new Date().toDateString());
      if (isPostDated) {
        const payable = await trx('payables').where(function () {
          this.where({ source_table: 'mill_purchases', source_id: parseInt(id, 10) }).orWhere('linked_ref', purchase.purchase_no);
        }).first();
        await trx('payments').insert({
          payment_no: await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'MP-PAY-', pad: 0 }),
          type: 'payment', amount, currency: 'PKR', fx_rate: 1, base_amount_pkr: amount,
          payment_method: method, bank_account_id: bankId, bank_reference: data.payment_reference || null,
          due_date: data.due_date || null, cleared: false,
          linked_payable_id: payable ? payable.id : null,
          source_table: 'mill_purchases', source_id: parseInt(id, 10), payment_date: payDate,
          notes: `Pending cheque for ${purchase.purchase_no}`, created_by: userId || null,
        });
        return trx('mill_purchases').where({ id }).first();
      }

      // Stamp the purchase with the latest payment + running paid_amount.
      await trx('mill_purchases').where({ id }).update({
        paid_amount: newPaid, payment_status: status,
        bank_account_id: bankId, payment_method: method,
        payment_reference: data.payment_reference || null, paid_date: fullyPaid ? payDate : null,
        updated_at: trx.fn.now(),
      });

      // Mirror to the linked payable (Money-Out reflects the same).
      const payable = await trx('payables').where(function () {
        this.where({ source_table: 'mill_purchases', source_id: parseInt(id, 10) })
          .orWhere('linked_ref', purchase.purchase_no);
      }).first();
      if (payable) {
        const pPaid = (parseFloat(payable.paid_amount) || 0) + amount;
        const pOrig = parseFloat(payable.original_amount) || 0;
        await trx('payables').where({ id: payable.id }).update({
          paid_amount: pPaid, outstanding: Math.max(0, pOrig - pPaid),
          status: pPaid >= pOrig - 0.01 ? 'Paid' : 'Partial', updated_at: trx.fn.now(),
        });
      }

      // Canonical payment record (this is what the trail reads via the payable).
      const [pay] = await trx('payments').insert({
        payment_no: await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'MP-PAY-', pad: 0 }),
        type: 'payment', amount, currency: 'PKR', fx_rate: 1, base_amount_pkr: amount,
        payment_method: method, bank_account_id: bankId,
        bank_reference: data.payment_reference || null, due_date: data.due_date || null,
        linked_payable_id: payable ? payable.id : null,
        payment_date: payDate, notes: `Payment for ${purchase.purchase_no}`, created_by: userId || null,
      }).returning('*');

      // Move the bank/cash account balance + sub-ledger row.
      if (bankId) {
        await trx('bank_accounts').where({ id: bankId }).decrement('current_balance', amount);
        const lastBt = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
        const seq = lastBt ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
        await trx('bank_transactions').insert({
          transaction_no: `BT-${String(seq).padStart(4, '0')}`, bank_account_id: bankId,
          type: 'debit', amount, currency: 'PKR', status: 'posted',
          transaction_date: payDate, reference: data.payment_reference || null,
          notes: `Payment for mill_store ${purchase.purchase_no}`, source: 'mill_purchase_payment',
          linked_payment_id: pay.id, created_by: userId || null,
        });
      }

      return trx('mill_purchases').where({ id }).first();
    });
  },

  // ─── Stock ───
  async getStockLevels(params) {
    return repo.getStockLevels(params);
  },

  async getStockAlerts() {
    return repo.getStockAlerts();
  },

  async getItemMovements(itemId, params) {
    const item = await repo.getItemById(itemId);
    if (!item) throw new NotFoundError('Item not found.');
    return repo.getItemMovements(itemId, params);
  },

  async setStock(id, data, userId) {
    const result = await repo.setStock(id, data, userId);
    if (!result) throw new NotFoundError('Item not found.');
    return result;
  },

  // ─── Forecast ───
  async getForecast() {
    return repo.getForecast();
  },

  // ─── Summary ───
  async getSummary() {
    return repo.getSummary();
  },

  // Per-size katta breakdown: where each KATTA-<kg> item's stock came from /
  // went — purchased, freed from milling, used to pack outputs, sold.
  async getKattaSummary() {
    const items = await db('mill_items as i')
      .leftJoin('mill_stock as s', function () { this.on('s.item_id', 'i.id').andOnNull('s.warehouse_id'); })
      .where('i.code', 'like', 'KATTA-%')
      .select('i.id', 'i.code', 'i.name', 'i.capacity_kg', 'i.avg_cost_per_unit', 'i.reorder_level', 's.quantity_available')
      .orderBy('i.capacity_kg');
    const n = (v) => parseFloat(v) || 0;
    const out = [];
    for (const it of items) {
      const movs = await db('mill_stock_movements').where('item_id', it.id).select('movement_type', 'reference_type', 'quantity');
      let purchased = 0, freed = 0, packed = 0, sold = 0, adjusted = 0;
      for (const m of movs) {
        const q = n(m.quantity), rt = m.reference_type;
        if (m.movement_type === 'purchase') purchased += q;
        else if (rt === 'batch_katta') { if (m.movement_type === 'return') freed += q; else packed += -q; }
        else if (rt === 'local_sale' || rt === 'local_sale_reversal') sold += -q; // consumption(−) sells, reversal(+) un-sells
        else adjusted += q;
      }
      out.push({
        id: it.id, code: it.code, size: Math.round(n(it.capacity_kg)),
        on_hand: n(it.quantity_available), purchased, freed, packed, sold, adjusted,
        avg_cost: n(it.avg_cost_per_unit), reorder_level: n(it.reorder_level),
      });
    }
    return out;
  },

  // ─── Adjustments ───
  async requestAdjustment(data, userId) {
    const item = await repo.getItemById(data.item_id);
    if (!item) throw new NotFoundError('Item not found.');
    return repo.createAdjustment({
      item_id: data.item_id,
      warehouse_id: data.warehouse_id || null,
      adjustment_type: data.adjustment_type,
      quantity_delta: data.quantity_delta,
      reason: data.reason,
      status: 'Pending',
      requested_by: userId,
    });
  },

  async listAdjustments(params) {
    return repo.listAdjustments(params);
  },

  async approveAdjustment(id, userId) {
    const adj = await repo.getAdjustmentById(id);
    if (!adj) throw new NotFoundError('Adjustment not found.');
    if (adj.status !== 'Pending') throw new ValidationError(`Cannot approve — status is ${adj.status}.`);
    return db.transaction(async (trx) => {
      return repo.approveAdjustment(trx, id, userId);
    });
  },

  async rejectAdjustment(id, userId, rejectionReason) {
    const adj = await repo.getAdjustmentById(id);
    if (!adj) throw new NotFoundError('Adjustment not found.');
    if (adj.status !== 'Pending') throw new ValidationError(`Cannot reject — status is ${adj.status}.`);
    if (!rejectionReason) throw new ValidationError('Rejection reason is required.');
    return repo.rejectAdjustment(id, userId, rejectionReason);
  },
};

module.exports = millStoreService;
