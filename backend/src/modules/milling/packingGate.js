// Who may change a milling batch's packing — its packing runs (correct /
// delete) and its packing spec (the bag the batch packs into). Owner decision
// 2026-10-08:
//
//   Cancelled / Rejected        → locked for everyone.
//   Completed (yield recorded)  → only Owner, Super Admin, Mill Manager.
//   Before that                 → anyone who can record packing today
//                                 (mill_store.record_consumption for runs,
//                                 milling.edit for the spec).
//
// Roles are matched by NAME: the Owner's role_id differs between prod and
// local, so an id comparison would be wrong on one of them.
const { ForbiddenError } = require('../../shared/errors');

const PACKING_ADMIN_ROLES = ['Owner', 'Super Admin', 'Mill Manager'];
const LOCKED_STATUSES = ['Cancelled', 'Rejected'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// "Completed" means the yield is in. A legacy batch can carry a yield under
// another status (Pending Approval, from before approval was dropped), so a
// recorded finished weight counts as completed too.
function isBatchCompleted(batch) {
  if (!batch) return false;
  return batch.status === 'Completed' || num(batch.actual_finished_kg) > 0;
}

/**
 * Pure decision — no I/O, so the matrix can be tested directly.
 *   batch          — { status, actual_finished_kg }
 *   roleName       — the user's role name
 *   hasPermission  — whether the user holds the permission that records this
 *                    kind of packing before completion
 * Returns { allowed, reason, completed, locked }.
 */
function packingEditDecision({ batch, roleName, hasPermission }) {
  const status = batch && batch.status;
  const completed = isBatchCompleted(batch);
  if (LOCKED_STATUSES.includes(status)) {
    return { allowed: false, locked: true, completed, reason: `This batch is ${status} — its packing is locked.` };
  }
  const admin = PACKING_ADMIN_ROLES.includes(roleName);
  if (completed) {
    if (admin) return { allowed: true, locked: false, completed, reason: null };
    return {
      allowed: false, locked: false, completed,
      reason: 'This batch is Completed — only an Owner or Mill Manager can change its packing.',
    };
  }
  if (admin || hasPermission) return { allowed: true, locked: false, completed, reason: null };
  return { allowed: false, locked: false, completed, reason: 'You do not have permission to change this batch\'s packing.' };
}

async function roleNameOf(conn, user) {
  if (!user) return null;
  if (user._roleName !== undefined) return user._roleName;
  let roleId = user.role_id;
  if (!roleId && user.id) {
    const u = await conn('users').where({ id: user.id }).first('role_id');
    roleId = u && u.role_id;
  }
  const role = roleId ? await conn('roles').where({ id: roleId }).first('name') : null;
  // Cache on the request user — one lookup per request.
  user._roleName = (role && role.name) || null;
  return user._roleName;
}

// Uses the permission set rbac.authorize() loaded onto req.user; falls back to
// a query when it has not run.
async function userHasPermission(conn, user, module, action) {
  if (!user) return false;
  const key = `${module}.${action}`;
  if (user.permissions instanceof Set) return user.permissions.has(key);
  let roleId = user.role_id;
  if (!roleId && user.id) {
    const u = await conn('users').where({ id: user.id }).first('role_id');
    roleId = u && u.role_id;
  }
  if (!roleId) return false;
  const hit = await conn('role_permissions as rp')
    .join('permissions as p', 'rp.permission_id', 'p.id')
    .where({ 'rp.role_id': roleId, 'p.module': module, 'p.action': action })
    .first('p.id');
  return !!hit;
}

// The two kinds of packing change and the permission each needs pre-completion.
const PERMS = {
  runs: ['mill_store', 'record_consumption'],
  spec: ['milling', 'edit'],
};

async function canEditBatchPacking(conn, user, batch, kind = 'runs') {
  const [module, action] = PERMS[kind] || PERMS.runs;
  const roleName = await roleNameOf(conn, user);
  const hasPermission = await userHasPermission(conn, user, module, action);
  return packingEditDecision({ batch, roleName, hasPermission });
}

async function assertCanEditBatchPacking(conn, user, batch, kind = 'runs') {
  const d = await canEditBatchPacking(conn, user, batch, kind);
  if (!d.allowed) throw new ForbiddenError(d.reason);
  return d;
}

module.exports = {
  PACKING_ADMIN_ROLES,
  LOCKED_STATUSES,
  isBatchCompleted,
  packingEditDecision,
  canEditBatchPacking,
  assertCanEditBatchPacking,
};
