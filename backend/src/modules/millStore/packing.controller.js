const packingService = require('./packing.service');
const { packSchema } = require('./millStore.validator');
const { ValidationError } = require('../../shared/errors');

const packingController = {
  async pack(req, res, next) {
    try {
      const { value, error } = packSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) throw new ValidationError(error.details.map((d) => d.message).join('; '));

      const log = await packingService.pack(req.params.id, value, req.user?.id);
      res.status(201).json({ success: true, data: log });
    } catch (err) { next(err); }
  },

  async history(req, res, next) {
    try {
      const result = await packingService.history(req.params.id, req.user || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  // Body already validated by schemas.updatePackingRun (validate middleware).
  async updateRun(req, res, next) {
    try {
      const result = await packingService.updateRun(req.params.id, req.params.logId, req.body, req.user);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  async deleteRun(req, res, next) {
    try {
      const result = await packingService.deleteRun(req.params.id, req.params.logId, req.user);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  // Body already validated by schemas.batchPackSpec.
  async setPackSpec(req, res, next) {
    try {
      const result = await packingService.setPackSpec(req.params.id, req.body, req.user);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};

module.exports = packingController;
