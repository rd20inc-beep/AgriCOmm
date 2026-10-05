import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { canSeeCost, canSeeProfit, visibleColumns } from '../useCanSeeCost';
import { StockReportView, costCols } from '../../modules/analytics/pages/PrintableReportsViews';

/**
 * Owner decision 2026-10-05: purchase rates, stock value and profit are hidden
 * from the Mill Operator and the QC Analyst; reports.view_cost (or finance.view)
 * keeps them. These run the real rule and the real print view.
 */
const perms = (...keys) => (module, action) => keys.includes(`${module}.${action}`);

const MILL_OPERATOR = perms('reports.view', 'milling.view', 'inventory.view');
const QC_ANALYST = perms('milling.view', 'milling.approve_quality', 'inventory.view');
const MILL_MANAGER = perms('milling.view', 'inventory.view', 'reports.view', 'reports.view_cost', 'reports.view_profit');
const FINANCE = perms('finance.view', 'reports.view');

describe('canSeeCost', () => {
  it('hides cost from the Mill Operator and the QC Analyst', () => {
    expect(canSeeCost(MILL_OPERATOR)).toBe(false);
    expect(canSeeCost(QC_ANALYST)).toBe(false);
    expect(canSeeProfit(MILL_OPERATOR)).toBe(false);
  });
  it('keeps cost for reports.view_cost and for finance access', () => {
    expect(canSeeCost(MILL_MANAGER)).toBe(true);
    expect(canSeeCost(FINANCE)).toBe(true);
    expect(canSeeProfit(MILL_MANAGER)).toBe(true);
  });
  it('fails closed without a permission function', () => {
    expect(canSeeCost(undefined)).toBe(false);
  });
});

describe('column filtering', () => {
  const columns = [
    { key: 'lot', label: 'Lot' },
    { key: 'kg', label: 'On hand' },
    { key: 'rate', label: 'Rate/kg', cost: true },
    { key: 'value', label: 'Value', cost: true },
    { key: 'profit', label: 'Profit', profit: true },
  ];
  it('drops cost and profit columns for a cost-blind viewer', () => {
    expect(visibleColumns(columns, { cost: canSeeCost(MILL_OPERATOR) }).map((c) => c.key)).toEqual(['lot', 'kg']);
  });
  it('keeps every column for a cost viewer', () => {
    expect(visibleColumns(columns, { cost: canSeeCost(MILL_MANAGER) }).map((c) => c.key)).toEqual(['lot', 'kg', 'rate', 'value', 'profit']);
  });
  it('costCols removes the given indexes only when cost is hidden', () => {
    expect(costCols(false, [1, 3])(['a', 'b', 'c', 'd'])).toEqual(['a', 'c']);
    expect(costCols(true, [1, 3])(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('printable stock report', () => {
  const data = {
    asOf: '2026-10-05T00:00:00Z',
    groupBy: 'product',
    grand: { lotCount: 1, totalKg: 1000, bags: 20, bagUnits: 0, availableKg: 800, reservedKg: 0, perKg: 125, valuePkr: 125000 },
    rows: [{ name: 'Super Basmati', lotCount: 1, totalKg: 1000, bags: 20, bagUnits: 0, availableKg: 800, reservedKg: 0, perKg: 125, valuePkr: 125000, lots: [] }],
  };
  const html = (showCost) => renderToStaticMarkup(
    <MemoryRouter><StockReportView data={data} companyName="Mill" groupLabel="Products" showCost={showCost} /></MemoryRouter>,
  );

  it('prints no per-kg or value column for the Mill Operator', () => {
    const out = html(canSeeCost(MILL_OPERATOR));
    expect(out).toContain('Super Basmati');
    expect(out).toContain('On hand (kg)');
    expect(out).not.toContain('Value (PKR)');
    expect(out).not.toContain('Per kg');
    expect(out).not.toContain('125,000');
  });

  it('prints them for the Mill Manager', () => {
    const out = html(canSeeCost(MILL_MANAGER));
    expect(out).toContain('Value (PKR)');
    expect(out).toContain('125,000');
  });
});
