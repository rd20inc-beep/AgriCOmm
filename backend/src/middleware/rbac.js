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
        req.user._permissionsLoaded = true;
      }

      // Super Admin bypass — always allowed
      const role = await db('roles').where({ id: req.user.role_id }).select('name').first();
      if (role && role.name === 'Super Admin') {
        return next();
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

module.exports = authorize;
module.exports.authorize = authorize;
module.exports.authorizeRole = authorizeRole;
