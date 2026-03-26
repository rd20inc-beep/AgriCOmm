/**
 * Error Reporter - RiceFlow ERP
 *
 * A pluggable error reporting module. By default, errors are logged via
 * Winston. To switch to Sentry, uncomment the Sentry sections below and
 * install the SDK:
 *
 *   npm install @sentry/node
 */

const winston = require('winston');

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// ----- Sentry integration (uncomment to enable) -----
// const Sentry = require('@sentry/node');

/**
 * Initialise error reporting. Call once at application startup.
 *
 * @param {object} [options]
 * @param {string} [options.dsn]          - Sentry DSN (ignored when using console logger)
 * @param {string} [options.environment]  - e.g. "production", "staging"
 */
function initErrorReporting(options = {}) {
  // ----- Sentry init (uncomment to enable) -----
  // Sentry.init({
  //   dsn: options.dsn || process.env.SENTRY_DSN,
  //   environment: options.environment || process.env.NODE_ENV || 'development',
  //   tracesSampleRate: 0.2,
  // });

  logger.info('Error reporting initialised (console mode).');
}

/**
 * Capture and report an exception.
 *
 * @param {Error}  err      - The error object
 * @param {object} [context] - Additional context (user, request info, etc.)
 */
function captureException(err, context = {}) {
  logger.error({
    message: err.message,
    stack: err.stack,
    ...context,
  });

  // ----- Sentry (uncomment to enable) -----
  // Sentry.withScope((scope) => {
  //   Object.entries(context).forEach(([key, value]) => {
  //     scope.setExtra(key, value);
  //   });
  //   Sentry.captureException(err);
  // });
}

/**
 * Capture and report a plain message.
 *
 * @param {string} msg   - The message to report
 * @param {'info'|'warning'|'error'} [level='info'] - Severity level
 */
function captureMessage(msg, level = 'info') {
  logger.log({ level, message: msg });

  // ----- Sentry (uncomment to enable) -----
  // Sentry.captureMessage(msg, level);
}

module.exports = {
  initErrorReporting,
  captureException,
  captureMessage,
};
