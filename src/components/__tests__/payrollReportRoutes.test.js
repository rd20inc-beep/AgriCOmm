import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_GATES, canOpen } from '../../app/routeGates';
import { ROLE_PERMISSIONS, permsFor } from '../../test/fixtures/rolePermissions';

// P1-06 / D-24: salaries are for payroll.view only. Every /reports/payroll*
// route in the one route table needs payroll.view — reports.view alone is
// held by Export Manager, QC and Inventory roles.
const SRC = fileURLToPath(new URL('../..', import.meta.url));
const src = (p) => readFileSync(resolve(SRC, p), 'utf8');

describe('payroll report routes need payroll.view', () => {
  const payrollRoutes = ROUTE_GATES.filter((r) => r.path.startsWith('/reports/payroll'));

  it('every /reports/payroll* route is gated on payroll.view', () => {
    expect(payrollRoutes.map((r) => r.path).sort()).toEqual(['/reports/payroll', '/reports/payroll-analytics']);
    for (const r of payrollRoutes) expect(r.gate).toEqual({ module: 'payroll', action: 'view' });
  });

  it.each(Object.keys(ROLE_PERMISSIONS))('%s opens payroll reports only with payroll.view', (role) => {
    const can = permsFor(role);
    const hasPayroll = can('payroll', 'view');
    for (const r of payrollRoutes) expect(canOpen(r.path, can)).toBe(hasPayroll);
  });

  it('the finance payroll workspace keeps its own payroll.view guard', () => {
    const table = src('app/routeTable.jsx');
    expect(table).toContain('<Route path="payroll" element={<ProtectedRoute module="payroll" action="view"><FinancePayroll /></ProtectedRoute>} />');
  });
});

describe('Finance overview payroll strip', () => {
  it('only renders for payroll.view', () => {
    const page = src('modules/finance/pages/FinanceOverview.jsx');
    expect(page).toContain("{hasPermission('payroll', 'view') && <PayrollSummaryStrip");
  });
});
