/**
 * The routes gated by ownerApproval (owner decision G-11 — the Owner enters
 * their password on the requester's screen). Pins the list, so adding or
 * dropping an owner-approved route is a visible change, and checks each gate
 * sits before any validate() (which would strip authorized_by_owner_id).
 */
const fs = require('fs');
const path = require('path');

const modules = path.join(__dirname, '..', 'modules');
function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /\.routes\.js$/.test(e.name) ? [p] : [];
  });
}

const gated = [];
for (const file of routeFiles(modules)) {
  const text = fs.readFileSync(file, 'utf8');
  // For each ownerApproval('kind'): the router.<verb>('path' … statement it
  // sits in runs from the nearest router.<verb>( before it to the next one.
  for (const m of text.matchAll(/ownerApproval\('([^']+)'\)/g)) {
    const starts = [...text.slice(0, m.index).matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
    if (!starts.length) continue;
    const last = starts[starts.length - 1];
    const next = text.indexOf('\nrouter.', m.index);
    const body = text.slice(last.index, next === -1 ? undefined : next);
    gated.push({ file: path.relative(modules, file), verb: last[1], route: last[2], kind: m[1], body });
  }
}

test('the owner-approved routes', () => {
  expect(gated.map((g) => `${g.verb.toUpperCase()} ${g.file.split(path.sep)[0]} ${g.route} [${g.kind}]`).sort()).toEqual([
    'POST admin /approvals/:type/:id/approve [master_data]',
    'POST exportOrders /:id/cancel [export_cancel]',
    'POST exportOrders /:id/debit-notes/:noteId/cancel [export_balance]',
    'POST exportOrders /:id/packing-weight/resolve [packing_variance]',
    'POST milling /advances/:id/approve [salary_advance]',
  ]);
});

test.each(gated.map((g) => [g.route, g]))('%s runs ownerApproval before validate()', (_r, g) => {
  const gate = g.body.indexOf('ownerApproval(');
  const v = g.body.indexOf('validate(');
  expect(gate).toBeGreaterThan(-1);
  if (v > -1) expect(gate).toBeLessThan(v);
});
