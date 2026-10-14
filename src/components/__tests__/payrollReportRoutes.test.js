import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// P1-06 / D-24: salaries are for payroll.view only. Every shell that mounts a
// /reports/payroll* page must wrap it in a payroll.view guard — reports.view
// alone is held by Export Manager, QC and Inventory roles.
const SRC = fileURLToPath(new URL('../..', import.meta.url));
const src = (p) => readFileSync(resolve(SRC, p), 'utf8');
const app = src('App.jsx');

const shellBody = (name) => {
  const start = app.indexOf(`function ${name}()`);
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf('\nfunction ', start + 1);
  return app.slice(start, end === -1 ? undefined : end);
};

describe('payroll report routes need payroll.view in every shell', () => {
  const shells = ['ExportRoutes', 'MillRoutes', 'StandardRoutes'];
  it.each(shells)('%s', (name) => {
    const routes = [...shellBody(name).matchAll(/<Route\s+path="(\/reports\/payroll[^"]*)"[^\n]*/g)];
    for (const [line] of routes) {
      expect(line).toContain('<ProtectedRoute module="payroll" action="view">');
    }
  });

  it('no payroll report route is mounted bare anywhere in App.jsx', () => {
    const all = [...app.matchAll(/<Route\s+path="\/reports\/payroll[^"]*"[^\n]*/g)].map((m) => m[0]);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const line of all) expect(line).toContain('module="payroll" action="view"');
  });
});

describe('Finance overview payroll strip', () => {
  it('only renders for payroll.view', () => {
    const page = src('modules/finance/pages/FinanceOverview.jsx');
    expect(page).toContain("{hasPermission('payroll', 'view') && <PayrollSummaryStrip");
  });
});
