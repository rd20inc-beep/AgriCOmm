// Employee-portal authentication rules (P1-07). Kept apart from the routes so
// the lockout / revocation logic is testable on its own.
//
// - PINs: a NEW or RESET PIN must be 6–8 digits. PINs set before this rule
//   (4–5 digits) keep working until they are changed.
// - Lockout: 5 wrong PINs for a worker → locked for 15 minutes. An attempt is
//   counted BEFORE the PIN is compared (atomic UPDATE), so parallel guesses
//   cannot slip extra compares past the limit.
// - Revocation: every portal request re-reads the worker; the token dies when
//   the worker is deactivated, self-service is disabled, or the PIN version
//   moved on (admin reset/disable, or the worker changed the PIN).
const jwt = require('jsonwebtoken');
const db = require('../../config/database');
let cfg = require('../../config'); cfg = cfg.default || cfg;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const NEW_PIN_RE = /^\d{6,8}$/;
const NEW_PIN_RULE = 'PIN must be 6–8 digits.';

/** null when `pin` is acceptable as a new/reset PIN, else the error message. */
function newPinError(pin) {
  return NEW_PIN_RE.test(String(pin == null ? '' : pin)) ? null : NEW_PIN_RULE;
}

function minutesLeft(until) {
  return Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));
}

function lockedMessage(until) {
  const m = minutesLeft(until);
  return `Too many wrong PINs. Self-service is locked — try again in ${m} minute${m === 1 ? '' : 's'}, or ask your payroll administrator to reset your PIN.`;
}

/**
 * Count one login attempt against the worker before checking the PIN.
 * Returns { locked: Date } when the worker is (or has just become) locked,
 * otherwise { attempt: n } — the number of this attempt in the current run.
 */
async function reserveAttempt(workerId) {
  const r = await db.raw(`
    UPDATE mill_workers
       SET portal_failed_attempts = portal_failed_attempts + 1
     WHERE id = ? AND (portal_locked_until IS NULL OR portal_locked_until <= now())
     RETURNING portal_failed_attempts
  `, [workerId]);
  if (!r.rows.length) {
    const w = await db('mill_workers').where('id', workerId).first('portal_locked_until');
    return { locked: w && w.portal_locked_until };
  }
  const attempt = r.rows[0].portal_failed_attempts;
  // Attempts beyond the limit (concurrent guesses racing the lock) are refused
  // without a PIN compare and lock the account.
  if (attempt > MAX_FAILED_ATTEMPTS) return { locked: await lock(workerId) };
  return { attempt };
}

async function lock(workerId) {
  const r = await db.raw(`
    UPDATE mill_workers
       SET portal_failed_attempts = 0,
           portal_locked_until = GREATEST(COALESCE(portal_locked_until, now()), now() + make_interval(mins => ?))
     WHERE id = ?
     RETURNING portal_locked_until
  `, [LOCK_MINUTES, workerId]);
  return r.rows[0] && r.rows[0].portal_locked_until;
}

/** A wrong PIN on attempt `attempt`. Returns the lock time when this locks the worker. */
async function recordFailure(workerId, attempt) {
  if (attempt >= MAX_FAILED_ATTEMPTS) return lock(workerId);
  return null;
}

async function recordSuccess(workerId) {
  await db('mill_workers').where('id', workerId).update({ portal_failed_attempts: 0, portal_locked_until: null });
}

function signPortalToken(w) {
  return jwt.sign(
    { portal: true, workerId: w.id, name: w.name, pv: w.portal_pin_version || 0 },
    cfg.jwt.secret, { expiresIn: '12h' },
  );
}

// Verify a portal-scoped token and pin the worker on the request. Staff tokens
// (no `portal` claim) are rejected; portal tokens carry no role_id so they also
// can't satisfy staff `authorize()` elsewhere.
async function portalAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token provided.' });
  let d;
  try {
    d = jwt.verify(h.split(' ')[1], cfg.jwt.secret);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
  if (!d.portal || !d.workerId) return res.status(401).json({ success: false, message: 'Not a portal session.' });
  try {
    const w = await db('mill_workers').where('id', d.workerId)
      .first('id', 'is_active', 'portal_enabled', 'portal_pin_hash', 'portal_pin_version');
    // Tokens issued before PIN versions existed carry no `pv` — they match
    // version 0, i.e. only until the first PIN reset/disable.
    if (!w || !w.is_active || !w.portal_enabled || !w.portal_pin_hash
      || Number(d.pv || 0) !== Number(w.portal_pin_version || 0)) {
      return res.status(401).json({ success: false, message: 'Your self-service session has ended — please sign in again.' });
    }
    req.workerId = w.id;
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  MAX_FAILED_ATTEMPTS, LOCK_MINUTES, NEW_PIN_RULE,
  newPinError, lockedMessage, reserveAttempt, recordFailure, recordSuccess, signPortalToken, portalAuth,
};
