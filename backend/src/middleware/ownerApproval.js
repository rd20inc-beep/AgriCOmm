const bcrypt = require('bcryptjs');
const db = require('../config/database');

// Owner-authorized approvals (owner decision G-11, 2026-10-09: the Owner must
// actually approve — naming one is not enough).
//
// - An Owner acting themselves passes directly (self-approval).
// - Anyone else must name the authorizing Owner (authorized_by_owner_id in the
//   body/query) AND that Owner must enter THEIR password on the requester's
//   screen. The password travels in the X-Owner-Credential header (base64 of
//   UTF-8) — never in the body, which the audit log stores — is checked with
//   bcrypt against users.password_hash, and is never logged or stored.
// - Wrong password → 403 OWNER_AUTH_FAILED and the action does not run.
//   After MAX_FAILURES wrong passwords for one requester + owner pair within
//   WINDOW_MS, that pair is locked out for LOCK_MS (429 OWNER_AUTH_LOCKED).
//   The lockout is per pair, so a requester guessing cannot lock the owner out
//   of approving for anybody else, and never touches the owner's own login.
//
// Apply AFTER authenticate/authorize and BEFORE any validate() that would strip
// unknown body fields. Once the action succeeds the verified owner is logged
// to approval_authorizations (verification = 'self' | 'password').
// Sets req.ownerAuth = { ownerId, self, verification }.
// Resolves "Owner" by role NAME (the role_id differs across environments — 9 on
// prod, 10 locally — so never hard-code the id).

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const CREDENTIAL_HEADER = 'x-owner-credential';

// requester:owner → { failures, firstAt, lockedUntil }. In memory: one backend
// process serves the API (a restart clears it, which only shortens a lockout).
const attempts = new Map();

function pairKey(actorId, ownerId) { return `${actorId || 0}:${ownerId}`; }

function lockedFor(key, now = Date.now()) {
  const a = attempts.get(key);
  if (!a) return 0;
  if (a.lockedUntil && a.lockedUntil > now) return a.lockedUntil - now;
  if (a.lockedUntil && a.lockedUntil <= now) attempts.delete(key);
  return 0;
}

function recordFailure(key, now = Date.now()) {
  let a = attempts.get(key);
  if (!a || now - a.firstAt > WINDOW_MS) a = { failures: 0, firstAt: now, lockedUntil: 0 };
  a.failures += 1;
  if (a.failures >= MAX_FAILURES) a.lockedUntil = now + LOCK_MS;
  attempts.set(key, a);
  return a;
}

function readCredential(req) {
  const raw = req.headers?.[CREDENTIAL_HEADER];
  if (!raw || typeof raw !== 'string') return null;
  try {
    const s = Buffer.from(raw, 'base64').toString('utf8');
    return s || null;
  } catch {
    return null;
  }
}

function ownerApproval(kind) {
  return async (req, res, next) => {
    try {
      const actor = req.user || {};
      const actorRole = actor.role_id
        ? await db('roles').where({ id: actor.role_id }).first('name')
        : null;
      const isOwner = actorRole?.name === 'Owner';
      let ownerId;
      let verification;

      if (isOwner) {
        ownerId = actor.id;
        verification = 'self';
      } else {
        const raw = req.body?.authorized_by_owner_id ?? req.query?.authorized_by_owner_id;
        ownerId = parseInt(raw, 10);
        if (!ownerId) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_REQUIRED',
            message: 'An owner must authorize this approval: choose the owner and have them enter their password.',
          });
        }
        if (ownerId === actor.id) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_INVALID',
            message: 'You cannot authorize your own approval.',
          });
        }
        const owner = await db('users as u')
          .join('roles as r', 'r.id', 'u.role_id')
          .where({ 'u.id': ownerId, 'r.name': 'Owner', 'u.is_active': true })
          .first('u.id', 'u.password_hash');
        if (!owner) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_INVALID',
            message: 'The selected approver is not an active Owner.',
          });
        }

        const key = pairKey(actor.id, ownerId);
        const wait = lockedFor(key);
        if (wait > 0) {
          return res.status(429).json({
            success: false,
            code: 'OWNER_AUTH_LOCKED',
            message: `Too many wrong owner passwords. Try again in ${Math.ceil(wait / 60000)} minute(s).`,
          });
        }

        const credential = readCredential(req);
        if (!credential) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_CREDENTIAL_REQUIRED',
            message: 'The owner must enter their password to authorize this.',
          });
        }
        const ok = !!owner.password_hash && await bcrypt.compare(credential, owner.password_hash);
        if (!ok) {
          const a = recordFailure(key);
          if (a.lockedUntil) {
            return res.status(429).json({
              success: false,
              code: 'OWNER_AUTH_LOCKED',
              message: `Too many wrong owner passwords. Try again in ${Math.ceil(LOCK_MS / 60000)} minutes.`,
            });
          }
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_FAILED',
            message: `The owner's password is incorrect (${MAX_FAILURES - a.failures} attempt(s) left).`,
          });
        }
        attempts.delete(key);
        verification = 'password';
      }

      req.ownerAuth = { ownerId, self: isOwner, verification };

      // Log the authorization once the action succeeds (status < 400).
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        const ref = String(req.params?.id ?? req.params?.sourceId ?? '') || null;
        db('approval_authorizations').insert({
          kind,
          ref,
          action: 'approve',
          performed_by: actor.id || null,
          authorized_by_owner_id: ownerId || null,
          self_approved: isOwner,
          verification,
        }).catch((e) => console.error('approval_authorizations log error:', e.message));
      });

      next();
    } catch (err) {
      console.error('ownerApproval middleware error:', err.message);
      return res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}

module.exports = ownerApproval;
module.exports.MAX_FAILURES = MAX_FAILURES;
module.exports.LOCK_MS = LOCK_MS;
module.exports.CREDENTIAL_HEADER = CREDENTIAL_HEADER;
module.exports._resetAttempts = () => attempts.clear();
