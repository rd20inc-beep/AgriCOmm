/**
 * P2-30 — every mutating route leaves an audit trail.
 *
 * ~125 of the ~430 POST / PUT / PATCH / DELETE routes had no auditAction:
 * cheque clearing, expense vendors, recurring expenses, salary revisions,
 * PINs, leave, attendance, statutory deductions, generated-document approval,
 * device revocation, enterprise operations… — changes to money, rates and pay
 * inputs nobody could trace.
 *
 * This is the CI gate: a new mutating route must carry auditAction(...) or be
 * listed below with WHY it does not. Entries marked 'handler' audit inside the
 * handler itself (auditService.log / logInTrx), and that is checked too. A
 * listed route that no longer exists fails the suite, so the list cannot rot.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : jsFiles(p);
    return /\.js$/.test(e.name) ? [p] : [];
  });
}

// key: '<file relative to src> <VERB> <path>' → reason
const EXEMPT = {
  // Authentication — sign-in / session / own-password events, not business data.
  'modules/auth/auth.routes.js POST /login': 'auth',
  // Answers 405 and changes nothing: settlements are reversed via POST …/reverse (audited).
  'modules/milling/milling.routes.js DELETE /payroll/final-settlements/:id': 'retired',
  'modules/auth/auth.routes.js POST /register': 'auth',
  'modules/auth/auth.routes.js POST /refresh-token': 'auth',
  'modules/auth/auth.routes.js POST /change-password': 'auth',
  'modules/auth/auth.routes.js POST /forgot-password': 'auth',
  'modules/auth/auth.routes.js POST /reset-password': 'auth',
  'modules/auth/auth.routes.js POST /stream-ticket': 'auth',
  'modules/auth/auth.routes.js PUT /profile': 'auth',
  'modules/portal/portal.routes.js POST /login': 'auth',
  'modules/portal/portal.routes.js POST /change-pin': 'auth',
  // Employee self-service: the request row IS the record; resolving it is audited.
  'modules/portal/portal.routes.js POST /requests': 'self-service record',
  'modules/portal/portal.routes.js POST /leave': 'self-service record',
  // Messaging / collaboration notes — not money, stock or configuration.
  'modules/chat/chat.routes.js POST /messages': 'messaging',
  'modules/chat/chat.routes.js POST /read': 'messaging',
  'modules/chat/chat.routes.js POST /signal': 'messaging',
  'modules/communications/communications.routes.js POST /comments': 'collaboration',
  'modules/communications/communications.routes.js DELETE /comments/:id': 'collaboration',
  'modules/communications/communications.routes.js POST /tasks': 'collaboration',
  'modules/communications/communications.routes.js PUT /tasks/:id': 'collaboration',
  'modules/communications/communications.routes.js PUT /tasks/:id/complete': 'collaboration',
  'modules/communications/communications.routes.js POST /follow-ups': 'collaboration',
  'modules/communications/communications.routes.js PUT /follow-ups/:id/done': 'collaboration',
  'modules/communications/communications.routes.js PUT /notifications/:id/read': 'collaboration',
  'modules/communications/communications.routes.js PUT /notifications/read-all': 'collaboration',
  // Read-only computations / renders that happen to be POST.
  'modules/communications/communications.routes.js POST /whatsapp/preview': 'read-only',
  'modules/ai/ai.routes.js POST /query': 'read-only (AI queries are logged by the AI module)',
  'modules/ai/ai.routes.js POST /draft': 'read-only',
  'modules/ai/ai.routes.js POST /categorize-expense': 'read-only',
  'modules/ai/ai.routes.js POST /summarize-report': 'read-only',
  'modules/analytics/reporting.routes.js POST /saved/:id/run': 'read-only',
  'modules/analytics/reporting.routes.js POST /export': 'read-only',
  'modules/analytics/smart.routes.js POST /cost/optimal-sourcing': 'read-only',
  'modules/exportOrders/exportOrders.routes.js POST /:id/documents/bundle': 'read-only render',
  'modules/exportOrders/exportOrders.routes.js POST /:id/documents/:docType/pdf': 'read-only render',
  'modules/milling/milling.routes.js POST /batches/:id/consumption/suggest': 'read-only',
  'modules/sync/sync.routes.js POST /bootstrap': 'read-only (sync pull)',
  'modules/sync/sync.routes.js POST /pull': 'read-only (sync pull)',
  'modules/sync/sync.routes.js POST /conflicts': 'the conflict row is the record; resolving it is audited',
  // File uploads: the file is recorded with the document that references it.
  'modules/finance/finance.routes.js POST /fund-transfers/attachment': 'upload',
  'modules/finance/finance.routes.js POST /payments/attachment': 'upload',
  'modules/analytics/smart.routes.js POST /mobile/upload': 'upload',
  // Retired endpoints (410 Gone).
  'modules/finance/finance.routes.js POST /internal-transfers': 'retired',
  'middleware/retired.js POST /bulk/archive': 'retired',
  // Audited inside the handler (checked below).
  'routes/users.js PUT /:id/role': 'handler',
  'routes/users.js PUT /:id/deactivate': 'handler',
  'routes/users.js PUT /:id/activate': 'handler',
  'routes/users.js PUT /:id/password': 'handler',
  'routes/users.js DELETE /:id': 'handler',
  'routes/users.js PUT /:id/status': 'handler',
  'routes/users.js PUT /:id/force-password-change': 'handler',
  'routes/users.js POST /:id/reset-link': 'handler',
  'routes/users.js POST /:id/revoke-sessions': 'handler',
  'routes/users.js PUT /:id/scopes': 'handler',
};

const routes = [];
for (const file of jsFiles(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const starts = [...text.matchAll(/router\.(post|put|patch|delete)\(\s*(['`])([^'`]+)\2/g)];
  starts.forEach((m) => {
    const next = text.indexOf('\nrouter.', m.index + 1);
    const body = text.slice(m.index, next === -1 ? undefined : next);
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    routes.push({ key: `${rel} ${m[1].toUpperCase()} ${m[3]}`, body });
  });
}

test('the inventory found the routes (sanity)', () => {
  expect(routes.length).toBeGreaterThan(300);
});

test('every mutating route is audited, or exempt with a reason', () => {
  const missing = routes
    .filter((r) => !/auditAction\(/.test(r.body) && !EXEMPT[r.key])
    .map((r) => r.key);
  expect(missing).toEqual([]);
});

test("routes exempt as 'handler' really audit in the handler", () => {
  const notAudited = routes
    .filter((r) => EXEMPT[r.key] === 'handler')
    .filter((r) => !/auditService\.log(InTrx)?\(|audit_logs/.test(r.body))
    .map((r) => r.key);
  expect(notAudited).toEqual([]);
});

test('every exemption still names a real, unaudited route (no stale entries)', () => {
  const byKey = new Map(routes.map((r) => [r.key, r]));
  const stale = Object.keys(EXEMPT).filter((k) => !byKey.has(k) || /auditAction\(/.test(byKey.get(k).body));
  expect(stale).toEqual([]);
});

test('money / config routes named by the audit now carry auditAction', () => {
  const must = [
    'modules/finance/finance.routes.js POST /payments/:id/clear',
    'modules/expenseVendors/expenseVendors.routes.js POST /',
    'modules/milling/milling.routes.js POST /expenses/recurring/run-due',
    'modules/milling/milling.routes.js POST /workers/:id/salary-revision',
    'modules/milling/milling.routes.js POST /workers/:id/portal-pin',
    'modules/milling/milling.routes.js POST /payroll/statutory-deductions',
    'modules/milling/milling.routes.js POST /attendance',
    'modules/milling/milling.routes.js POST /payroll/leave-requests',
    'modules/exportOrders/exportOrders.routes.js PUT /documents/:genId/approve',
    'modules/sync/sync.routes.js POST /devices/:id/revoke',
    'routes/enterprise.js POST /bulk/status-update',
  ];
  const byKey = new Map(routes.map((r) => [r.key, r]));
  for (const k of must) {
    expect([k, /auditAction\(/.test(byKey.get(k)?.body || '')]).toEqual([k, true]);
  }
});
