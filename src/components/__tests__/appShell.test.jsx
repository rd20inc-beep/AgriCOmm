import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ROLE_PERMISSIONS, permsFor } from '../../test/fixtures/rolePermissions';
import { canOpen } from '../../app/routeGates';
import { resolveWorkspace } from '../../app/workspace';
import { buildNav, visibleQuickActions } from '../../app/navConfig';
import { resolveMobileNav, MOBILE_NAV_ITEMS } from '../../lib/mobileNavItems';

/**
 * P5-04 / D-21 — ONE application shell for every seeded role: navigation from
 * the permission set, the role's home dashboard, ≤ 7 primary destinations +
 * Show More, approvals never hidden, offline/sync widgets for everyone, no
 * entity selector.
 */

let mockRole = 'Owner';
let mockApprovals = 0;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { full_name: 'Zed Test', email: 'z@test', role: mockRole, permissions: ROLE_PERMISSIONS[mockRole] || [] },
    hasPermission: (m, a) => permsFor(mockRole)(m, a),
    logout: () => {},
    isAuthenticated: true,
  }),
}));
vi.mock('../../modules/purchaseRequirements/api/queries', () => ({ usePurchaseRequirementsCount: () => ({ data: 2 }) }));
vi.mock('../../modules/governance/useApprovalsInbox', () => ({ useApprovalsInboxCount: () => mockApprovals }));
vi.mock('../ErrorBoundary', () => ({ RouteErrorBoundary: ({ children }) => children }));
vi.mock('../../shared/components/Skeleton', () => ({ SkeletonPage: () => null }));
vi.mock('../ChatWidget', () => ({ default: () => null }));
// Offline / sync widgets: markers, so the test sees they are MOUNTED for the
// role (each renders nothing while online).
vi.mock('../OfflineBanner', () => ({ default: () => <i data-widget="offline-banner" /> }));
vi.mock('../PendingSyncTray', () => ({ default: () => <i data-widget="pending-sync-tray" /> }));
vi.mock('../OfflineExpiredGate', () => ({ default: () => <i data-widget="offline-expired-gate" /> }));
vi.mock('../SyncStatusChip', () => ({ default: () => <i data-widget="sync-status-chip" /> }));
vi.mock('../SyncConflictsDrawer', () => ({ default: () => <i data-widget="sync-conflicts" /> }));
vi.mock('../ScanDrawer', () => ({ default: () => <i data-widget="scan-drawer" /> }));

const { default: Layout } = await import('../Layout');

const render = (role, url = '/') => {
  mockRole = role;
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Layout><div>page</div></Layout></MemoryRouter>);
};
const navLinks = (html) => [...html.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);
const ROLES = Object.keys(ROLE_PERMISSIONS);

beforeEach(() => { mockApprovals = 0; });

describe('home dashboard by permission set (not role name)', () => {
  it.each([
    ['Mill Manager', 'mill'],
    ['Mill Operator', 'mill'],
    ['Export Manager', 'export'],
    ['Finance Manager', 'finance'],
    ['Owner', 'standard'],
    ['Super Admin', 'standard'],
    ['Read-Only Auditor', 'standard'],
    ['QC Analyst', 'standard'],
    ['Inventory Officer', 'standard'],
    ['Documentation Officer', 'standard'],
  ])('%s → %s', (role, ws) => {
    expect(resolveWorkspace(permsFor(role))).toBe(ws);
  });

  it('a renamed role with the Mill Manager permissions still gets the Mill home', () => {
    const set = new Set(ROLE_PERMISSIONS['Mill Manager']);
    expect(resolveWorkspace((m, a) => set.has(`${m}.${a}`))).toBe('mill');
  });
});

describe.each(ROLES)('%s — one shell', (role) => {
  it('mounts the offline gate, banner, sync chip/tray/conflicts, scan, bell and search', () => {
    const html = render(role);
    for (const w of ['offline-banner', 'pending-sync-tray', 'offline-expired-gate', 'sync-status-chip', 'sync-conflicts', 'scan-drawer']) {
      expect([role, w, html.includes(`data-widget="${w}"`)]).toEqual([role, w, true]);
    }
    expect(html).toContain('data-testid="scan-button"');
    expect(html).toContain('data-testid="notification-bell"');
    expect(html).toContain('data-testid="global-search"');
  });

  it('the approvals inbox is pinned for every role (never under Show More)', () => {
    const can = permsFor(role);
    const { pinned, more } = buildNav(can, { workspace: resolveWorkspace(can) });
    expect(pinned.map((i) => i.to)).toEqual(['/approvals']);
    expect(more.map((i) => i.to)).not.toContain('/approvals');
    expect(render(role)).toContain('data-testid="approvals-badge"');
  });

  it('links only destinations the role can open; ≤ 7 primary', () => {
    const can = permsFor(role);
    const html = render(role);
    for (const to of navLinks(html)) expect([role, to, canOpen(to, can)]).toEqual([role, to, true]);
    const { primary } = buildNav(can, { workspace: resolveWorkspace(can) });
    expect(primary.length).toBeLessThanOrEqual(7);
  });

  it('has no entity selector', () => {
    expect(render(role)).not.toMatch(/aria-label="Entity filter"|All Entities/);
  });

  it('phone bottom bar lists only openable routes', () => {
    const can = permsFor(role);
    for (const item of resolveMobileNav(null, can, resolveWorkspace(can))) expect(canOpen(item.path, can)).toBe(true);
    for (const item of resolveMobileNav(MOBILE_NAV_ITEMS.map((i) => i.key), can)) expect(canOpen(item.path, can)).toBe(true);
  });

  it('quick actions are only those the role may start', () => {
    const can = permsFor(role);
    for (const a of visibleQuickActions(can)) {
      expect(canOpen(a.to, can)).toBe(true);
      if (a.requires?.module) expect(can(a.requires.module, a.requires.action)).toBe(true);
    }
  });
});

describe('per-role navigation', () => {
  const navOf = (role) => {
    const can = permsFor(role);
    const { primary, pinned, more } = buildNav(can, { workspace: resolveWorkspace(can) });
    return {
      primary: primary.map((i) => i.label),
      leaves: [...primary.flatMap((i) => (i.children ? i.children.map((c) => c.to) : [i.to])), ...pinned.map((i) => i.to), ...more.map((i) => i.to)],
      more: more.map((i) => i.to),
      pinned: pinned.map((i) => i.to),
      quick: visibleQuickActions(can).map((a) => a.key),
    };
  };

  it('Owner: all seven primary destinations, approvals pinned, every quick action', () => {
    const n = navOf('Owner');
    expect(n.primary).toEqual(['Dashboard', 'Purchases & Lots', 'Milling', 'Inventory', 'Export Orders', 'Finance', 'Reports']);
    expect(n.pinned).toEqual(['/approvals']);
    expect(n.quick).toEqual(['purchase', 'batch', 'export', 'receive', 'pay']);
    expect(n.more).toEqual(expect.arrayContaining(['/quality', '/mill-store', '/stock-count', '/admin', '/audit']));
  });

  it('Mill Operator: mill work and Mill Finance — no export, company finance or statements', () => {
    const n = navOf('Mill Operator');
    expect(n.leaves).toEqual(expect.arrayContaining(['/milling', '/milling/finance', '/lot-inventory', '/stock-summary', '/mill-store']));
    for (const p of ['/export', '/buyers', '/finance', '/milling/customers', '/milling/statements', '/admin']) {
      expect(n.leaves).not.toContain(p);
    }
    // inventory.create (Create Purchase) is not a Mill Operator permission
    expect(n.quick).toEqual(['batch']);
  });

  it('Export Manager: orders, buyers, documents, finance — no mill store or admin', () => {
    const n = navOf('Export Manager');
    expect(n.leaves).toEqual(expect.arrayContaining(['/export', '/buyers', '/documents', '/finance', '/reports']));
    for (const p of ['/mill-store', '/admin', '/milling/service']) expect(n.leaves).not.toContain(p);
    expect(n.quick).toEqual(expect.arrayContaining(['export', 'receive', 'pay']));
    expect(n.quick).not.toContain('purchase'); // no inventory.create
  });

  it('Finance Manager: no operational Dashboard entry (home is Finance); approvals pinned', () => {
    const n = navOf('Finance Manager');
    expect(n.primary).not.toContain('Dashboard');
    expect(n.primary).toContain('Finance');
    expect(n.pinned).toEqual(['/approvals']);
  });

  it('QC Analyst: quality pages, no quick actions, no mill money — approvals still pinned', () => {
    const n = navOf('QC Analyst');
    expect(n.quick).toEqual([]);
    expect(n.pinned).toEqual(['/approvals']);
    expect(n.leaves).toContain('/quality');
    expect(n.leaves).not.toContain('/milling/finance');
  });

  it('the approvals badge shows in the header and the pinned sidebar entry', () => {
    mockApprovals = 4;
    const html = render('Owner');
    expect(html).toMatch(/data-testid="approvals-badge"[\s\S]*?>4<\/span>/);
    expect(html).toContain('data-testid="pinned-nav"');
  });

  it('Mill and Export brand the shell; Owner keeps the company name', () => {
    expect(render('Mill Manager')).toContain('MILL OPERATIONS');
    expect(render('Export Manager')).toContain('EXPORT DESK');
    expect(render('Owner')).toContain('AGRI COMMODITIES');
  });
});
