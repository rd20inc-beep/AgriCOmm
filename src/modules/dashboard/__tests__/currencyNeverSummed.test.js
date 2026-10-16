// P4-09: PKR and USD are never summed. The headline screens that used to add
// every order's contractValue (USD and PKR alike) in the browser now read the
// server's per-currency order book; this guards against the sums coming back.
/* global process */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { byCurrencyText } from '../../finance/utils/currencyTiles';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// `… + (Number(o.contractValue) …` / `… + (o.contractValue || 0)` inside a reduce.
const CONTRACT_SUM = /\+\s*\(?\s*(Number\()?\s*o\.contractValue/;

describe('no browser sum of contract values across currencies', () => {
  it.each([
    'src/modules/dashboard/pages/Dashboard.jsx',
    'src/modules/exportOrders/pages/ExportHomeDashboard.jsx',
    'src/modules/analytics/pages/ScenarioSimulator.jsx',
  ])('%s', (file) => {
    expect(read(file)).not.toMatch(CONTRACT_SUM);
  });

  it('the dashboards read the server order book', () => {
    expect(read('src/modules/dashboard/pages/Dashboard.jsx')).toMatch(/useExportOrderBook/);
    expect(read('src/modules/exportOrders/pages/ExportHomeDashboard.jsx')).toMatch(/useExportOrderBook/);
  });

  it('the export list margin comes from the server profit row', () => {
    const src = read('src/modules/exportOrders/pages/ExportOrders.jsx');
    expect(src).toMatch(/order\.profit\?\.marginPct/);
    expect(src).not.toMatch(/cv - totalCosts/);
  });

  it('the orphan pages that summed PKR and USD are gone', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/modules/finance/pages/CostAllocation.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'src/modules/finance/pages/Reconciliation.jsx'))).toBe(false);
  });
});

describe('byCurrencyText', () => {
  it('shows each currency on its own, USD first', () => {
    const t = byCurrencyText({ PKR: 1500000, USD: 25000 });
    expect(t.primary).toMatch(/\$25,000/);
    expect(t.rest).toMatch(/^\+ Rs 1,500,000$/);
    expect(t.all).toMatch(/\$25,000 · Rs 1,500,000/);
  });

  it('a missing map is "—", an empty one is zero', () => {
    expect(byCurrencyText(null).primary).toBe('—');
    expect(byCurrencyText({}).rest).toBeNull();
  });
});
