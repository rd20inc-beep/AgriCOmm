const db = require('../../config/database');
const repo = require('./millStore.repository');
const { classifyPackaging, deriveSizeFromLabel, sizeToKg, hasCapacity, isMissingSize } = require('../../shared/packagingTypes');

/**
 * Fill in what a packaging item states about itself but was not asked for.
 *
 * Migration 057 seeded eleven bags whose size is written in their own name and
 * stored none of it, because capacity_kg was never set — and capacity_kg is what
 * pack() requires before it will pack and what the stock report divides by to
 * count bags. Migration 310 repaired those rows; this is what stops the next one
 * arriving in the same state.
 *
 * Only ever fills BLANKS. Anything the caller sends wins, so a measured capacity
 * or a deliberate type is never overwritten by a guess from a name.
 */
function packagingDefaults(item) {
  if (!item || item.category !== 'packaging') return {};
  const out = {};
  const packType = item.pack_type || classifyPackaging(item);
  if (!item.pack_type && packType) out.pack_type = packType;

  const size = deriveSizeFromLabel(item);
  if (size) {
    // ZERO counts as missing, not as a measurement — no bag holds nothing, and
    // pack() refuses on `capacity <= 0` exactly as it does on null.
    if (isMissingSize(item.size_value)) { out.size_value = size.value; out.size_unit = size.unit; }
    // A capacity is kg of rice held, so it belongs on a sack, a retail bag or a
    // master — never on a sheet, a label or a roll of thread.
    if (isMissingSize(item.capacity_kg) && hasCapacity(packType)) {
      out.capacity_kg = sizeToKg(size.value, size.unit);
    }
  }
  return out;
}
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
    return repo.createItem({ ...packagingDefaults(data), ...data, created_by: userId });
  },

  async updateItem(id, data) {
    const existing = await repo.getItemById(id);
    if (!existing) throw new NotFoundError('Item not found.');
    // Derive from the MERGED row: a rename can reveal a size, and a type that was
    // never set should be filled in rather than left for a later migration.
    const derived = packagingDefaults({ ...existing, ...data });
    return repo.updateItem(id, { ...derived, ...data });
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
    // The status check lives inside the transaction, on a locked row (see
    // repo.approveAdjustment), so two approvals cannot both apply the delta.
    return db.transaction(async (trx) => {
      return repo.approveAdjustment(trx, id, userId);
    });
  },

  async rejectAdjustment(id, userId, rejectionReason) {
    if (!rejectionReason) throw new ValidationError('Rejection reason is required.');
    return repo.rejectAdjustment(id, userId, rejectionReason);
  },
};

module.exports = millStoreService;
