const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');

// The response sent when the account/session lookup itself fails. 503 (not 401/403)
// so clients keep their session and retry — an infra blip must not log anyone out —
// but the request is NEVER let through unchecked (fail closed).
const UNAVAILABLE = {
  success: false,
  code: 'auth_unavailable',
  message: 'Sign-in service is temporarily unavailable. Please try again shortly.',
};

/**
 * #9 Live account check shared by every token-accepting path (Bearer auth, stream
 * tickets, refresh). A suspended / locked / deactivated user, or a session whose
 * token_version is stale (sessions revoked, role/status/password changed), is
 * rejected immediately. The role is returned from the DB so a demotion takes
 * effect on the very next request, whatever the token says.
 *
 * Returns { ok: true, acct } or { ok: false, status, body }. THROWS on a DB error —
 * callers must turn that into a 503, never into access.
 */
async function checkLiveAccount(decoded) {
  const acct = await db('users').where({ id: decoded.id })
    .first('id', 'role_id', 'status', 'is_active', 'token_version');
  if (!acct) return { ok: false, status: 401, body: { success: false, message: 'Account no longer exists.' } };
  const status = acct.status || (acct.is_active ? 'active' : 'deactivated');
  if (status !== 'active') {
    return { ok: false, status: 403, body: { success: false, code: 'account_inactive', message: 'Your account is no longer active. Contact an administrator.' } };
  }
  if ((decoded.tv || 0) !== (acct.token_version || 0)) {
    return { ok: false, status: 401, body: { success: false, code: 'session_revoked', message: 'Your session has ended. Please sign in again.' } };
  }
  return { ok: true, acct };
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  // Employee self-service tokens are portal-scoped only — they carry no staff
  // identity/role and must never authenticate a staff API route.
  if (decoded && decoded.portal) {
    return res.status(401).json({ success: false, message: 'Portal session cannot access staff resources.' });
  }
  // Single-purpose stream tickets only open their own stream/attachment.
  if (decoded && decoded.typ) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  let check;
  try {
    check = await checkLiveAccount(decoded);
  } catch (e) {
    console.error('authenticate: account lookup failed:', e.message);
    return res.status(503).json(UNAVAILABLE);
  }
  if (!check.ok) return res.status(check.status).json(check.body);

  // Role comes from the DB row, not the token (demotion is immediate).
  req.user = { ...decoded, role_id: check.acct.role_id };
  next();
}

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.checkLiveAccount = checkLiveAccount;
module.exports.UNAVAILABLE = UNAVAILABLE;
