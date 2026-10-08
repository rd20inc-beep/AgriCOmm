import { describe, it, expect } from 'vitest';
import { receivablesTile, collectionTile } from '../currencyTiles';

// Finance Overview: the Receivables tile showed ≈ $943,016 — the PKR opening
// receivables (Rs 821,395) added into the USD figure ($121,621.10), and the
// rupee overdue amount labelled $. Each currency now stands on its own.
describe('Receivables tile', () => {
  const recv = {
    count: 6,
    byCurrency: {
      USD: { count: 4, outstanding: 121621.1, overdueCount: 1, overdueAmount: 3172 },
      PKR: { count: 2, outstanding: 821395, overdueCount: 2, overdueAmount: 821395 },
    },
  };

  it('shows USD and PKR separately, never a sum', () => {
    const t = receivablesTile(recv);
    expect(t.primary).toBe('$121,621.10');
    expect(t.secondary).toBe('6 open · + Rs 821,395');
    expect(`${t.primary} ${t.secondary}`).not.toMatch(/943,016/);
  });

  it('labels each overdue figure in its own currency', () => {
    expect(receivablesTile(recv).overdue).toBe('$3,172.00 + Rs 821,395 overdue');
  });

  it('a PKR-only book leads with rupees, and nothing overdue reads as current', () => {
    const t = receivablesTile({ count: 1, byCurrency: { PKR: { outstanding: 5000, overdueAmount: 0 } } });
    expect(t.primary).toBe('Rs 5,000');
    expect(t.overdue).toBeNull();
  });
});

describe('Collection Rate tile', () => {
  it('shows one rate per currency and flags the ones below 80%', () => {
    const t = collectionTile({ collectionRate: null, collectionRateByCurrency: { USD: 85.2, PKR: 17.9 } });
    expect(t.primary).toBe('USD 85.2% · PKR 17.9%');
    expect(t.hint).toBe('Below 80% (PKR)');
    expect(t.bad).toBe(true);
  });

  it('a single currency reads as before', () => {
    const t = collectionTile({ collectionRate: 92, collectionRateByCurrency: { USD: 92 } });
    expect(t.primary).toBe('92%');
    expect(t.hint).toBe('On target');
    expect(t.bad).toBe(false);
  });

  it('no receivables at all shows a dash, not 0%', () => {
    expect(collectionTile({ collectionRate: null }).primary).toBe('—');
  });
});

describe('nativeTotals (Upcoming cheques & dues)', () => {
  it('keeps each currency separate, PKR first, never a converted total', async () => {
    const { nativeTotals } = await import('../currencyTiles');
    const text = nativeTotals([
      { amount: 739361, currency: 'PKR' }, { amount: 82034, currency: 'PKR' },
      { amount: 2650, currency: 'USD', amountPkr: 747300 }, { amount: 4294.62, currency: 'usd' },
    ]);
    expect(text).toMatch(/^Rs\s?821,395/);
    expect(text).toMatch(/\$6,94[45]/);
    expect(text).not.toMatch(/35,|1,568/); // no PKR-equivalent sum
  });
  it('empty → Rs 0', async () => {
    const { nativeTotals } = await import('../currencyTiles');
    expect(nativeTotals([])).toMatch(/Rs\s?0/);
  });
});
