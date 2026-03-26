const winston = require('winston');
const { captureException } = require('../utils/errorReporter');

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

function errorHandler(err, req, res, _next) {
  logger.error({
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
  });

  // Report to error monitoring (Sentry-ready)
  captureException(err, {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
  });

  // Joi validation error
  if (err.isJoi || err.name === 'ValidationError') {
    const errors = err.details
      ? err.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
      : [{ message: err.message }];

    return res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token has expired.',
    });
  }

  // Knex / PostgreSQL errors
  if (err.code && typeof err.code === 'string' && err.code.length === 5) {
    // Unique violation
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A record with that value already exists.',
      });
    }

    // Foreign key violation
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        message: 'Referenced record does not exist.',
      });
    }

    // Not-null violation
    if (err.code === '23502') {
      return res.status(400).json({
        success: false,
        message: `Missing required field: ${err.column || 'unknown'}.`,
      });
    }

    // Generic database error
    return res.status(500).json({
      success: false,
      message: 'A database error occurred.',
    });
  }

  // Custom errors with status code
  const statusCode = err.statusCode || err.status || 500;
  const message =
    statusCode === 500 ? 'Internal server error.' : err.message;

  return res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && statusCode === 500
      ? { errors: [{ message: err.message, stack: err.stack }] }
      : {}),
  });
}

module.exports = errorHandler;
