const db = require('../config/database');

/**
 * Granular permission-based authorization middleware.
 * Checks if the authenticated user's role has the specified module+action permission.
 *
 * Usage: authorize('export_orders', 'create')
 */
function authorize(module, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Not authenticated.',
      });
    }

    try {
      // Load and cache permissions on the request user object
      if (!req.user._permissionsLoaded) {
        // Fetch role_id from database if not already present
        let roleId = req.user.role_id;
        if (!roleId) {
          const dbUser = await db('users').where({ id: req.user.id }).select('role_id').first();
          if (!dbUser) {
            return res.status(401).json({
              success: false,
              message: 'User not found.',
            });
          }
          roleId = dbUser.role_id;
          req.user.role_id = roleId;
        }

        // Fetch all permissions for this role
        const perms = await db('role_permissions as rp')
          .join('permissions as p', 'rp.permission_id', 'p.id')
          .where('rp.role_id', roleId)
          .select('p.module', 'p.action');

        // Store as a Set of "module.action" strings for fast lookup
        req.user.permissions = new Set(perms.map((p) => `${p.module}.${p.action}`));
        // #9-scoping: per-user module allow-list (empty = unrestricted).
        const modScopes = await db('user_scopes')
          .where({ user_id: req.user.id, scope_type: 'module' }).pluck('scope_value');
        req.user.moduleScopes = new Set(modScopes);
        req.user._permissionsLoaded = true;
      }

      // Super Admin and Owner bypass — always allowed (never scoped).
      const role = await db('roles').where({ id: req.user.role_id }).select('name').first();
      if (role && (role.name === 'Super Admin' || role.name === 'Owner')) {
        return next();
      }

      // #9-scoping: if the user has a module allow-list, the requested module
      // must be in it (on top of the permission check below).
      if (req.user.moduleScopes && req.user.moduleScopes.size > 0 && !req.user.moduleScopes.has(module)) {
        return res.status(403).json({
          success: false,
          message: `Access restricted — your account is not scoped to the ${module} area.`,
        });
      }

      const permKey = `${module}.${action}`;

      if (!req.user.permissions.has(permKey)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. You do not have permission to perform this action.',
        });
      }

      next();
    } catch (err) {
      console.error('Authorization error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during authorization.',
      });
    }
  };
}

/**
 * Allow the request if the user holds ANY of the given permissions. Each pair is
 * [module, action]. Useful where one action is reachable from two contexts —
 * e.g. quick-adding a rice type from either the inventory (inventory.create) or
 * the export-order (export_orders.create) screen.
 *
 * Usage: authorizeAny(['inventory','create'], ['export_orders','create'])
 */
function authorizeAny(...pairs) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Access denied. Not authenticated.' });
    }
    try {
      if (!req.user._permissionsLoaded) {
        let roleId = req.user.role_id;
        if (!roleId) {
          const dbUser = await db('users').where({ id: req.user.id }).select('role_id').first();
          if (!dbUser) return res.status(401).json({ success: false, message: 'User not found.' });
          roleId = dbUser.role_id;
          req.user.role_id = roleId;
        }
        const perms = await db('role_permissions as rp')
          .join('permissions as p', 'rp.permission_id', 'p.id')
          .where('rp.role_id', roleId)
          .select('p.module', 'p.action');
        req.user.permissions = new Set(perms.map((p) => `${p.module}.${p.action}`));
        const modScopes = await db('user_scopes').where({ user_id: req.user.id, scope_type: 'module' }).pluck('scope_value');
        req.user.moduleScopes = new Set(modScopes);
        req.user._permissionsLoaded = true;
      }
      const role = await db('roles').where({ id: req.user.role_id }).select('name').first();
      if (role && (role.name === 'Super Admin' || role.name === 'Owner')) return next();

      // #9-scoping: allow if any pair's permission is held AND (no module scope,
      // or that pair's module is in the user's allow-list).
      const scoped = req.user.moduleScopes && req.user.moduleScopes.size > 0;
      const ok = pairs.some(([m, a]) => req.user.permissions.has(`${m}.${a}`) && (!scoped || req.user.moduleScopes.has(m)));
      if (!ok) {
        return res.status(403).json({ success: false, message: 'Forbidden. You do not have permission to perform this action.' });
      }
      next();
    } catch (err) {
      console.error('Authorization error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error during authorization.' });
    }
  };
}

/**
 * Backward-compatible role-name-based authorization.
 * Checks if the user's role name matches one of the provided role names.
 *
 * Usage: authorizeRole('Super Admin', 'Finance Manager')
 */
function authorizeRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Not authenticated.',
      });
    }

    try {
      // Fetch the user's role name if not cached
      if (!req.user._roleName) {
        const dbUser = await db('users as u')
          .join('roles as r', 'u.role_id', 'r.id')
          .where('u.id', req.user.id)
          .select('r.name as role_name')
          .first();

        if (!dbUser) {
          return res.status(401).json({
            success: false,
            message: 'User not found.',
          });
        }

        req.user._roleName = dbUser.role_name;
      }

      if (!roles.includes(req.user._roleName)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. You do not have permission to perform this action.',
        });
      }

      next();
    } catch (err) {
      console.error('Authorization error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during authorization.',
      });
    }
  };
}

/**
 * Deny specific roles outright (a small blocklist on top of permission checks).
 * Use when a role legitimately holds a broad permission (e.g. reports.view) but
 * must be kept out of a finance-flavoured subset of those routes. Additive: it
 * only blocks the named roles and changes nothing for any other role.
 *
 * Usage: denyRoles('Mill Operator')
 */
function denyRoles(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Access denied. Not authenticated.' });
    }
    try {
      if (!req.user._roleName) {
        const roleId = req.user.role_id;
        let roleName;
        if (roleId) {
          const r = await db('roles').where('id', roleId).select('name').first();
          roleName = r && r.name;
        } else {
          const dbUser = await db('users as u').join('roles as r', 'u.role_id', 'r.id')
            .where('u.id', req.user.id).select('r.name as role_name').first();
          roleName = dbUser && dbUser.role_name;
        }
        req.user._roleName = roleName;
      }
      if (roles.includes(req.user._roleName)) {
        return res.status(403).json({ success: false, message: 'Forbidden. This report is not available for your role.' });
      }
      next();
    } catch (err) {
      console.error('denyRoles error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error during authorization.' });
    }
  };
}

/**
 * Programmatic (boolean) permission check — same logic as authorize(), but usable
 * inside a handler when the module/action is dynamic (e.g. the sync pull domain).
 * Loads + caches perms on req.user exactly like the middleware; Super Admin/Owner
 * bypass. Returns a boolean; never sends a response.
 */
async function userHasPermission(req, module, action) {
  if (!req.user) return false;
  try {
    let roleId = req.user.role_id;
    if (!roleId) {
      const dbUser = await db('users').where({ id: req.user.id }).select('role_id').first();
      if (!dbUser) return false;
      roleId = dbUser.role_id;
      req.user.role_id = roleId;
    }
    if (!req.user._permissionsLoaded) {
      const perms = await db('role_permissions as rp')
        .join('permissions as p', 'rp.permission_id', 'p.id')
        .where('rp.role_id', roleId)
        .select('p.module', 'p.action');
      req.user.permissions = new Set(perms.map((p) => `${p.module}.${p.action}`));
      req.user._permissionsLoaded = true;
    }
    const role = await db('roles').where({ id: roleId }).select('name').first();
    if (role && (role.name === 'Super Admin' || role.name === 'Owner')) return true;
    return req.user.permissions.has(`${module}.${action}`);
  } catch (err) {
    console.error('userHasPermission error:', err);
    return false;
  }
}

// #9-scoping: the warehouse ids a user is restricted to, or null when
// unrestricted (no warehouse scope rows, or a bypass role). Inventory listings
// pass this to filter results. Owner/Super Admin are never scoped.
async function getScopedWarehouseIds(user) {
  if (!user || !user.id) return null;
  // Cached on the per-request user object: a single report can apply the scope
  // at a dozen query sites and must not re-query user_scopes each time.
  if (user._warehouseScopeLoaded) return user._warehouseScopeIds;
  try {
    const roleId = user.role_id || (await db('users').where({ id: user.id }).first('role_id'))?.role_id;
    const role = roleId && await db('roles').where({ id: roleId }).first('name');
    let ids = null;
    if (!(role && (role.name === 'Super Admin' || role.name === 'Owner'))) {
      const rows = await db('user_scopes').where({ user_id: user.id, scope_type: 'warehouse' }).pluck('scope_value');
      // no rows = unrestricted
      if (rows.length) ids = rows.map((v) => parseInt(v, 10)).filter(Number.isFinite);
    }
    user._warehouseScopeIds = ids;
    user._warehouseScopeLoaded = true;
    return ids;
  } catch (e) {
    return null; // fail-open: never hide data on an infra error
  }
}

module.exports = authorize;
module.exports.authorize = authorize;
module.exports.authorizeAny = authorizeAny;
module.exports.authorizeRole = authorizeRole;
module.exports.denyRoles = denyRoles;
module.exports.userHasPermission = userHasPermission;
module.exports.getScopedWarehouseIds = getScopedWarehouseIds;
