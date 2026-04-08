const AppError = require('./AppError');

class ConflictError extends AppError {
  constructor(message = 'A record with that value already exists.') {
    super(message, 409);
  }
}

module.exports = ConflictError;
