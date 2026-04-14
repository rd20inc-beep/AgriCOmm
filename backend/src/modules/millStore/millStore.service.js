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
};

module.exports = millStoreService;
