/**
 * A rateLimiter mock for app-level tests: every limiter the module exports (and
 * any added later) is a pass-through, so adding a limiter never breaks suites
 * that build the whole app.
 *
 *   jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));
 */
const pass = (req, res, next) => next();
module.exports = new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : pass) });
