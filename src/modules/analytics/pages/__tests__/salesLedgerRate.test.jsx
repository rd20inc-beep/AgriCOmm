import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SalesLedgerView } from '../PrintableReportsViews';

/**
 * Sales Ledger, Export Orders: an order's rate is contract value ÷ total qty.
 * On a multi-line order (24 MT @ 1290 + 24 MT @ 1250) that is an AVERAGE —
 * 1270 is nobody's rate — so it prints "avg $1,270.00" with the line range.
 * A single-line order prints exactly as before.
 */
const row = (over) => ({
  id: 1, ref: 'EX-001', date: '2026-10-01', customer: 'Buyer', customerId: null, item: 'Super Basmati',
  mt: 48, bags: 0, ratePerMt: 1270, valueUsd: 60960, status: 'Confirmed', ...over,
});
const render = (exp) => renderToStaticMarkup(
  <MemoryRouter>
    <SalesLedgerView
      data={{ local: [], export: exp, totals: { localCount: 0, localMt: 0, localPkr: 0, exportCount: exp.length, exportMt: 0, exportUsd: 0 } }}
      companyName="Agri"
    />
  </MemoryRouter>,
);

describe('Sales Ledger — export order rate', () => {
  it('labels a multi-line order\'s rate as an average, with the line range', () => {
    const html = render([row({ rateMixed: true, rateLabel: 'Avg price per MT', rateMin: 1250, rateMax: 1290 })]);
    expect(html).toContain('avg $1,270.00');
    expect(html).toContain('$1,250.00–$1,290.00');
    expect(html).toContain('avg $1.270');
  });

  it('prints a single-line order\'s rate as before', () => {
    const html = render([row({ id: 2, ref: 'EX-002', mt: 24, ratePerMt: 1290, valueUsd: 30960, rateMixed: false, rateMin: 1290, rateMax: 1290 })]);
    expect(html).toContain('<td class="px-3 py-1.5 text-right">$1,290.00</td>');
    expect(html).toContain('<td class="px-3 py-1.5 text-right">$1.290</td>');
    expect(html).not.toContain('avg');
  });

  it('a row from an older API without the flag still prints the plain rate', () => {
    const html = render([row({ ratePerMt: 1290 })]);
    expect(html).toContain('$1,290.00');
    expect(html).not.toContain('avg');
  });
});
