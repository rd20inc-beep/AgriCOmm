/**
 * A payment and its journal are one event: if the journal cannot be posted, the
 * payment must not be saved either.
 *
 * Payment handlers used to wrap the journal in a try/catch that only logged, so
 * a payment into a closed period (or against an unbalanced or missing account)
 * committed with no journal and the user was told it worked. Worse, a database
 * error inside the journal aborts the Postgres transaction: the handler swallowed
 * it, returned success, and COMMIT then silently rolled the whole payment back.
 *
 * Callers rethrow through this so the transaction rolls back and the user sees
 * the reason. accountingService.createJournal / postJournal throw plain Errors
 * (no statusCode) for rule failures — closed period, unbalanced lines, unknown
 * account — which are the user's to fix, so they become a 400. A database error
 * (a Postgres SQLSTATE in err.code) is a server fault and is passed through
 * unchanged, to be reported as a 500 by the handler.
 */
function ledgerFailure(err, what = 'The payment') {
  if (!err || err.statusCode) return err;
  if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) return err;
  const e = new Error(`${what} was not saved: its ledger entry could not be posted. ${err.message}`);
  e.statusCode = 400;
  e.cause = err;
  return e;
}

/** A chart-of-accounts code the journal needs is not seeded. */
function missingAccounts(codes, what = 'The payment') {
  const e = new Error(`${what} was not saved: the chart of accounts is missing ${codes.join(' / ')}.`);
  e.statusCode = 400;
  return e;
}

module.exports = { ledgerFailure, missingAccounts };
