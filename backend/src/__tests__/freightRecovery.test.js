/**
 * Freight recovery — charged to buyers against paid to carriers.
 *
 * While ocean freight is volatile this is the number that decides whether the
 * freight terms are working. The aggregate can look covered while half the
 * shipments lose money, so the report is per order and the short ones are called
 * out rather than averaged away.
 *
 * Verified against a real Postgres with four orders (freight charged separately,
 * freight inside a CIF price, freight paid and never billed, and plain FOB) plus
 * an escalation debit note; both ledger rows reconciled to zero.
 *
 * The export-order side (which account a cost posts to) is RUN here: addCost
 * against an in-memory database. The report's own queries are joins and raw SQL
 * the in-memory database can't run, so those checks still read the controller.
 */
jest.mock('../config/database', () => require('./helpers/memoryDb').db);
const mockJournals = [];
const mockAccounting = {
  createJournal: jest.fn(async (_trx, j) => { mockJournals.push(j); return { id: mockJournals.length }; }),
  postJournal: jest.fn(async () => {}),
};
jest.mock('../services/accountingService', () => mockAccounting);
jest.mock('../modules/accounting/accounting.service', () => mockAccounting);

const fs = require('fs');
const path = require('path');
const CTRL = fs.readFileSync(path.join(__dirname, '../modules/analytics/reporting.controller.js'), 'utf8');

// The report's own rules, restated so they can be exercised.
const RATE = 280;
const charged = (perMt, qty, notesPkr = 0) => perMt * qty * RATE + notesPkr;
const recovery = (chargedPkr, paidPkr) => (paidPkr > 0 ? (chargedPkr / paidPkr) * 100 : null);

describe('what the report measures', () => {
  it('charged is the freight terms plus any escalation claims', () => {
    // 58.00 + 4.50 per MT over 24 MT at 280, plus a 120,960 debit note.
    expect(charged(62.5, 24, 120960)).toBe(540960);
  });

  it('recovery is a percentage of what was PAID — 100% is break-even', () => {
    expect(recovery(540960, 480000)).toBeCloseTo(112.7, 1);
    expect(recovery(336000, 336000)).toBe(100);
    expect(recovery(0, 268800)).toBe(0);
  });

  it('an order with neither charge nor cost is not scored', () => {
    // Listing it keeps the report honest; scoring it would drag the average
    // toward a number that means nothing.
    expect(recovery(0, 0)).toBeNull();
    expect(CTRL).toContain('const measurable = chargedPkr > 0 || paidPkr > 0');
    expect(CTRL).toContain('const scored = rows.filter((r) => r.measurable)');
  });

  it('freight paid and never billed is the worst case, and is flagged', () => {
    expect(CTRL).toContain('unbilled: paidPkr > 0 && chargedPkr <= 0');
    expect(CTRL).toContain('unbilledOrders');
  });

  it('both sides are stated in PKR at the order’s booked rate', () => {
    // A USD freight charge and a PKR carrier invoice cannot be subtracted.
    expect(CTRL).toContain('parseFloat(o.booked_fx_rate)');
    expect(CTRL).toContain('contract_value_pkr_locked');
  });

  it('a cancelled debit note is a withdrawn claim and does not count', () => {
    expect(CTRL).toContain("andWhere('status', 'Issued')");
  });
});

describe('the ledger comparison holds like against like', () => {
  it('only SEPARATELY charged freight is compared with 4070', () => {
    // Freight inside a CFR/CIF price is invoiced as part of the goods and is
    // recognised in Export Sales, so comparing all of it with 4070 would show a
    // difference on every order that quotes CIF — permanently, and wrongly.
    expect(CTRL).toContain('const baseIn4070Pkr = separate ? basePkr : 0');
    expect(CTRL).toContain('inSalesPkr');
  });

  it('freight not yet shipped is subtracted, because it is not posted yet', () => {
    // Freight revenue is recognised at shipment. Without this line every order
    // still in flight reads as a discrepancy.
    expect(CTRL).toContain('awaitingShipmentPkr');
    expect(CTRL).toContain('revenuePosted: o.revenue_posted === true');
  });

  it('but a debit note is NOT subtracted — it posts the day it is raised', () => {
    // Deducting it would leave the reconciliation short by exactly the notes
    // outstanding, which is how this was caught.
    expect(CTRL).toMatch(/awaitingShipmentPkr:[\s\S]{0,200}r\.baseIn4070Pkr/);
    expect(CTRL).not.toMatch(/awaitingShipmentPkr:[\s\S]{0,200}r\.in4070Pkr/);
  });

  it('the ledger side counts POSTED journals only', () => {
    const gl = CTRL.slice(CTRL.indexOf('async function freightGlTotals'), CTRL.indexOf('function emptyFreightTotals'));
    expect(gl).toContain("andWhere('je.status', 'Posted')");
    // Revenue is a credit balance, expense a debit one — reading both the same
    // way would put the recovery in the wrong direction.
    expect(gl).toContain('recovered.credit - recovered.debit');
    expect(gl).toContain('freight.debit - freight.credit');
  });
});

describe('a cost reaches the account built for it', () => {
  const { reset } = require('./helpers/memoryDb');
  const controller = require('../modules/exportOrders/exportOrders.controller');
  const CHART = [
    ['6000', 'Operating Expenses'], ['6010', 'Freight & Shipping'], ['6020', 'Clearing & Forwarding'],
    ['6030', 'Loading Charges'], ['6050', 'Insurance'], ['6060', 'Commission & Brokerage'],
    ['2010', 'Supplier Payable'],
  ].map(([code, name], i) => ({ id: i + 1, code, name }));

  // Records a cost and returns the account code its journal debited.
  async function debitedFor(category, chart = CHART) {
    mockJournals.length = 0;
    reset({
      export_orders: [{ id: 1, order_no: 'EX-001', booked_fx_rate: 280 }],
      export_order_costs: [], payables: [], chart_of_accounts: chart,
    });
    const res = { status() { return this; }, json(b) { this.body = b; return this; } };
    await controller.addCost({ params: { id: '1' }, body: { category, amount: 10000 }, user: { id: 1 } }, res);
    expect(res.body && res.body.success).toBe(true);
    const debit = mockJournals[0].lines.find((l) => l.debit > 0);
    return chart.find((a) => a.id === debit.account_id).code;
  }

  // The chart has had 6010/6020/6030/6050/6060 since it was seeded and addCost
  // used to post every category to 6000, so the P&L could say what an order
  // cost in total but never what it was spent ON — and 6010 stayed empty while
  // freight was being paid, which is what made this report impossible.
  it.each([
    ['freight', '6010'], ['insurance', '6050'], ['clearing', '6020'],
    ['loading', '6030'], ['commission', '6060'],
  ])('%s posts to %s', async (category, code) => {
    expect(await debitedFor(category)).toBe(code);
  });

  it('a category with no account of its own still goes to 6000', async () => {
    expect(await debitedFor('pallet')).toBe('6000');
  });

  it('a missing seeded account falls back rather than dropping the cost', async () => {
    expect(await debitedFor('freight', CHART.filter((a) => a.code !== '6010'))).toBe('6000');
  });
});

describe('the report is reachable and scoped', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../modules/analytics/reporting.routes.js'), 'utf8');
  it('is registered behind the reports permission', () => {
    expect(routes).toContain("router.get('/printable/freight-recovery', authorize('reports', 'view'), controller.printableFreightRecovery)");
  });
  it('excludes cancelled orders', () => {
    expect(CTRL).toContain(".whereNotIn('o.status', ['Cancelled'])");
  });
  it('returns an empty shape rather than throwing when there are no orders', () => {
    expect(CTRL).toContain('emptyFreightTotals()');
  });
});
