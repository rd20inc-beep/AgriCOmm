const db = require('../../config/database');
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
  async createPurchase({ supplier_id, invoice_number, purchase_date, notes, lines }, userId) {
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
      const purchaseNo = await repo.generatePurchaseNo(trx);
      const header = {
        purchase_no: purchaseNo,
        supplier_id,
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

  async updatePurchasePayment(id, paymentStatus) {
    const valid = ['Unpaid', 'Partial', 'Paid'];
    if (!valid.includes(paymentStatus)) throw new ValidationError(`Payment status must be one of: ${valid.join(', ')}`);
    const purchase = await repo.getPurchaseById(id);
    if (!purchase) throw new NotFoundError('Purchase not found.');
    return repo.updatePurchasePayment(id, paymentStatus);
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

  // ─── Summary ───
  async getSummary() {
    return repo.getSummary();
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
