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
};

module.exports = millStoreRepo;
