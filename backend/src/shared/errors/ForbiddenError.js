const AppError = require('./AppError');

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden. You do not have permission to perform this action.') {
    super(message, 403);
  }
}

module.exports = ForbiddenError;
