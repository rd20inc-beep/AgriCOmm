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
      const result = await packingService.history(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};

module.exports = packingController;
