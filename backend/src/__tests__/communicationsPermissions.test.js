/**
 * The communications module had NO permission checks.
 *
 * It declared 37 routes and called authorize() zero times. The only guard was
 * `authenticate` at the mount point, so the check was "is anyone logged in".
 *
 * The proof it was wrong is the Read-Only Auditor role. Its twelve permissions
 * are every one a read — admin:view, documents:view, export_orders:view,
 * finance:view, inventory:view, mill_store:view, milling:view, payroll:view,
 * payroll:export, reports:view, reports:view_cost, reports:view_profit — and it
 * could send email as the company, rewrite the templates everyone else sends
 * from, and disconnect the company WhatsApp session.
 *
 * Verified against the live permission grants: send_email is held by Export
 * Manager, Owner and Super Admin; manage_settings by Owner and Super Admin.
 * Read-Only Auditor holds neither, so it is now refused on every route below.
 */
const fs = require('fs');
const path = require('path');
const ROUTES = fs.readFileSync(path.join(__dirname, '../modules/communications/communications.routes.js'), 'utf8');

// A route line as the file declares it, by method and path.
const line = (method, routePath) => {
  const re = new RegExp(`router\\.${method}\\('${routePath.replace(/[/:]/g, (c) => `\\${c}`)}'[^\\n]*`);
  const m = ROUTES.match(re);
  if (!m) throw new Error(`route ${method.toUpperCase()} ${routePath} not found`);
  return m[0];
};

describe('acting as the company needs send_email', () => {
  it.each([
    ['post', '/email/send'],
    ['post', '/whatsapp/send'],
  ])('%s %s', (method, routePath) => {
    expect(line(method, routePath)).toContain('canSend');
  });

  it('canSend is the permission that already exists for it', () => {
    expect(ROUTES).toContain("const canSend = authorize('export_orders', 'send_email')");
  });
});

describe('sending a DOCUMENT asks for a write in the module it came from', () => {
  // TransactionDocument.jsx posts to this route and is embedded in Local Sales,
  // Money In, Money Out, Mill Finance and Reports. A Mill Manager sending a
  // local-sale invoice and a Finance Manager sending a receipt are both
  // legitimate and neither holds export_orders:send_email — gating it on that
  // would have closed the hole by breaking five working screens.
  it('is guarded, but not by the export send permission', () => {
    const l = line('post', '/whatsapp/send-document');
    expect(l).toContain('canSendDocument');
    expect(l).not.toContain('canSend,');
  });

  it('admits every module that embeds the component', () => {
    expect(ROUTES).toContain("['documents', 'download']");
    expect(ROUTES).toContain("['finance', 'confirm_payment']");
    expect(ROUTES).toContain("['inventory', 'edit']");
    expect(ROUTES).toContain("['milling', 'manage_costs']");
  });

  it('and excludes the read-only role, which holds none of them', () => {
    // Read-Only Auditor: admin:view, documents:view, export_orders:view,
    // finance:view, inventory:view, mill_store:view, milling:view,
    // payroll:view, payroll:export, reports:view, reports:view_cost,
    // reports:view_profit. Every one a read; not one of the four above.
    const READ_ONLY_AUDITOR = [
      'admin:view', 'documents:view', 'export_orders:view', 'finance:view',
      'inventory:view', 'mill_store:view', 'milling:view',
      'payroll:view', 'payroll:export',
      'reports:view', 'reports:view_cost', 'reports:view_profit',
    ];
    const required = ['documents:download', 'finance:confirm_payment', 'inventory:edit', 'milling:manage_costs'];
    expect(required.some((p) => READ_ONLY_AUDITOR.includes(p))).toBe(false);
  });
});

describe('changing the company configuration needs manage_settings', () => {
  it.each([
    ['post', '/email/templates'],
    ['put', '/email/templates/:id'],
    ['post', '/whatsapp/templates'],
    ['put', '/whatsapp/templates/:id'],
    ['delete', '/whatsapp/templates/:id'],
    // The WhatsApp session itself: starting it shows a QR that pairs the
    // company's number, and logout disconnects everyone.
    ['post', '/whatsapp/qr/start'],
    ['post', '/whatsapp/qr/logout'],
    // Firing a scheduled job by hand, and silencing one.
    ['post', '/scheduler/tasks/:id/run'],
    ['put', '/scheduler/tasks/:id/toggle'],
    // Deleting somebody else's comment.
    ['delete', '/comments/:id'],
  ])('%s %s', (method, routePath) => {
    expect(line(method, routePath)).toContain('canConfigure');
  });

  it('canConfigure is the permission that already exists for it', () => {
    expect(ROUTES).toContain("const canConfigure = authorize('admin', 'manage_settings')");
  });
});

describe('what deliberately stays open to any authenticated user', () => {
  // Narrowing these would lock out roles that use them daily and would not
  // close the hole: the hole was that anyone could ACT AS the company or
  // change its configuration, not that anyone could tick off their own task.
  it.each([
    ['post', '/comments'],
    ['post', '/tasks'],
    ['put', '/tasks/:id/complete'],
    ['post', '/follow-ups'],
    ['put', '/follow-ups/:id/done'],
    ['put', '/notifications/:id/read'],
    ['put', '/notifications/read-all'],
    // A preview renders a template without sending anything.
    ['post', '/whatsapp/preview'],
  ])('%s %s is per-user, not company-wide', (method, routePath) => {
    const l = line(method, routePath);
    expect(l).not.toContain('canSend');
    expect(l).not.toContain('canConfigure');
  });
});

describe('no write route is left unguarded by accident', () => {
  it('every POST/PUT/DELETE is either guarded or on the per-user list', () => {
    const PER_USER = [
      '/comments', '/tasks', '/tasks/:id', '/tasks/:id/complete',
      '/follow-ups', '/follow-ups/:id/done',
      '/notifications/:id/read', '/notifications/read-all',
      '/whatsapp/preview',
    ];
    const writes = [...ROUTES.matchAll(/router\.(post|put|delete)\('([^']+)'([^\n]*)/g)];
    expect(writes.length).toBeGreaterThan(15);
    const unaccounted = writes
      .filter(([, , p, rest]) => !/canSend|canConfigure/.test(rest) && !PER_USER.includes(p))
      .map(([, m, p]) => `${m.toUpperCase()} ${p}`);
    if (unaccounted.length) {
      throw new Error(`unguarded and not on the per-user list: ${unaccounted.join(', ')}`);
    }
  });

  it('the module imports the rbac middleware at all', () => {
    // It did not before — which is how 37 routes went unguarded.
    expect(ROUTES).toContain("require('../../middleware/rbac')");
  });
});
