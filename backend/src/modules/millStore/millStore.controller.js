const service = require('./millStore.service');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');
const {
  createItemSchema,
  updateItemSchema,
  createRatioSchema,
  updateRatioSchema,
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
};

module.exports = millStoreController;
