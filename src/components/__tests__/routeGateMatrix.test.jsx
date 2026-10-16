import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ROLE_PERMISSIONS, permsFor } from '../../test/fixtures/rolePermissions';
import { ROUTE_GATES, canOpen, passesGate } from '../../app/routeGates';

/**
 * P5-05 — route-gate matrix per seeded role, the page gate equal to the
 * backend gate of what the page loads, and the "not available" page instead
 * of a silent redirect home.
 */

let mockRole = 'Owner';
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: mockRole, permissions: ROLE_PERMISSIONS[mockRole] || [] },
    hasPermission: (m, a) => permsFor(mockRole)(m, a),
    isAuthenticated: true,
    isLoading: false,
  }),
}));
const { Gated } = await import('../../app/routeTable');
const { default: NotAvailable } = await import('../../shared/components/NotAvailable');

// [path, roles that may open it] — the backend's authorize() for the page's data.
const MATRIX = [
  ['/milling/finance', ['Owner', 'Super Admin', 'Mill Manager', 'Mill Operator', 'Export Manager', 'Read-Only Auditor']],
  ['/milling/statements', ['Owner', 'Super Admin', 'Mill Manager', 'Export Manager', 'Finance Manager', 'Read-Only Auditor']],
  ['/finance/money-in', ['Owner', 'Super Admin', 'Mill Manager', 'Export Manager', 'Finance Manager', 'Read-Only Auditor']],
  ['/export/create', ['Owner', 'Super Admin', 'Export Manager']],
  ['/export/7', ['Owner', 'Super Admin', 'Mill Manager', 'Export Manager', 'Inventory Officer', 'Documentation Officer', 'Read-Only Auditor']],
  ['/mill-store/adjustments', ['Owner', 'Super Admin', 'Mill Manager', 'Mill Operator', 'QC Analyst', 'Read-Only Auditor']],
  ['/reports/payroll', ['Owner', 'Super Admin', 'Mill Manager', 'Finance Manager', 'Read-Only Auditor']],
  ['/admin', ['Owner', 'Super Admin', 'Mill Manager', 'Read-Only Auditor']],
  ['/documents', ['Owner', 'Super Admin', 'Export Manager', 'Documentation Officer', 'Read-Only Auditor']],
  ['/lot-inventory/9/purchase-invoice', ['Owner', 'Super Admin', 'Mill Manager', 'Mill Operator', 'Export Manager', 'Read-Only Auditor']],
  // D-20: the inbox is open to everyone (it filters per approval type);
  // the old admin approvals page keeps admin.view.
  ['/approvals', Object.keys(ROLE_PERMISSIONS)],
  ['/approvals/legacy', ['Owner', 'Super Admin', 'Mill Manager', 'Read-Only Auditor']],
  // Stock transfers: inventory.view or finance.view
  ['/transfer', ['Owner', 'Super Admin', 'Mill Manager', 'Mill Operator', 'Export Manager', 'Finance Manager', 'Inventory Officer', 'QC Analyst', 'Read-Only Auditor']],
  ['/profile', Object.keys(ROLE_PERMISSIONS)],
];

describe('route-gate matrix (seeded roles)', () => {
  it.each(MATRIX)('%s', (path, allowed) => {
    const opens = Object.keys(ROLE_PERMISSIONS).filter((r) => canOpen(path, permsFor(r))).sort();
    expect(opens).toEqual([...allowed].sort());
  });

  it('every route is either open to all or names a permission', () => {
    for (const { path, gate } of ROUTE_GATES) {
      if (gate) expect([path, !!(gate.module || gate.anyOf?.length)]).toEqual([path, true]);
    }
  });

  it('Mill Operator only gets pages whose data it can load', () => {
    const can = permsFor('Mill Operator');
    // its mill-money pages need reports.view_cost — which it holds since mig 314
    expect(passesGate(ROUTE_GATES.find((r) => r.path === '/milling/finance').gate, can)).toBe(true);
    // company finance / statements / customers read finance.view or export_orders.view
    for (const p of ['/finance', '/milling/statements', '/milling/customers', '/export']) expect(canOpen(p, can)).toBe(false);
  });
});

const renderGated = (role, gate) => {
  mockRole = role;
  return renderToStaticMarkup(<MemoryRouter><Gated gate={gate}><b>PAGE</b></Gated></MemoryRouter>);
};

describe('Gated renders through ProtectedRoute', () => {
  it('allows the page when the gate passes', () => {
    expect(renderGated('Export Manager', { module: 'export_orders', action: 'create' })).toContain('PAGE');
  });
  it('shows Access Denied (not the page, not home) when it does not', () => {
    const html = renderGated('Mill Operator', { module: 'export_orders', action: 'view' });
    expect(html).not.toContain('PAGE');
    expect(html).toContain('Access Denied');
  });
  it('anyOf gates need one of them', () => {
    const gate = { module: 'milling', action: 'view', anyOf: [{ module: 'reports', action: 'view_cost' }, { module: 'finance', action: 'view' }] };
    expect(renderGated('Mill Operator', gate)).toContain('PAGE');
    expect(renderGated('QC Analyst', gate)).not.toContain('PAGE');
  });
});

describe('unknown URL', () => {
  it('shows "Not available in your workspace" with the path', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/old/thing']}>
        <Routes><Route path="*" element={<NotAvailable />} /></Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('Not available in your workspace');
    expect(html).toContain('/old/thing');
  });
});
