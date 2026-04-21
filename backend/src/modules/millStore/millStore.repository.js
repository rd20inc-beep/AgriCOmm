const db = require('../../config/database');

const millStoreRepo = {
  // ─── Items ───
  async listItems({ category, search, onlyLowStock, limit = 200, offset = 0 }) {
    const q = db('mill_items as mi')
      .leftJoin(
        db('mill_stock')
          .select('item_id')
          .sum({ quantity_available: 'quantity_available' })
          .sum({ quantity_reserved: 'quantity_reserved' })
          .groupBy('item_id')
          .as('ms'),
        'ms.item_id', 'mi.id'
      )
      .leftJoin('suppliers as sup', 'sup.id', 'mi.preferred_supplier_id')
      .leftJoin('bag_types as bt', 'bt.id', 'mi.bag_type_id')
      .select(
        'mi.*',
        db.raw('COALESCE(ms.quantity_available, 0) as quantity_available'),
        db.raw('COALESCE(ms.quantity_reserved, 0) as quantity_reserved'),
        'sup.name as preferred_supplier_name',
        'bt.name as bag_type_name'
      )
      .where('mi.is_active', true);

    if (category) q.where('mi.category', category);
    if (search) q.whereILike('mi.name', `%${search}%`);
    if (onlyLowStock) {
      q.whereRaw('COALESCE(ms.quantity_available, 0) <= mi.reorder_level');
    }

    const [items, totalRow] = await Promise.all([
      q.clone().orderBy('mi.name').limit(limit).offset(offset),
      q.clone().clearSelect().clearOrder().count({ c: 'mi.id' }).first(),
    ]);

    return { items, total: Number(totalRow?.c || 0) };
  },

  async getItemById(id) {
    const row = await db('mill_items as mi')
      .leftJoin('suppliers as sup', 'sup.id', 'mi.preferred_supplier_id')
      .leftJoin('bag_types as bt', 'bt.id', 'mi.bag_type_id')
      .select('mi.*', 'sup.name as preferred_supplier_name', 'bt.name as bag_type_name')
      .where('mi.id', id)
      .first();
    if (!row) return null;

    const stock = await db('mill_stock').where('item_id', id);
    return { ...row, stock_locations: stock };
  },

  async getItemByCode(code) {
    return db('mill_items').where('code', code).first();
  },

  async createItem(data) {
    const [row] = await db('mill_items').insert(data).returning('*');
    return row;
  },

  async updateItem(id, data) {
    const [row] = await db('mill_items')
      .where('id', id)
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return row;
  },

  async softDeleteItem(id) {
    await db('mill_items').where('id', id).update({ is_active: false, updated_at: db.fn.now() });
  },

  // ─── Consumption Ratios ───
  async listRatios({ itemId, productId } = {}) {
    const q = db('mill_consumption_ratios as r')
      .leftJoin('mill_items as mi', 'mi.id', 'r.item_id')
      .leftJoin('products as p', 'p.id', 'r.product_id')
      .select(
        'r.*',
        'mi.name as item_name',
        'mi.unit as item_unit',
        'p.name as product_name'
      )
      .where('r.is_active', true);

    if (itemId) q.where('r.item_id', itemId);
    if (productId != null) q.where('r.product_id', productId);
    return q.orderBy('mi.name');
  },

  async createRatio(data) {
    const [row] = await db('mill_consumption_ratios').insert(data).returning('*');
    return row;
  },

  async updateRatio(id, data) {
    const [row] = await db('mill_consumption_ratios').where('id', id).update(data).returning('*');
    return row;
  },

  async deleteRatio(id) {
    await db('mill_consumption_ratios').where('id', id).update({ is_active: false });
  },

  // ─── Purchases ───
  async generatePurchaseNo(trx) {
    const year = new Date().getFullYear();
    const prefix = `MP-${year}-`;
    const last = await trx('mill_purchases')
      .where('purchase_no', 'like', `${prefix}%`)
      .orderBy('id', 'desc')
      .select('purchase_no')
      .first();
    let seq = 1;
    if (last && last.purchase_no) {
      const n = parseInt(last.purchase_no.replace(prefix, ''), 10);
      if (!isNaN(n)) seq = n + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  },

  async createPurchase(trx, header, lines) {
    const [purchase] = await trx('mill_purchases').insert(header).returning('*');

    for (const line of lines) {
      line.purchase_id = purchase.id;
      line.total_cost = Number((line.quantity * line.cost_per_unit).toFixed(2));
      await trx('mill_purchase_items').insert(line);

      // Upsert stock
      const existing = await trx('mill_stock')
        .where({ item_id: line.item_id, warehouse_id: line.warehouse_id || null })
        .first();

      if (existing) {
        await trx('mill_stock')
          .where('id', existing.id)
          .update({
            quantity_available: db.raw('quantity_available + ?', [line.quantity]),
            updated_at: trx.fn.now(),
          });
      } else {
        await trx('mill_stock').insert({
          item_id: line.item_id,
          warehouse_id: line.warehouse_id || null,
          quantity_available: line.quantity,
          quantity_reserved: 0,
        });
      }

      // Stock movement
      await trx('mill_stock_movements').insert({
        item_id: line.item_id,
        warehouse_id: line.warehouse_id || null,
        movement_type: 'purchase',
        quantity: line.quantity,
        cost_per_unit: line.cost_per_unit,
        total_cost: line.total_cost,
        reference_type: 'purchase',
        reference_id: purchase.id,
        performed_by: header.created_by,
      });

      // Weighted-average cost update
      const item = await trx('mill_items').where('id', line.item_id).first();
      const totalStock = await trx('mill_stock').where('item_id', line.item_id)
        .sum({ total: 'quantity_available' }).first();
      const currentQty = Number(totalStock?.total || 0);
      const prevAvg = Number(item.avg_cost_per_unit) || 0;
      const prevQty = Math.max(0, currentQty - line.quantity);
      const newAvg = prevQty + line.quantity > 0
        ? ((prevQty * prevAvg) + (line.quantity * line.cost_per_unit)) / (prevQty + line.quantity)
        : line.cost_per_unit;

      await trx('mill_items').where('id', line.item_id).update({
        avg_cost_per_unit: Number(newAvg.toFixed(4)),
        last_purchase_cost: line.cost_per_unit,
        updated_at: trx.fn.now(),
      });
    }

    // Update purchase total
    const totalAmount = lines.reduce((s, l) => s + (l.quantity * l.cost_per_unit), 0);
    await trx('mill_purchases').where('id', purchase.id).update({ total_amount: Number(totalAmount.toFixed(2)) });
    purchase.total_amount = Number(totalAmount.toFixed(2));

    return purchase;
  },

  async listPurchases({ supplierId, paymentStatus, limit = 50, offset = 0 }) {
    const q = db('mill_purchases as mp')
      .leftJoin('suppliers as s', 's.id', 'mp.supplier_id')
      .leftJoin('users as u', 'u.id', 'mp.created_by')
      .select(
        'mp.*',
        's.name as supplier_name',
        'u.full_name as created_by_name'
      );

    if (supplierId) q.where('mp.supplier_id', supplierId);
    if (paymentStatus) q.where('mp.payment_status', paymentStatus);

    const [items, totalRow] = await Promise.all([
      q.clone().orderBy('mp.created_at', 'desc').limit(limit).offset(offset),
      q.clone().clearSelect().clearOrder().count({ c: 'mp.id' }).first(),
    ]);
    return { items, total: Number(totalRow?.c || 0) };
  },

  async getPurchaseById(id) {
    const purchase = await db('mill_purchases as mp')
      .leftJoin('suppliers as s', 's.id', 'mp.supplier_id')
      .select('mp.*', 's.name as supplier_name')
      .where('mp.id', id)
      .first();
    if (!purchase) return null;

    const lines = await db('mill_purchase_items as li')
      .leftJoin('mill_items as mi', 'mi.id', 'li.item_id')
      .select('li.*', 'mi.name as item_name', 'mi.code as item_code', 'mi.unit as item_unit')
      .where('li.purchase_id', id);
    return { ...purchase, lines };
  },

  async updatePurchasePayment(id, paymentStatus) {
    const [row] = await db('mill_purchases')
      .where('id', id)
      .update({ payment_status: paymentStatus, updated_at: db.fn.now() })
      .returning('*');
    return row;
  },

  // ─── Stock ───
  async getStockLevels({ category, warehouseId, onlyLowStock } = {}) {
    const q = db('mill_stock as ms')
      .join('mill_items as mi', 'mi.id', 'ms.item_id')
      .leftJoin('warehouses as w', 'w.id', 'ms.warehouse_id')
      .select(
        'ms.*',
        'mi.code as item_code',
        'mi.name as item_name',
        'mi.category',
        'mi.unit',
        'mi.reorder_level',
        'mi.avg_cost_per_unit',
        'w.name as warehouse_name',
        db.raw('ROUND(ms.quantity_available * COALESCE(mi.avg_cost_per_unit, 0), 2) as stock_value')
      )
      .where('mi.is_active', true);

    if (category) q.where('mi.category', category);
    if (warehouseId) q.where('ms.warehouse_id', warehouseId);
    if (onlyLowStock) q.whereRaw('ms.quantity_available <= mi.reorder_level');

    return q.orderBy('mi.name');
  },

  async getStockAlerts() {
    return db('mill_stock as ms')
      .join('mill_items as mi', 'mi.id', 'ms.item_id')
      .leftJoin('warehouses as w', 'w.id', 'ms.warehouse_id')
      .select(
        'ms.item_id',
        'mi.code as item_code',
        'mi.name as item_name',
        'mi.category',
        'mi.unit',
        'mi.reorder_level',
        'mi.preferred_supplier_id',
        'w.name as warehouse_name',
        db.raw('SUM(ms.quantity_available) as total_available')
      )
      .where('mi.is_active', true)
      .groupBy('ms.item_id', 'mi.code', 'mi.name', 'mi.category', 'mi.unit', 'mi.reorder_level', 'mi.preferred_supplier_id', 'w.name')
      .havingRaw('SUM(ms.quantity_available) <= mi.reorder_level')
      .orderByRaw('SUM(ms.quantity_available) - mi.reorder_level ASC');
  },

  async getItemMovements(itemId, { limit = 100, offset = 0 } = {}) {
    return db('mill_stock_movements as m')
      .leftJoin('users as u', 'u.id', 'm.performed_by')
      .leftJoin('warehouses as w', 'w.id', 'm.warehouse_id')
      .select('m.*', 'u.full_name as performed_by_name', 'w.name as warehouse_name')
      .where('m.item_id', itemId)
      .orderBy('m.created_at', 'desc')
      .limit(limit)
      .offset(offset);
  },

  // ─── Forecast ───
  async getForecast() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get all active items with current stock
    const items = await db('mill_items as mi')
      .leftJoin(
        db('mill_stock')
          .select('item_id')
          .sum({ qty: 'quantity_available' })
          .groupBy('item_id')
          .as('ms'),
        'ms.item_id', 'mi.id'
      )
      .select('mi.id', 'mi.code', 'mi.name', 'mi.category', 'mi.unit', 'mi.reorder_level',
        db.raw('COALESCE(ms.qty, 0) as on_hand'))
      .where('mi.is_active', true);

    // Get consumption per item in last 30 days
    const consumption = await db('mill_stock_movements')
      .select('item_id')
      .sum(db.raw('ABS(quantity) as total_consumed'))
      .where('movement_type', 'consumption')
      .where('created_at', '>=', thirtyDaysAgo)
      .groupBy('item_id');

    const consumptionMap = Object.fromEntries(
      consumption.map(c => [c.item_id, Number(c.total_consumed) || 0])
    );

    return items.map(item => {
      const consumed30d = consumptionMap[item.id] || 0;
      const dailyRate = consumed30d / 30;
      const onHand = Number(item.on_hand);
      const daysUntilEmpty = dailyRate > 0 ? Math.round(onHand / dailyRate) : null;
      const daysUntilReorder = dailyRate > 0
        ? Math.round((onHand - Number(item.reorder_level)) / dailyRate)
        : null;

      return {
        item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        category: item.category,
        unit: item.unit,
        on_hand: onHand,
        reorder_level: Number(item.reorder_level),
        consumed_30d: consumed30d,
        daily_consumption_rate: Number(dailyRate.toFixed(3)),
        days_until_empty: daysUntilEmpty,
        days_until_reorder: daysUntilReorder,
        risk: daysUntilEmpty !== null && daysUntilEmpty <= 7 ? 'critical'
          : daysUntilReorder !== null && daysUntilReorder <= 7 ? 'warning'
          : 'ok',
      };
    }).filter(i => i.consumed_30d > 0 || i.on_hand > 0)
      .sort((a, b) => {
        if (a.risk === 'critical' && b.risk !== 'critical') return -1;
        if (a.risk !== 'critical' && b.risk === 'critical') return 1;
        if (a.risk === 'warning' && b.risk === 'ok') return -1;
        if (a.risk === 'ok' && b.risk === 'warning') return 1;
        return (a.days_until_empty ?? 999) - (b.days_until_empty ?? 999);
      });
  },

  // ─── Summary (for dashboard) ───
  async getSummary() {
    const [itemCount, lowStockCount, stockValue, recentPurchases, recentConsumption] = await Promise.all([
      db('mill_items').where('is_active', true).count({ c: 'id' }).first(),
      db('mill_stock as ms')
        .join('mill_items as mi', 'mi.id', 'ms.item_id')
        .where('mi.is_active', true)
        .whereRaw('ms.quantity_available <= mi.reorder_level')
        .countDistinct({ c: 'ms.item_id' })
        .first(),
      db('mill_stock as ms')
        .join('mill_items as mi', 'mi.id', 'ms.item_id')
        .where('mi.is_active', true)
        .select(db.raw('COALESCE(SUM(ms.quantity_available * COALESCE(mi.avg_cost_per_unit, 0)), 0) as total'))
        .first(),
      db('mill_purchases').orderBy('created_at', 'desc').limit(5),
      db('mill_stock_movements')
        .where('movement_type', 'consumption')
        .orderBy('created_at', 'desc')
        .limit(5),
    ]);

    return {
      total_items: Number(itemCount?.c || 0),
      low_stock_items: Number(lowStockCount?.c || 0),
      stock_value: Number(stockValue?.total || 0),
      recent_purchases: recentPurchases,
      recent_consumption: recentConsumption,
    };
  },

  // ─── Adjustments ───
  async createAdjustment(data) {
    const [row] = await db('mill_stock_adjustments').insert(data).returning('*');
    return row;
  },

  async listAdjustments({ status, itemId, limit = 100, offset = 0 } = {}) {
    const q = db('mill_stock_adjustments as a')
      .join('mill_items as mi', 'mi.id', 'a.item_id')
      .leftJoin('warehouses as w', 'w.id', 'a.warehouse_id')
      .leftJoin('users as req', 'req.id', 'a.requested_by')
      .leftJoin('users as apr', 'apr.id', 'a.approved_by')
      .select(
        'a.*',
        'mi.code as item_code',
        'mi.name as item_name',
        'mi.unit as item_unit',
        'mi.category as item_category',
        'w.name as warehouse_name',
        'req.full_name as requested_by_name',
        'apr.full_name as approved_by_name'
      );

    if (status) q.where('a.status', status);
    if (itemId) q.where('a.item_id', itemId);

    const [items, totalRow] = await Promise.all([
      q.clone().orderBy('a.created_at', 'desc').limit(limit).offset(offset),
      q.clone().clearSelect().clearOrder().count({ c: 'a.id' }).first(),
    ]);
    return { items, total: Number(totalRow?.c || 0) };
  },

  async getAdjustmentById(id) {
    return db('mill_stock_adjustments as a')
      .join('mill_items as mi', 'mi.id', 'a.item_id')
      .leftJoin('warehouses as w', 'w.id', 'a.warehouse_id')
      .leftJoin('users as req', 'req.id', 'a.requested_by')
      .leftJoin('users as apr', 'apr.id', 'a.approved_by')
      .select(
        'a.*',
        'mi.code as item_code',
        'mi.name as item_name',
        'mi.unit as item_unit',
        'w.name as warehouse_name',
        'req.full_name as requested_by_name',
        'apr.full_name as approved_by_name'
      )
      .where('a.id', id)
      .first();
  },

  async approveAdjustment(trx, id, approvedBy) {
    const adj = await trx('mill_stock_adjustments').where('id', id).first();
    if (!adj) return null;

    // Update adjustment status
    await trx('mill_stock_adjustments').where('id', id).update({
      status: 'Approved',
      approved_by: approvedBy,
      approved_at: trx.fn.now(),
    });

    const delta = Number(adj.quantity_delta);
    const warehouseId = adj.warehouse_id || null;

    // Apply stock change
    const stockRow = await trx('mill_stock')
      .where({ item_id: adj.item_id, warehouse_id: warehouseId })
      .first();

    if (stockRow) {
      const newQty = Math.max(0, Number(stockRow.quantity_available) + delta);
      await trx('mill_stock').where('id', stockRow.id).update({
        quantity_available: newQty,
        updated_at: trx.fn.now(),
      });
    } else if (delta > 0) {
      await trx('mill_stock').insert({
        item_id: adj.item_id,
        warehouse_id: warehouseId,
        quantity_available: delta,
        quantity_reserved: 0,
      });
    }

    // Record movement
    const item = await trx('mill_items').where('id', adj.item_id).first();
    const costPerUnit = Number(item?.avg_cost_per_unit) || 0;
    await trx('mill_stock_movements').insert({
      item_id: adj.item_id,
      warehouse_id: warehouseId,
      movement_type: 'adjustment',
      quantity: delta,
      cost_per_unit: costPerUnit,
      total_cost: Number((Math.abs(delta) * costPerUnit).toFixed(2)),
      reference_type: 'adjustment',
      reference_id: id,
      reason: adj.reason,
      performed_by: adj.requested_by,
      approved_by: approvedBy,
    });

    return trx('mill_stock_adjustments as a')
      .join('mill_items as mi', 'mi.id', 'a.item_id')
      .select('a.*', 'mi.name as item_name', 'mi.code as item_code')
      .where('a.id', id)
      .first();
  },

  async rejectAdjustment(id, approvedBy, rejectionReason) {
    const [row] = await db('mill_stock_adjustments').where('id', id).update({
      status: 'Rejected',
      approved_by: approvedBy,
      approved_at: db.fn.now(),
      rejection_reason: rejectionReason,
    }).returning('*');
    return row;
  },
};

module.exports = millStoreRepo;
