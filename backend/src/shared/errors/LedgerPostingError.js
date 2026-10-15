const AppError = require('./AppError');

/**
 * A journal could not be posted for a reason the user can fix: no active
 * posting rule for the event, a closed / locked period, an unbalanced journal,
 * an account that is not in the chart, or a manual line on a control account.
 *
 * It is a 400, not a 500, so the reason reaches the user — and it is THROWN,
 * never returned as null, so the business write it belongs to rolls back with
 * it (P2-02: a record never commits without its journal).
 *
 * `reason` is a stable machine code ('missing_rule' | 'period_closed' |
 * 'unbalanced' | 'unknown_account' | 'control_account' | 'not_found' |
 * 'invalid_state'). It is deliberately NOT `code`: ledgerFailure() and the
 * error handler read a 5-character `code` as a Postgres SQLSTATE.
 */
class LedgerPostingError extends AppError {
  constructor(message, reason = 'posting_failed', details = null) {
    super(message, 400);
    this.reason = reason;
    this.isLedgerError = true;
    if (details) this.details = details;
  }
}

module.exports = LedgerPostingError;
