/**
 * Frontend Error Reporter - RiceFlow ERP
 *
 * Logs errors to the console by default. To switch to Sentry, uncomment the
 * Sentry sections and install the browser SDK:
 *
 *   npm install @sentry/react
 */

// ----- Sentry integration (uncomment to enable) -----
// import * as Sentry from '@sentry/react';

/**
 * Initialise error reporting. Call once in main.jsx / App.jsx.
 *
 * @param {object} [options]
 * @param {string} [options.dsn]         - Sentry DSN
 * @param {string} [options.environment] - e.g. "production", "staging"
 */
export function initErrorReporting(options = {}) {
  // ----- Sentry init (uncomment to enable) -----
  // Sentry.init({
  //   dsn: options.dsn || import.meta.env.VITE_SENTRY_DSN,
  //   environment: options.environment || import.meta.env.MODE,
  //   integrations: [Sentry.browserTracingIntegration()],
  //   tracesSampleRate: 0.2,
  // });

  if (import.meta.env.DEV) {
    console.info('[RiceFlow] Error reporting initialised (console mode).');
  }
}

/**
 * Report a caught exception.
 *
 * @param {Error}  err       - The error object
 * @param {object} [context] - Additional context (component name, user info, etc.)
 */
export function captureException(err, context = {}) {
  console.error('[RiceFlow] Captured exception:', err, context);

  // ----- Sentry (uncomment to enable) -----
  // Sentry.withScope((scope) => {
  //   Object.entries(context).forEach(([key, value]) => {
  //     scope.setExtra(key, value);
  //   });
  //   Sentry.captureException(err);
  // });
}

/**
 * Report a plain message.
 *
 * @param {string} msg   - The message
 * @param {'info'|'warning'|'error'} [level='info'] - Severity
 */
export function captureMessage(msg, level = 'info') {
  const logFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info;
  logFn(`[RiceFlow] ${msg}`);

  // ----- Sentry (uncomment to enable) -----
  // Sentry.captureMessage(msg, level);
}
