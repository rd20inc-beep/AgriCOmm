const db = require('../config/database');
const inventoryService = require('../services/inventoryService');

const inventoryController = {
  /**
   * GET / — List all lots with filters
   */
  async listLots(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        entity,
        warehouse_id,
        status,
        search,
      } = req.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('inventory_lots as il')
        .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
        .leftJoin('products as p', 'il.product_id', 'p.id')
        .leftJoin('suppliers as s', 'il.supplier_id', 's.id')
        .select(
          'il.*',
          'w.name as warehouse_name',
          'p.name as product_name',
          's.name as supplier_name'
        );

      if (type) query = query.where('il.type', type);
      if (entity) query = query.where('il.entity', entity);
      if (warehouse_id) query = query.where('il.warehouse_id', warehouse_id);
      if (status) query = query.where('il.status', status);
      if (search) {
        query = query.where(function () {
          this.where('il.lot_no', 'ilike', `%${search}%`)
            .orWhere('il.item_name', 'ilike', `%${search}%`)
            .orWhere('il.batch_ref', 'ilike', `%${search}%`);
        });
      }

      const countQuery = query
        .clone()
        .clearSelect()
        .clearOrder()
        .count('il.id as total')
        .first();

      const [lots, countResult] = await Promise.all([
        query.orderBy('il.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          lots,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Inventory listLots error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * GET /summary — Stock summary
   */
  async getSummary(req, res) {
    try {
      const summary = await inventoryService.getStockSummary();
      return res.json({ success: true, data: summary });
    } catch (err) {
      console.error('Inventory getSummary error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * GET /lots/:id — Lot detail with movement history
   */
  async getLotById(req, res) {
    try {
      const { id } = req.params;

      const lot = await inventoryService.getLotById(id);
      if (!lot) {
        return res.status(404).json({ success: false, message: 'Lot not found.' });
      }

      const movements = await inventoryService.getMovementsByLot(id);

      const reservations = await db('inventory_reservations as ir')
        .leftJoin('export_orders as eo', 'ir.order_id', 'eo.id')
        .select('ir.*', 'eo.order_no')
        .where('ir.lot_id', id)
        .orderBy('ir.created_at', 'desc');

      return res.json({
        success: true,
        data: { lot, movements, reservations },
      });
    } catch (err) {
      console.error('Inventory getLotById error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * GET /lots/:id/movements — Movements for a lot
   */
  async getLotMovements(req, res) {
    try {
      const { id } = req.params;

      const lot = await db('inventory_lots').where('id', id).first();
      if (!lot) {
        return res.status(404).json({ success: false, message: 'Lot not found.' });
      }

      const movements = await inventoryService.getMovementsByLot(id);

      return res.json({
        success: true,
        data: { movements },
      });
    } catch (err) {
      console.error('Inventory getLotMovements error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * GET /movements — All movements with filters
   */
  async listMovements(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        movement_type,
        date_from,
        date_to,
        batch_id,
        order_id,
      } = req.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('inventory_movements as im')
        .leftJoin('inventory_lots as il', 'im.lot_id', 'il.id')
        .select(
          'im.*',
          'il.lot_no',
          'il.item_name'
        );

      if (movement_type) query = query.where('im.movement_type', movement_type);
      if (batch_id) query = query.where('im.batch_id', batch_id);
      if (order_id) query = query.where('im.order_id', order_id);
      if (date_from) query = query.where('im.created_at', '>=', date_from);
      if (date_to) query = query.where('im.created_at', '<=', date_to);

      const countQuery = query
        .clone()
        .clearSelect()
        .clearOrder()
        .count('im.id as total')
        .first();

      const [movements, countResult] = await Promise.all([
        query.orderBy('im.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          movements,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Inventory listMovements error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * POST /lots — Create a new lot manually
   */
  async createLot(req, res) {
    try {
      const {
        item_name,
        type,
        entity,
        warehouse_id,
        qty,
        unit,
        product_id,
        batch_ref,
        cost_per_unit,
        cost_currency,
      } = req.body;

      if (!item_name || !qty) {
        return res.status(400).json({
          success: false,
          message: 'item_name and qty are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        return inventoryService.createLot(trx, {
          itemName: item_name,
          type: type || 'raw',
          entity: entity || 'mill',
          warehouseId: warehouse_id || null,
          qty: parseFloat(qty),
          unit: unit || 'MT',
          productId: product_id || null,
          batchRef: batch_ref || null,
          costPerUnit: parseFloat(cost_per_unit) || 0,
          costCurrency: cost_currency || 'PKR',
          userId: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('Inventory createLot error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  /**
   * POST /movements — Record a manual movement
   */
  async createMovement(req, res) {
    try {
      const {
        movement_type,
        lot_id,
        qty,
        from_warehouse_id,
        to_warehouse_id,
        source_entity,
        dest_entity,
        linked_ref,
        notes,
        cost_per_unit,
        currency,
        batch_id,
        order_id,
        transfer_id,
      } = req.body;

      if (!movement_type || !lot_id || !qty) {
        return res.status(400).json({
          success: false,
          message: 'movement_type, lot_id, and qty are required.',
        });
      }

      const movement = await db.transaction(async (trx) => {
        return inventoryService.postMovement(trx, {
          movementType: movement_type,
          lotId: lot_id,
          qty: parseFloat(qty),
          fromWarehouseId: from_warehouse_id || null,
          toWarehouseId: to_warehouse_id || null,
          sourceEntity: source_entity || null,
          destEntity: dest_entity || null,
          linkedRef: linked_ref || null,
          notes: notes || null,
          costPerUnit: parseFloat(cost_per_unit) || 0,
          currency: currency || 'PKR',
          batchId: batch_id || null,
          orderId: order_id || null,
          transferId: transfer_id || null,
          userId: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: { movement },
      });
    } catch (err) {
      console.error('Inventory createMovement error:', err);
      const statusCode = err.message.includes('Insufficient stock') ? 400 : 500;
      return res.status(statusCode).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  /**
   * POST /adjust — Stock adjustment (+/-)
   */
  async adjustStock(req, res) {
    try {
      const { lot_id, adjustment_qty, reason } = req.body;

      if (!lot_id || adjustment_qty == null) {
        return res.status(400).json({
          success: false,
          message: 'lot_id and adjustment_qty are required.',
        });
      }

      const movement = await db.transaction(async (trx) => {
        return inventoryService.adjustStock(trx, {
          lotId: lot_id,
          adjustmentQty: parseFloat(adjustment_qty),
          reason: reason || null,
          userId: req.user.id,
        });
      });

      return res.json({
        success: true,
        data: { movement },
      });
    } catch (err) {
      console.error('Inventory adjustStock error:', err);
      const statusCode = err.message.includes('Insufficient stock') ? 400 : 500;
      return res.status(statusCode).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  /**
   * POST /reserve — Reserve stock against an order
   */
  async reserveStock(req, res) {
    try {
      const { lot_id, order_id, qty } = req.body;

      if (!lot_id || !order_id || !qty) {
        return res.status(400).json({
          success: false,
          message: 'lot_id, order_id, and qty are required.',
        });
      }

      const reservation = await db.transaction(async (trx) => {
        return inventoryService.reserveStock(trx, {
          lotId: lot_id,
          orderId: order_id,
          qtyMT: parseFloat(qty),
          userId: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: { reservation },
      });
    } catch (err) {
      console.error('Inventory reserveStock error:', err);
      const statusCode = err.message.includes('Insufficient') ? 400 : 500;
      return res.status(statusCode).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  /**
   * POST /release/:id — Release a reservation
   */
  async releaseReservation(req, res) {
    try {
      const { id } = req.params;

      const result = await db.transaction(async (trx) => {
        return inventoryService.releaseReservation(trx, {
          reservationId: id,
          userId: req.user.id,
        });
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('Inventory releaseReservation error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  /**
   * GET /reservations — List all active reservations
   */
  async listReservations(req, res) {
    try {
      const { status = 'Active', page = 1, limit = 50 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('inventory_reservations as ir')
        .leftJoin('inventory_lots as il', 'ir.lot_id', 'il.id')
        .leftJoin('export_orders as eo', 'ir.order_id', 'eo.id')
        .select(
          'ir.*',
          'il.lot_no',
          'il.item_name',
          'il.warehouse_id',
          'eo.order_no'
        );

      if (status) {
        query = query.where('ir.status', status);
      }

      const countQuery = query
        .clone()
        .clearSelect()
        .clearOrder()
        .count('ir.id as total')
        .first();

      const [reservations, countResult] = await Promise.all([
        query.orderBy('ir.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          reservations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Inventory listReservations error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = inventoryController;
