const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');

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

  // #9 Live account check: a suspended / locked / deactivated user, or a session
  // whose token_version is stale (admin revoked all sessions), is rejected
  // immediately — not just at next login. Fail-open on an unexpected DB error so
  // an infra blip can't lock everyone out; only an EXPLICIT mismatch blocks.
  try {
    const acct = await db('users').where({ id: decoded.id })
      .first('id', 'status', 'is_active', 'token_version');
    if (!acct) return res.status(401).json({ success: false, message: 'Account no longer exists.' });
    const status = acct.status || (acct.is_active ? 'active' : 'deactivated');
    if (status !== 'active') {
      return res.status(403).json({ success: false, code: 'account_inactive', message: 'Your account is no longer active. Contact an administrator.' });
    }
    if ((decoded.tv || 0) !== (acct.token_version || 0)) {
      return res.status(401).json({ success: false, code: 'session_revoked', message: 'Your session was ended by an administrator. Please sign in again.' });
    }
  } catch (e) {
    // fail-open: don't block valid users on a transient DB error
  }

  req.user = decoded;
  next();
}

module.exports = authenticate;
