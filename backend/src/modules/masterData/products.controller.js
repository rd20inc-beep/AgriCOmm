const masterDataService = require('./masterData.service');
const { parsePagination, paginationMeta } = require('../../shared/utils/pagination');

const productsController = {
  async list(req, res, next) {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { search } = req.query;
      const result = await masterDataService.listProducts({ page, limit, offset, search });
      return res.json({
        success: true,
        data: {
          products: result.items,
          pagination: paginationMeta(result.total, page, limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await masterDataService.getProductById(req.params.id);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = productsController;
