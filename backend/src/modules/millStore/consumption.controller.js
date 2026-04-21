const consumptionService = require('./consumption.service');
const Joi = require('joi');
const { ValidationError } = require('../../shared/errors');

const consumptionLineSchema = Joi.object({
  item_id: Joi.number().integer().required(),
  quantity: Joi.number().greater(0).required(),
  warehouse_id: Joi.number().integer().allow(null).optional(),
});

const confirmSchema = Joi.object({
  lines: Joi.array().items(consumptionLineSchema).min(1).required(),
  allow_negative: Joi.boolean().default(false),
});

const consumptionController = {
  async suggest(req, res, next) {
    try {
      const result = await consumptionService.suggest(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  async confirm(req, res, next) {
    try {
      const { value, error } = confirmSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) throw new ValidationError(error.details.map((d) => d.message).join('; '));

      const result = await consumptionService.confirm(
        req.params.id,
        value.lines,
        req.user?.id,
        value.allow_negative
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  async history(req, res, next) {
    try {
      const result = await consumptionService.history(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};

module.exports = consumptionController;
