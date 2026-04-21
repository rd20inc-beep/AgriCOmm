const service = require('./millStore.service');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');
const {
  createItemSchema,
  updateItemSchema,
  createRatioSchema,
  updateRatioSchema,
  createPurchaseSchema,
  updatePaymentSchema,
  requestAdjustmentSchema,
  rejectAdjustmentSchema,
} = require('./millStore.validator');
const { ValidationError } = require('../../shared/errors');

function validate(schema, body) {
  const { value, error } = schema.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(error.details.map((d) => d.message).join('; '));
  return value;
}

const millStoreController = {
  // ─── Items ───
  async listItems(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { category, search, low_stock } = req.query;
      const result = await service.listItems({
        category,
        search,
        onlyLowStock: low_stock === '1' || low_stock === 'true',
        limit,
        offset,
      });
      res.json({
        success: true,
        data: {
          items: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) { next(err); }
  },

  async getItem(req, res, next) {
    try {
      const item = await service.getItem(req.params.id);
      res.json({ success: true, data: { item } });
    } catch (err) { next(err); }
  },

  async createItem(req, res, next) {
    try {
      const data = validate(createItemSchema, req.body);
      const item = await service.createItem(data, req.user?.id);
      res.status(201).json({ success: true, data: { item } });
    } catch (err) { next(err); }
  },

  async updateItem(req, res, next) {
    try {
      const data = validate(updateItemSchema, req.body);
      const item = await service.updateItem(req.params.id, data);
      res.json({ success: true, data: { item } });
    } catch (err) { next(err); }
  },

  async deleteItem(req, res, next) {
    try {
      await service.deleteItem(req.params.id);
      res.json({ success: true, message: 'Item deactivated.' });
    } catch (err) { next(err); }
  },

  // ─── Ratios ───
  async listRatios(req, res, next) {
    try {
      const { item_id, product_id } = req.query;
      const ratios = await service.listRatios({
        itemId: item_id ? Number(item_id) : undefined,
        productId: product_id !== undefined ? (product_id === 'null' ? null : Number(product_id)) : undefined,
      });
      res.json({ success: true, data: { ratios } });
    } catch (err) { next(err); }
  },

  async createRatio(req, res, next) {
    try {
      const data = validate(createRatioSchema, req.body);
      const ratio = await service.createRatio(data);
      res.status(201).json({ success: true, data: { ratio } });
    } catch (err) { next(err); }
  },

  async updateRatio(req, res, next) {
    try {
      const data = validate(updateRatioSchema, req.body);
      const ratio = await service.updateRatio(req.params.id, data);
      res.json({ success: true, data: { ratio } });
    } catch (err) { next(err); }
  },

  async deleteRatio(req, res, next) {
    try {
      await service.deleteRatio(req.params.id);
      res.json({ success: true, message: 'Ratio deactivated.' });
    } catch (err) { next(err); }
  },

  // ─── Purchases ───
  async createPurchase(req, res, next) {
    try {
      const data = validate(createPurchaseSchema, req.body);
      const purchase = await service.createPurchase(data, req.user?.id);
      res.status(201).json({ success: true, data: { purchase } });
    } catch (err) { next(err); }
  },

  async listPurchases(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { supplier_id, payment_status } = req.query;
      const result = await service.listPurchases({
        supplierId: supplier_id ? Number(supplier_id) : undefined,
        paymentStatus: payment_status,
        limit,
        offset,
      });
      res.json({
        success: true,
        data: {
          purchases: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) { next(err); }
  },

  async getPurchase(req, res, next) {
    try {
      const purchase = await service.getPurchase(req.params.id);
      res.json({ success: true, data: { purchase } });
    } catch (err) { next(err); }
  },

  async updatePurchasePayment(req, res, next) {
    try {
      const data = validate(updatePaymentSchema, req.body);
      const purchase = await service.updatePurchasePayment(req.params.id, data.payment_status);
      res.json({ success: true, data: { purchase } });
    } catch (err) { next(err); }
  },

  // ─── Stock ───
  async getStockLevels(req, res, next) {
    try {
      const { category, warehouse_id, low_stock } = req.query;
      const stock = await service.getStockLevels({
        category,
        warehouseId: warehouse_id ? Number(warehouse_id) : undefined,
        onlyLowStock: low_stock === '1' || low_stock === 'true',
      });
      res.json({ success: true, data: { stock } });
    } catch (err) { next(err); }
  },

  async getStockAlerts(req, res, next) {
    try {
      const alerts = await service.getStockAlerts();
      res.json({ success: true, data: { alerts } });
    } catch (err) { next(err); }
  },

  async getItemMovements(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query, 100);
      const movements = await service.getItemMovements(req.params.id, { limit, offset });
      res.json({ success: true, data: { movements } });
    } catch (err) { next(err); }
  },

  // ─── Summary ───
  async getSummary(req, res, next) {
    try {
      const summary = await service.getSummary();
      res.json({ success: true, data: { summary } });
    } catch (err) { next(err); }
  },

  async getForecast(req, res, next) {
    try {
      const forecast = await service.getForecast();
      res.json({ success: true, data: { forecast } });
    } catch (err) { next(err); }
  },

  // ─── Adjustments ───
  async requestAdjustment(req, res, next) {
    try {
      const data = validate(requestAdjustmentSchema, req.body);
      const adj = await service.requestAdjustment(data, req.user?.id);
      res.status(201).json({ success: true, data: { adjustment: adj } });
    } catch (err) { next(err); }
  },

  async listAdjustments(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { status, item_id } = req.query;
      const result = await service.listAdjustments({
        status,
        itemId: item_id ? Number(item_id) : undefined,
        limit,
        offset,
      });
      res.json({
        success: true,
        data: {
          adjustments: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) { next(err); }
  },

  async approveAdjustment(req, res, next) {
    try {
      const adj = await service.approveAdjustment(req.params.id, req.user?.id);
      res.json({ success: true, data: { adjustment: adj } });
    } catch (err) { next(err); }
  },

  async rejectAdjustment(req, res, next) {
    try {
      const data = validate(rejectAdjustmentSchema, req.body);
      const adj = await service.rejectAdjustment(req.params.id, req.user?.id, data.rejection_reason);
      res.json({ success: true, data: { adjustment: adj } });
    } catch (err) { next(err); }
  },
};

module.exports = millStoreController;
