/**
 * memoryDb plus just enough of the RBAC lookups for the REAL rbac middleware
 * (authorize / authorizeAny / denyRoles / userHasPermission) to run against it:
 *   roles                       — seeded from the grants map
 *   role_permissions as rp ...  — join().where('rp.role_id', id).select() → the role's grants
 *   users as u ... join roles   — role name by user id
 *   user_scopes ... pluck()     — always [] (no #9 scoping)
 *
 * Use from a jest.mock factory:
 *   jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);
 * then reset({ roles: { 'Export Manager': ['reports.view'] }, tables: { … } }).
 * Users are seeded as { id, role_id } automatically: user id === role id.
 */
const mem = require('./memoryDb');

let grants = {}; // roleId -> ['module.action']
let roleRows = [];

function reset({ roles = {}, tables = {} } = {}) {
  grants = {};
  roleRows = [];
  Object.entries(roles).forEach(([name, perms], i) => {
    const id = i + 1;
    grants[id] = perms;
    roleRows.push({ id, name });
  });
  mem.reset({
    roles: roleRows,
    users: roleRows.map((r) => ({ id: r.id, role_id: r.id, email: `${r.name.toLowerCase().replace(/\s+/g, '.')}@agri.test`, is_active: true })),
    ...tables,
  });
}

// A req.user for the role (id === role id, as seeded above).
function userFor(roleName) {
  const r = roleRows.find((x) => x.name === roleName);
  if (!r) throw new Error(`rbacMemoryDb: no role ${roleName}`);
  return { id: r.id, role_id: r.id };
}

function chain(resolve) {
  const q = {
    _where: {},
    join() { return q; },
    leftJoin() { return q; },
    where(a, b) { if (typeof a === 'object') Object.assign(q._where, a); else q._where[a] = b; return q; },
    select() { return q; },
    first() { q._first = true; return q; },
    pluck() { return Promise.resolve([]); },
    then(ok, ko) { return Promise.resolve(resolve(q._where, q._first)).then(ok, ko); },
  };
  return q;
}

function db(table) {
  const t = String(table);
  if (t.startsWith('role_permissions')) {
    return chain((w, first) => {
      const rows = (grants[w['rp.role_id']] || []).map((p, i) => {
        const [module, action] = p.split('.');
        return { id: i + 1, module, action };
      }).filter((r) => (w['p.module'] === undefined || r.module === w['p.module'])
        && (w['p.action'] === undefined || r.action === w['p.action']));
      return first ? rows[0] : rows;
    });
  }
  if (t === 'user_scopes') return chain(() => []);
  if (t.startsWith('users as u')) {
    return chain((w, first) => {
      const r = roleRows.find((x) => x.id === Number(w['u.id']));
      const row = r ? { role_name: r.name } : undefined;
      return first ? row : (row ? [row] : []);
    });
  }
  return mem.db(table);
}
db.fn = mem.db.fn;
db.raw = mem.db.raw;
db.transaction = async (fn) => fn(db);

module.exports = { db, reset, userFor, state: mem.state };
