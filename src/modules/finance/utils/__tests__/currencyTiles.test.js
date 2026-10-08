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

// C6: received ÷ amounts DUE, against the server's configurable target (not a
// hard-coded 80%); the warning is the overdue amount in its own currency.
describe('Collection Rate tile', () => {
  const coll = (byCurrency, targetPct = 95) => ({ collection: { targetPct, byCurrency } });

  it('one rate per currency, flags those below their target, and names the overdue amounts', () => {
    const t = collectionTile(coll({
      USD: { ratePct: 97.2, targetPct: 95, onTarget: true, overdueAmount: 500 },
      PKR: { ratePct: 17.9, targetPct: 95, onTarget: false, overdueAmount: 821395 },
    }));
    expect(t.primary).toBe('USD 97.2% · PKR 17.9%');
    expect(t.secondary).toBe('Received vs due, per currency');
    expect(t.hint).toBe('Below PKR 95% target · $500.00 + Rs 821,395 overdue');
    expect(t.bad).toBe(true);
  });

  it('a single currency on target', () => {
    const t = collectionTile(coll({ USD: { ratePct: 96, targetPct: 95, onTarget: true, overdueAmount: 0 } }));
    expect(t.primary).toBe('96%');
    expect(t.hint).toBe('On target (≥ 95%)');
    expect(t.bad).toBe(false);
  });

  it('the target comes from the server, not 80%', () => {
    const t = collectionTile(coll({ USD: { ratePct: 85, targetPct: 80, onTarget: true, overdueAmount: 150 } }, 80));
    expect(t.hint).toBe('On target (≥ 80%) · $150.00 overdue');
    const strict = collectionTile(coll({ USD: { ratePct: 85, targetPct: 95, onTarget: false, overdueAmount: 150 } }));
    expect(strict.hint).toBe('Below 95% target · $150.00 overdue');
    expect(strict.bad).toBe(true);
  });

  it('nothing due yet is a dash, not 0%', () => {
    expect(collectionTile(coll({}))).toMatchObject({ primary: '—', hint: 'Nothing due yet', bad: false });
  });

  it('an older payload (rates only) uses the 95% default', () => {
    const t = collectionTile({ collectionRate: 92, collectionRateByCurrency: { USD: 92 } });
    expect(t.hint).toBe('Below 95% target');
    expect(t.bad).toBe(true);
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

// C5 / G-1: a figure that spans currencies keeps its native PKR and USD
// amounts; one secondary line adds the PKR equivalent at each row's OWN
// booked rate. It is never folded into the figure.
describe('≈ PKR equivalent (booked rates)', () => {
  it('a receivable converts at its booked base_amount_pkr scaled to what is outstanding', async () => {
    const { receivablePkrAtBooked } = await import('../currencyTiles');
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 750, expectedAmount: 1000, baseAmountPkr: 282000 })).toBe(211500);
    // No booked figure → the row's booked fx_rate; neither → null (left out, counted).
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 10, fxRate: 280 })).toBe(2800);
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 10 })).toBeNull();
    expect(receivablePkrAtBooked({ currency: 'PKR', outstanding: 5000 })).toBe(5000);
  });

  it('labels the line as booked rates, counts rows without a rate, and is null for a PKR-only list', async () => {
    const { receivablesPkrEquiv, pkrEquivText } = await import('../currencyTiles');
    const rows = [
      { currency: 'USD', outstanding: 1000, expectedAmount: 1000, baseAmountPkr: 282000 },
      { currency: 'PKR', outstanding: 18000 },
      { currency: 'USD', outstanding: 5 },
    ];
    expect(pkrEquivText(receivablesPkrEquiv(rows))).toBe('≈ PKR equiv. Rs 300,000 (booked rates; 1 without a rate left out)');
    expect(pkrEquivText(receivablesPkrEquiv([{ currency: 'PKR', outstanding: 1 }]))).toBeNull();
  });

  it("today's rate is said, with its date — never presented as booked", async () => {
    const { pkrEquivText, upcomingPkrEquiv } = await import('../currencyTiles');
    expect(pkrEquivText({ pkr: 2820000, basis: 'today', rateDate: '2026-10-09', foreign: true }))
      .toBe("≈ PKR equiv. Rs 2,820,000 at today's rate (2026-10-09)");
    const mixed = upcomingPkrEquiv([
      { currency: 'USD', amount: 100, amountPkr: 28200, pkrBasis: 'booked' },
      { currency: 'USD', amount: 10, amountPkr: 2820, pkrBasis: 'today' },
      { currency: 'PKR', amount: 1000, amountPkr: 1000, pkrBasis: 'native' },
    ], { rateDate: '2026-10-09' });
    expect(pkrEquivText(mixed)).toBe("≈ PKR equiv. Rs 32,020 (booked rates; 1 at today's rate 2026-10-09)");
  });

  it('the Receivables tile keeps the native figures and carries the equivalent apart', () => {
    const t = receivablesTile({
      count: 2,
      byCurrency: { USD: { outstanding: 1000, overdueAmount: 0 }, PKR: { outstanding: 18000, overdueAmount: 0 } },
      pkrEquiv: { pkr: 300000, basis: 'booked', missingCount: 0 },
    });
    expect(t.primary).toBe('$1,000.00');
    expect(t.secondary).toBe('2 open · + Rs 18,000');
    expect(t.equiv).toBe('≈ PKR equiv. Rs 300,000 (booked rates)');
    expect(`${t.primary} ${t.secondary}`).not.toMatch(/300,000/);
  });
});
