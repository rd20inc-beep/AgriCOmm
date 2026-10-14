// Device guard (offline Stage 6b) — enforces device revocation on writes. Every
// client request carries an `X-Device-Id`; if that device has been revoked, its
// MUTATING requests (online or replayed from the offline outbox) are rejected with
// 403 `device_revoked`. Reads are not blocked here (the sync /pull path already
// checks the device, and blocking every GET would add a DB hit per read).
//
// An absent/malformed id or an unregistered device passes (normal online use).
// A failed LOOKUP fails closed with 503 — the write is refused (clients retry /
// keep it queued) rather than let a revoked device through during an outage.
//
// Revoking a device also bumps its user's token_version (sync.controller), so the
// tokens it holds stop working for reads too, not only for writes that volunteer
// this header.
const db = require('../config/database');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function deviceGuard(req, res, next) {
  const deviceId = req.get('X-Device-Id');
  if (!deviceId || !MUTATING.has(req.method) || !UUID_RE.test(deviceId)) return next();

  try {
    const dev = await db('devices').where({ device_uuid: deviceId }).first();
    if (dev && dev.status === 'revoked') {
      return res.status(403).json({
        success: false,
        code: 'device_revoked',
        message: 'This device has been revoked. Please contact an administrator.',
      });
    }
    if (dev) {
      db('devices').where({ id: dev.id }).update({ last_seen_at: db.fn.now() }).catch(() => {});
    }
  } catch (err) {
    console.error('deviceGuard error:', err.message);
    return res.status(503).json({
      success: false,
      code: 'auth_unavailable',
      message: 'Service temporarily unavailable. Please try again shortly.',
    });
  }
  return next();
};
