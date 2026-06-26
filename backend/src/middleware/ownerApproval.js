const db = require('../config/database');

// Owner-authorized approvals. Only the Owner role approves directly; everyone
// else must name which owner authorized it (passed as authorized_by_owner_id in
// the body/query). Apply AFTER authenticate/authorize and BEFORE any validate()
// that would strip unknown body fields. On success, logs to
// approval_authorizations. Sets req.ownerAuth = { ownerId, self }.
// Resolves "Owner" by role NAME (the role_id differs across environments — 9 on
// prod, 10 locally — so never hard-code the id).

function ownerApproval(kind) {
  return async (req, res, next) => {
    try {
      const actor = req.user || {};
      const actorRole = actor.role_id
        ? await db('roles').where({ id: actor.role_id }).first('name')
        : null;
      const isOwner = actorRole?.name === 'Owner';
      let ownerId;

      if (isOwner) {
        ownerId = actor.id;
      } else {
        const raw = req.body?.authorized_by_owner_id ?? req.query?.authorized_by_owner_id;
        ownerId = parseInt(raw, 10);
        if (!ownerId) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_REQUIRED',
            message: 'An owner must authorize this approval. Select which owner approved it.',
          });
        }
        const owner = await db('users as u')
          .join('roles as r', 'r.id', 'u.role_id')
          .where({ 'u.id': ownerId, 'r.name': 'Owner', 'u.is_active': true })
          .first('u.id');
        if (!owner) {
          return res.status(403).json({
            success: false,
            code: 'OWNER_AUTH_INVALID',
            message: 'The selected approver is not an active Owner.',
          });
        }
      }

      req.ownerAuth = { ownerId, self: isOwner };

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
