// Stream tickets — short-lived, single-purpose credentials for the few endpoints a
// browser opens WITHOUT an Authorization header (EventSource streams, chat
// attachments shown via <img src>). The main session JWT must never travel in a
// URL: URLs land in proxy/access logs, browser history and Referer headers.
//
// Flow: the client calls POST /api/auth/stream-ticket (normal Bearer auth) and gets
// a ticket bound to { user, token_version, purpose[, resource] } that expires in
// minutes; it then opens `...?ticket=<ticket>`. A ticket is rejected everywhere
// else (middleware/auth refuses any token carrying `typ`), and the same live
// account check as Bearer auth runs when it is used.
const jwt = require('jsonwebtoken');
const config = require('../config');
const { checkLiveAccount, UNAVAILABLE } = require('./auth');

const TICKET_TYPE = 'stream_ticket';

// purpose → lifetime (seconds) and whether the ticket names one resource.
// Stream tickets only need to outlive the connect; the client fetches a fresh one
// whenever the stream has to reconnect. Attachment tickets back <img>/<a> links
// that stay on screen, so they live a little longer (the client refreshes them).
const PURPOSES = {
  'call-signals': { ttl: 120, resource: false },
  'export-order': { ttl: 120, resource: true },
  'chat-attachment': { ttl: 600, resource: false },
};

function issueTicket(user, purpose, resourceId) {
  const spec = PURPOSES[purpose];
  if (!spec) {
    const err = new Error(`Unknown ticket purpose. Use one of: ${Object.keys(PURPOSES).join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }
  if (spec.resource && (resourceId === undefined || resourceId === null || resourceId === '')) {
    const err = new Error('resource_id is required for this ticket.');
    err.statusCode = 400;
    throw err;
  }
  const claims = { id: user.id, tv: user.tv || 0, typ: TICKET_TYPE, pur: purpose };
  if (spec.resource) claims.rid = String(resourceId);
  const ticket = jwt.sign(claims, config.jwt.secret, { expiresIn: spec.ttl });
  return { ticket, expires_in: spec.ttl };
}

/**
 * Middleware: accept ONLY a ticket for `purpose` (from ?ticket=). When
 * `resourceParam` is given, the ticket's resource must equal req.params[resourceParam].
 */
function authenticateTicket(purpose, { resourceParam } = {}) {
  return async function ticketAuth(req, res, next) {
    const raw = req.query.ticket || null;
    if (!raw) {
      return res.status(401).json({ success: false, message: 'Access denied. No ticket provided.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(String(raw), config.jwt.secret);
    } catch {
      return res.status(401).json({ success: false, code: 'ticket_invalid', message: 'Invalid or expired ticket.' });
    }
    if (!decoded || decoded.typ !== TICKET_TYPE || decoded.pur !== purpose) {
      return res.status(401).json({ success: false, code: 'ticket_invalid', message: 'Invalid or expired ticket.' });
    }
    if (resourceParam && String(decoded.rid) !== String(req.params[resourceParam])) {
      return res.status(401).json({ success: false, code: 'ticket_invalid', message: 'Ticket does not match this resource.' });
    }
    let check;
    try {
      check = await checkLiveAccount(decoded);
    } catch (e) {
      console.error('ticket auth: account lookup failed:', e.message);
      return res.status(503).json(UNAVAILABLE);
    }
    if (!check.ok) return res.status(check.status).json(check.body);
    req.user = { id: decoded.id, tv: decoded.tv || 0, role_id: check.acct.role_id };
    return next();
  };
}

/**
 * For a long-lived stream: is the session that opened it still valid? Resolves
 * false only on an EXPLICIT revocation (inactive user, stale token_version); a
 * transient DB error keeps the stream (it re-authenticates on reconnect anyway).
 */
async function sessionStillValid(user) {
  try {
    const check = await checkLiveAccount(user);
    return check.ok;
  } catch {
    return true;
  }
}

module.exports = authenticateTicket;
module.exports.authenticateTicket = authenticateTicket;
module.exports.issueTicket = issueTicket;
module.exports.sessionStillValid = sessionStillValid;
module.exports.TICKET_PURPOSES = PURPOSES;
module.exports.TICKET_TYPE = TICKET_TYPE;
