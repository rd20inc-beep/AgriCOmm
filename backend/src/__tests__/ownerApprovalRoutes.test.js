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
    // P2-13 / D-2: reversing a journal and reopening a closed period.
    'POST accounting /journals/:id/reverse [journal_reversal]',
    'POST admin /approvals/:type/:id/approve [master_data]',
    'POST exportOrders /:id/cancel [export_cancel]',
    'POST exportOrders /:id/cancel [export_cancel_forfeit]', // forfeiting money received (P2-15 / D-7)
    'POST exportOrders /:id/debit-notes/:noteId/cancel [export_balance]',
    'POST exportOrders /:id/packing-weight/resolve [packing_variance]',
    'POST exportOrders /:id/write-off-balance [export_short_write_off]',
    'POST finance /payments/:id/reverse [payment_reversal]',
    'POST milling /advances/:id/approve [salary_advance]',
    'POST milling /advances/:id/void [salary_advance_void]',
    'POST milling /payroll/final-settlements/:id/reverse [final_settlement_reversal]',
    'POST serviceMilling /invoices/:id/void [service_invoice_void]',
    'PUT accounting /periods/:id/reopen [period_reopen]',
    'PUT millStore /items/:id/revalue [mill_item_revaluation]', // P3-06 / INV-46: revaluing stock moves 1250
  ]);
});

test.each(gated.map((g) => [g.route, g]))('%s runs ownerApproval before validate()', (_r, g) => {
  const gate = g.body.indexOf('ownerApproval(');
  const v = g.body.indexOf('validate(');
  expect(gate).toBeGreaterThan(-1);
  if (v > -1) expect(gate).toBeLessThan(v);
});

// R10b: approving a salary advance needs payroll.approve like rejecting it —
// it was payroll.view, so a view-only role could submit an approval (the Owner
// gate still applies on top).
test('approve and reject of a salary advance both need payroll.approve', () => {
  const text = fs.readFileSync(path.join(modules, 'milling', 'milling.routes.js'), 'utf8');
  for (const verb of ['approve', 'reject']) {
    const m = text.match(new RegExp(`router\\.post\\('/advances/:id/${verb}', authorize\\('payroll', '(\\w+)'\\)`));
    expect(m && m[1]).toBe('approve');
  }
});
