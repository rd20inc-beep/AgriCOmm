// Idempotency middleware — makes mutating requests replay-safe so the offline
// write outbox can safely re-send queued actions on reconnect without ever
// double-posting money/GL/stock.
//
// Activates ONLY when a request carries an `Idempotency-Key` header (which only
// the offline-sync client sends), so normal online traffic is completely
// unchanged. Mounted globally on /api BEFORE the routers; the response capture
// runs after the route handler (and after per-route auth), so it also records
// the user and cleans up on auth failures.
//
// Contract:
//   - key + completed  → replay the stored response (no re-execution)
//   - key + in_progress → 409 (a mid-flight duplicate; never re-run → no double-post)
//   - key reused with a different method/path/body → 422 (client bug)
//   - handler failed (>=400) → key deleted so the client can retry cleanly
// If the idempotency store itself errors, we fall through and process the request
// normally — availability at the mill beats the store, and the worst case is a
// non-idempotent write (the pre-existing behaviour).
const crypto = require('crypto');
const db = require('../config/database');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

module.exports = async function idempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 200 || !MUTATING.has(req.method)) return next();

  const path = (req.originalUrl || req.url).split('?')[0];
  let requestHash = null;
  try {
    if (req.is('application/json') && req.body && Object.keys(req.body).length) {
      requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    }
  } catch { /* body not hashable — skip the mismatch guard */ }

  try {
    const existing = await db('idempotency_keys').where({ key }).first();
    if (existing) {
      if (existing.method !== req.method || existing.path !== path
          || (requestHash && existing.request_hash && existing.request_hash !== requestHash)) {
        return res.status(422).json({ success: false, message: 'Idempotency-Key reused with a different request.' });
      }
      if (existing.status === 'completed') {
        return res.status(existing.response_status || 200).json(existing.response_body);
      }
      return res.status(409).json({ success: false, message: 'This request is already being processed. Please retry in a moment.' });
    }

    try {
      await db('idempotency_keys').insert({ key, method: req.method, path, request_hash: requestHash, status: 'in_progress' });
    } catch {
      // Lost the race to a concurrent identical request — it's in flight.
      return res.status(409).json({ success: false, message: 'This request is already being processed. Please retry in a moment.' });
    }
  } catch (err) {
    console.error('idempotency store error:', err.message);
    return next(); // never block the write on a store failure
  }

  // Capture the response to persist (on success) or release the key (on failure).
  const origJson = res.json.bind(res);
  let finalized = false;
  res.json = (body) => {
    if (!finalized) {
      finalized = true;
      const code = res.statusCode || 200;
      const op = code < 400
        ? db('idempotency_keys').where({ key }).update({
            status: 'completed',
            response_status: code,
            response_body: JSON.stringify(body),
            user_id: req.user?.id || null,
            completed_at: db.fn.now(),
          })
        : db('idempotency_keys').where({ key }).del();
      op.catch((e) => console.error('idempotency finalize error:', e.message));
    }
    return origJson(body);
  };

  next();
};
