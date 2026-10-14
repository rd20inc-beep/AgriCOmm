/**
 * A retired endpoint: answers 410 Gone with a reason and never reaches its
 * handler. Used for API-only write routes that had no screen and bypassed the
 * GL / stock / approval engines (P1-15). The handler code is kept for now so a
 * route can be rebuilt on the proper services later; the guard sits first in
 * the chain, so not even the permission check or body parsing runs.
 *
 * Usage: router.post('/bulk/archive', retired('Bulk archive is retired …'), …)
 */
function retired(message) {
  const guard = (req, res) => res.status(410).json({
    success: false,
    retired: true,
    message: message || 'This endpoint has been retired.',
  });
  guard.authz = { kind: 'retired' };
  return guard;
}

module.exports = retired;
