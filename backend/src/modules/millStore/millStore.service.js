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
};

module.exports = millStoreService;
