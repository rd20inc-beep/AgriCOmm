const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  full_name: Joi.string().required(),
  role_id: Joi.number().integer().optional(),
});

const changePasswordSchema = Joi.object({
  old_password: Joi.string().required(),
  new_password: Joi.string().min(8).required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  new_password: Joi.string().min(8).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const updateProfileSchema = Joi.object({
  full_name: Joi.string().required(),
});

module.exports = {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  resetPasswordSchema,
  forgotPasswordSchema,
  updateProfileSchema,
};
