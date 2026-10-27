/**
 * A signed-in user's access, loaded once and checked many times — the same
 * rules as the route guards in middleware/rbac.js, as plain functions.
 *
 * Used where one request has to decide many permission questions at once (the
 * approvals inbox lists a dozen queues, the notification bell checks every
 * link) without running the middleware a dozen times. Roles are resolved by
 * NAME — role ids differ between installs (Owner is 9 on prod, 10 locally).
 */
const db = require('../config/database');
const { scopeAreaOf } = require('../shared/scopeArea');

// rbac.js: Super Admin and Owner pass every authorize / authorizeAny check.
// authorizeRole has NO bypass — it lists the roles it allows.
const BYPASS_ROLES = ['Super Admin', 'Owner'];

async function loadAccess(userOrId, conn = db) {
  const id = typeof userOrId === 'object' && userOrId ? userOrId.id : userOrId;
  if (id == null) return null;
  const u = await conn('users as u')
    .leftJoin('roles as r', 'u.role_id', 'r.id')
    .where('u.id', id)
    .first('u.id', 'u.role_id', 'r.name as role_name');
  if (!u) return null;
  const [perms, scopes] = await Promise.all([
    u.role_id == null ? [] : conn('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .where('rp.role_id', u.role_id)
      .select('p.module', 'p.action'),
    conn('user_scopes').where({ user_id: u.id, scope_type: 'module' }).pluck('scope_value'),
  ]);
  return {
    id: u.id,
    roleId: u.role_id,
    roleName: u.role_name || null,
    permissions: new Set(perms.map((p) => `${p.module}.${p.action}`)),
    moduleScopes: new Set(scopes),
  };
}

// Build an access object from fields already in memory (tests, or a req.user
// that rbac.js has loaded).
function accessOf({ id, roleId = null, roleName = null, permissions = [], moduleScopes = [] }) {
  return { id, roleId, roleName, permissions: new Set(permissions), moduleScopes: new Set(moduleScopes) };
}

const isBypass = (a) => !!a && BYPASS_ROLES.includes(a.roleName);

// authorize(module, action): bypass, then module scope, then the permission.
function can(a, module, action) {
  if (!a) return false;
  if (isBypass(a)) return true;
  if (a.moduleScopes.size > 0 && !a.moduleScopes.has(scopeAreaOf(module))) return false;
  return a.permissions.has(`${module}.${action}`);
}

// The `authz` tag rbac.js puts on every guard: { kind, perms } or { kind, roles }.
function passesGuard(a, authz) {
  if (!a || !authz) return false;
  switch (authz.kind) {
    case 'authorize': return authz.perms.every(([m, act]) => can(a, m, act));
    case 'authorizeAny': return authz.perms.some(([m, act]) => can(a, m, act));
    case 'authorizeRole': return authz.roles.includes(a.roleName);
    default: return false;
  }
}

module.exports = { BYPASS_ROLES, loadAccess, accessOf, isBypass, can, passesGuard };
