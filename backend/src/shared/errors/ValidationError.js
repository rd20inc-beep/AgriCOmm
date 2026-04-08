const AppError = require('./AppError');

class ValidationError extends AppError {
  constructor(message = 'Validation error.', errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

module.exports = ValidationError;
