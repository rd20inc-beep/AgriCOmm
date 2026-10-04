/**
 * Every permission a route checks must be one a migration seeds.
 *
 * authorize('admin', 'update') against a permission that does not exist is not
 * an error — it is a 403 for everyone except Super Admin and Owner, who bypass
 * the check in rbac.js. That is how 70 routes (haulers, expense vendors, the
 * whole accounting module, procurement reads, ...) silently became owner-only:
 * admin.create/update/manage, finance.create/update and inventory.read/update
 * were never seeded, so no role could ever be granted them.
 *
 * This compares two sets of literals: the (module, action) pairs the code
 * checks — authorize(), authorizeAny() and userHasPermission() — and the pairs
 * the migrations insert into `permissions`. Anything checked but never seeded
 * fails, with the file and line.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const MIGRATIONS = path.join(__dirname, '../../migrations');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

// The text of a call's argument list, from the opening paren to its match.
function argsAt(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(openIdx + 1, i);
  }
  return '';
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function usedPermissions() {
  const used = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    // authorize('m', 'a') and userHasPermission(req, 'm', 'a')
    for (const m of src.matchAll(/\b(?:authorize|userHasPermission)\((?:\s*\w+\s*,)?\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g)) {
      used.push({ key: `${m[1]}.${m[2]}`, where: `${rel}:${lineOf(src, m.index)}` });
    }
    // authorizeAny(['m','a'], ['m','a'], ...) — may span lines
    for (const m of src.matchAll(/\bauthorizeAny\(/g)) {
      const args = argsAt(src, m.index + m[0].length - 1);
      for (const p of args.matchAll(/\[\s*'(\w+)'\s*,\s*'(\w+)'\s*\]/g)) {
        used.push({ key: `${p[1]}.${p[2]}`, where: `${rel}:${lineOf(src, m.index)}` });
      }
    }
  }
  return used;
}

function seededPermissions() {
  const seeded = new Set();
  for (const name of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
    // Insert rows always carry a description; lookups ({ module, action } in a
    // where()) never do, so this matches what is created and not what is read.
    for (const m of src.matchAll(/module:\s*'(\w+)',\s*action:\s*'(\w+)',\s*description:/g)) {
      seeded.add(`${m[1]}.${m[2]}`);
    }
    // The payroll migration builds its rows from an ACTIONS table:
    //   ACTIONS.map(([action, description]) => ({ module: 'payroll', action, description }))
    const shorthand = src.match(/module:\s*'(\w+)',\s*action,\s*description/);
    if (shorthand) {
      const table = src.match(/const ACTIONS = \[([\s\S]*?)\n\];/);
      for (const a of (table ? table[1] : '').matchAll(/\[\s*'(\w+)'\s*,/g)) seeded.add(`${shorthand[1]}.${a[1]}`);
    }
  }
  return seeded;
}

// Known, owned elsewhere: the stock-count routes in control.routes.js still check
// inventory.update; a separate stock-take change rewrites those routes. Scoped
// to that one file so the same phantom anywhere else still fails.
const OWNED_ELSEWHERE = [{ key: 'inventory.update', file: 'modules/analytics/control.routes.js' }];
const exempt = (u) => OWNED_ELSEWHERE.some((o) => u.key === o.key && u.where.startsWith(`${o.file}:`));

describe('permissions checked by routes are seeded by migrations', () => {
  const seeded = seededPermissions();
  const used = usedPermissions();

  it('finds both sides (the parsers still match the code)', () => {
    expect(seeded.has('finance.post_journal')).toBe(true);
    expect(seeded.has('payroll.pay')).toBe(true);
    expect(seeded.has('documents.edit')).toBe(true);
    expect(used.length).toBeGreaterThan(200);
  });

  it('no route checks a permission that does not exist', () => {
    const phantom = used.filter((u) => !seeded.has(u.key) && !exempt(u)).map((u) => `${u.key}  ${u.where}`);
    expect(phantom).toEqual([]);
  });
});
