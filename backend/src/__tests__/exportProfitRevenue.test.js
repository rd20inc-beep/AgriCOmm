/**
 * EXP-09 / D-16 / P4-09 — the pure parts (no database): the per-order export
 * profit row, the revenue-date rule and the order-book fold.
 */
const pd = require('../modules/finance/profitDefinitions');
const { foldOrderBook } = require('../modules/exportOrders/orderBook');

const emptyCtx = (over = {}) => ({
  costs: [], reserved: [], lines: [], debitNotes: [], printedBags: [], rates: [], masterRates: [],
  rateByProduct: new Map(), masterByProduct: new Map(), masterAny: null, ...over,
});

describe('EXP-09: export revenue beyond the goods', () => {
  test('separately charged freight is revenue at the booked rate; freight in the price is not added', () => {
    const o = { currency: 'USD', contract_value: 10000, freight_display: 'separate', freight_per_mt: 20, insurance_per_mt: 5, qty_mt: 10 };
    expect(pd.extraRevenuePkr(o, { currency: 'USD', bookedRate: 280 }, null).freightPkr).toBe(70000);
    expect(pd.extraRevenuePkr({ ...o, freight_display: 'in_price' }, { currency: 'USD', bookedRate: 280 }, null).freightPkr).toBe(0);
    // No booked rate: the rate the locked figure implies, else unpriced (null).
    expect(pd.extraRevenuePkr({ ...o, contract_value_pkr_locked: 2750000 }, { currency: 'USD', bookedRate: 0 }, null).freightPkr).toBe(68750);
    expect(pd.extraRevenuePkr(o, { currency: 'USD', bookedRate: 0 }, null).freightPkr).toBeNull();
  });

  test('a row adds freight + debit notes to revenue and printed bags to op costs', () => {
    const o = {
      id: 7, status: 'Shipped', currency: 'USD', booked_fx_rate: 280, contract_value: 10000, contract_value_pkr_locked: 2800000,
      inventory_cogs_total_pkr: 1500000, cost_locked_at_dispatch: true, qty_mt: 10,
      freight_display: 'separate', freight_per_mt: 20, shipped_on: '2092-03-05', created_at: '2092-01-10',
    };
    const row = pd.buildExportRow(o, emptyCtx({
      costs: [{ order_id: 7, category: 'freight', amount: 30000, currency: 'PKR' }],
      debitNotes: [{ order_id: 7, n: 1, amount_pkr: 28000 }],
      printedBags: [{ order_id: 7, n: 1, amount_pkr: 12000 }],
    }));
    expect(row.revenuePkr).toBe(2884000);
    expect(row.opCostsPkr).toBe(42000);
    expect(row.realisedProfitPkr).toBe(1342000);
    expect(row.revenueDate).toBe('2092-03-05');
    expect(row.inBookedPeriod).toBe(true); // outside a period: by status
  });

  test('a foreign order with freight but no rate is unpriced, never read as rupees', () => {
    const row = pd.buildExportRow({
      id: 8, status: 'Awaiting Advance', currency: 'USD', contract_value: 1000, qty_mt: 1,
      freight_display: 'separate', freight_per_mt: 10,
    }, emptyCtx());
    expect(row.revenuePkr).toBeNull();
    expect(row.priced).toBe(false);
  });
});

describe('D-16: the export revenue date', () => {
  test('BL date, else the Shipped transition, else atd', () => {
    const sql = pd.exportRevenueDateSql('o');
    expect(sql.indexOf('o.bl_date')).toBeLessThan(sql.indexOf("to_status = 'Shipped'"));
    expect(sql.indexOf("to_status = 'Shipped'")).toBeLessThan(sql.indexOf('o.atd'));
    expect(pd.bookedDateSql('o')).toBe('o.created_at');
  });
});

describe('P4-09: the order book fold', () => {
  const groups = [
    { status: 'Advance Received', currency: 'USD', n: 2, value: 20000, pkr: 5600000, pkr_missing: 0 },
    { status: 'Awaiting Advance', currency: 'USD', n: 1, value: 1000, pkr: null, pkr_missing: 1 },
    { status: 'In Milling', currency: 'PKR', n: 1, value: 5000000, pkr: 5000000, pkr_missing: 0 },
    { status: 'Draft', currency: 'USD', n: 3, value: 99999, pkr: 0, pkr_missing: 0 },
    { status: 'Cancelled', currency: 'PKR', n: 1, value: 777, pkr: 777, pkr_missing: 0 },
  ];
  test('per currency, Draft / Cancelled out, ≈ PKR at booked rates with the unrated counted', () => {
    const { orderBook, statusFig } = foldOrderBook(groups);
    expect(orderBook.byCurrency).toEqual({ USD: 21000, PKR: 5000000 });
    expect(orderBook.count).toBe(4);
    expect(orderBook.pkrEquiv.pkr).toBe(10600000);
    expect(orderBook.pkrEquiv.missingCount).toBe(1);
    const fresh = statusFig(['Draft', 'Awaiting Advance']);
    expect(fresh.count).toBe(4);
    expect(fresh.draftCount).toBe(3);
    expect(fresh.byCurrency).toEqual({ USD: 1000 });
  });
});
