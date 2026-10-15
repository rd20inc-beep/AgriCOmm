// Idempotency middleware — makes mutating requests replay-safe so a retried
// submit, a dropped response or the offline write outbox re-sending queued
// actions on reconnect can never double-post money/GL/stock.
//
// Activates when a request carries an `Idempotency-Key` header. The web client
// sends one on EVERY mutating request (one key per submit, reused when the same
// submit is retried or replayed from the offline outbox — P2-12); the site
// worker replays with the key it recorded. Mounted globally on /api BEFORE the
// routers; the response capture runs after the route handler (and after
// per-route auth), so it also records the user and cleans up on auth failures.
//
// Contract:
//   - key + completed  → replay the stored response (no re-execution)
//   - key + in_progress → 409 code idempotency_in_progress (a mid-flight
//     duplicate; never re-run → no double-post). Clients retry these later.
//   - key + in_progress older than STALE_MINUTES → the holder died (crash /
//     restart rolled its transaction back) → this request takes the key over
//   - key reused with a different method/path/body → 422 (client bug)
//   - handler failed (>=400) → key deleted so the client can retry cleanly
// If the idempotency store itself errors, we fall through and process the request
// normally — availability at the mill beats the store, and the worst case is a
// non-idempotent write (the pre-existing behaviour).
//
// `requireIdempotencyKey` (below) is the opt-in, per-route hard gate for
// money-creating POSTs: a request without a key is refused (428) instead of
// being processed non-idempotently.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Keep keys well beyond any realistic offline hold, so a late replay still
// de-dupes instead of re-posting. (An offline device syncing 60+ days later is
// pathological; before that window a replay always finds its key.)
const RETENTION_DAYS = 60;

// An in_progress key is a lease held by the request running the handler. Every
// handler finalizes it (completed or released) when it responds, so one still
// in_progress after this long means the process died mid-request — its DB
// transaction rolled back, so re-running is safe. Far above any real handler.
const STALE_MINUTES = 10;

const IN_PROGRESS = {
  success: false,
  code: 'idempotency_in_progress',
  message: 'This request is already being processed. Please retry in a moment.',
};

// Delete keys older than the retention window (both statuses — a key this old is
// far past any device's sync window). Returns the count deleted.
async function pruneOldKeys() {
  return db('idempotency_keys')
    .where('created_at', '<', db.raw(`now() - interval '${RETENTION_DAYS} days'`))
    .del();
}

// Opportunistic prune on a small fraction of keyed requests — bounds the table
// without a scheduler. Fire-and-forget; never blocks the request.
function maybePrune() {
  if (Math.random() > 0.02) return;
  pruneOldKeys().catch((e) => console.error('idempotency prune error:', e.message));
}

// A stored response belongs to the user who made the request. This middleware
// runs before the route's auth, so a replay re-checks the caller's token itself:
// holding someone else's key must never hand back their response.
async function callerOwnsKey(req, existing) {
  if (!existing.user_id) return true; // stored before sign-in (or by a public route)
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  let decoded;
  try { decoded = jwt.verify(header.split(' ')[1], config.jwt.secret); } catch { return false; }
  if (!decoded || decoded.portal || decoded.typ || Number(decoded.id) !== Number(existing.user_id)) return false;
  const { checkLiveAccount } = require('./auth');
  return (await checkLiveAccount(decoded)).ok;
}

module.exports = async function idempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 200 || !MUTATING.has(req.method)) return next();

  maybePrune();

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
        return res.status(422).json({ success: false, code: 'idempotency_key_reused', message: 'Idempotency-Key reused with a different request.' });
      }
      if (existing.status === 'completed') {
        if (!(await callerOwnsKey(req, existing))) {
          return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
        }
        if (typeof res.set === 'function') res.set('Idempotent-Replayed', 'true');
        return res.status(existing.response_status || 200).json(existing.response_body);
      }
      // A stale lease: take it over atomically (only one contender can win).
      const tookOver = await db('idempotency_keys')
        .where({ key, status: 'in_progress' })
        .where('created_at', '<', db.raw(`now() - interval '${STALE_MINUTES} minutes'`))
        .update({ created_at: db.fn.now() });
      if (!tookOver) return res.status(409).json(IN_PROGRESS);
    } else {
      try {
        await db('idempotency_keys').insert({ key, method: req.method, path, request_hash: requestHash, status: 'in_progress' });
      } catch {
        // Lost the race to a concurrent identical request — it's in flight.
        return res.status(409).json(IN_PROGRESS);
      }
    }
  } catch (err) {
    console.error('idempotency store error:', err.message);
    return next(); // never block the write on a store failure
  }

  // Capture the response to persist (on success) or release the key (on failure).
  const origJson = res.json.bind(res);
  let finalized = false;
  const finalize = (body) => {
    if (finalized) return;
    finalized = true;
    const code = res.statusCode || 200;
    const op = code < 400
      ? db('idempotency_keys').where({ key }).update({
          status: 'completed',
          response_status: code,
          response_body: body === undefined ? null : JSON.stringify(body),
          user_id: req.user?.id || null,
          completed_at: db.fn.now(),
        })
      : db('idempotency_keys').where({ key }).del();
    op.catch((e) => console.error('idempotency finalize error:', e.message));
  };
  res.json = (body) => {
    finalize(body);
    return origJson(body);
  };
  // A handler that answers with res.send/res.end/res.sendStatus never passes
  // through res.json — finalize on 'finish' so its key is not left in_progress.
  if (typeof res.on === 'function') res.on('finish', () => finalize(undefined));

  next();
};

// Per-route hard gate for money-creating writes: refuse a request that carries
// no Idempotency-Key, so a double-click or a retried submit can never be
// processed twice. Mount on the route (after authenticate/authorize); the global
// middleware above does the actual de-duplication.
//
// IDEMPOTENCY_ENFORCE=off turns the refusal into a logged warning — an escape
// hatch while an older desktop build that predates per-submit keys is still in
// the field. Default: enforced.
function requireIdempotencyKey(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const key = req.get('Idempotency-Key');
  if (key && key.length <= 200) return next();
  if (String(process.env.IDEMPOTENCY_ENFORCE || '').toLowerCase() === 'off') {
    console.warn(`idempotency: ${req.method} ${(req.originalUrl || req.url).split('?')[0]} without Idempotency-Key (enforcement off)`);
    return next();
  }
  return res.status(428).json({
    success: false,
    code: 'idempotency_key_required',
    message: 'This action needs an Idempotency-Key — refresh the app to update it, then submit again.',
  });
}

module.exports.pruneOldKeys = pruneOldKeys;
module.exports.requireIdempotencyKey = requireIdempotencyKey;
module.exports.STALE_MINUTES = STALE_MINUTES;
