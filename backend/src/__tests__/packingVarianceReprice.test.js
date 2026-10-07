/**
 * Packing-variance "update invoice" re-prices every LINE, not just the header.
 *
 * It set qty to the packed weight and value to qty × export_orders.price_per_mt
 * — the AVERAGE of the lines on a multi-line order — and never touched the
 * lines, so the documents (which print lines) kept the old quantities and the
 * lines no longer added up to the order.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
jest.mock('../services/inventoryService', () => ({ postMovement: jest.fn(async () => ({})) }));
jest.mock('../services/accountingService', () => ({}));
jest.mock('../services/documentService', () => ({}));
jest.mock('../services/automationService', () => ({}));
jest.mock('../services/emailService', () => ({}));
jest.mock('../services/exportOrderEventBus', () => ({ publishExportOrderUpdate: jest.fn() }));
jest.mock('../services/exportOrderWorkflowService', () => {
  const money = jest.requireActual('../shared/utils/money');
  return { MONEY_EPSILON: money.MONEY_EPSILON ?? 0.005, settledAmount: money.settledAmount, getStepForStatus: () => null, getAllowedActions: () => [] };
});
jest.mock('../services/notificationService', () => ({ createForRole: jest.fn(async () => null) }));

const db = require('../config/database');
const controller = require('../modules/exportOrders/exportOrders.controller');
const { rescaleLinesToQty } = controller;

const resStub = () => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

function seed({ lines, packedKg }) {
  const qty = lines.reduce((s, l) => s + l.qty_mt, 0);
  const value = lines.reduce((s, l) => s + l.qty_mt * l.price_per_mt, 0);
  for (const [k, rows] of Object.entries({
    export_orders: [{
      id: 4, order_no: 'EX-004', status: 'Docs In Preparation', qty_mt: qty, contract_value: value,
      price_per_mt: value / qty, advance_pct: 0, advance_received: 0, balance_received: 0,
      booked_fx_rate: 280, contract_value_pkr_locked: value * 280, revenue_posted: false,
    }],
    export_order_items: lines.map((l, i) => ({ id: 40 + i, order_id: 4, line_no: i + 1, ...l, line_total: l.qty_mt * l.price_per_mt })),
    export_packing_weights: [{
      order_id: 4, approval_status: 'pending', packed_net_rice_kg: packedKg, variance_kg: packedKg - qty * 1000,
      variance_status: 'over', variance_pct: 1,
    }],
    receivables: [
      { id: 1, order_id: 4, type: 'Advance', expected_amount: 0, outstanding: 0 },
      { id: 2, order_id: 4, type: 'Balance', expected_amount: value, outstanding: value },
    ],
    inventory_reservations: [],
  })) db.tables[k] = rows.map((r) => ({ ...r }));
}

describe('rescaleLinesToQty', () => {
  it('scales each line by the same factor and keeps its own price', () => {
    const { lines, contractValue } = rescaleLinesToQty([
      { id: 1, qty_mt: 24, price_per_mt: 1290, bag_size_kg: 2, bag_count: 12000 },
      { id: 2, qty_mt: 24, price_per_mt: 1250, bag_size_kg: 5, bag_count: null },
    ], 48.5, 1270);
    expect(lines.map((l) => l.qty_mt)).toEqual([24.25, 24.25]);
    expect(lines.map((l) => l.price_per_mt)).toEqual([1290, 1250]);
    expect(lines.map((l) => l.line_total)).toEqual([31282.5, 30312.5]);
    expect(lines[0].bag_count).toBe(12125); // follows the line's own 2 kg bag
    expect(lines[1].bag_count).toBeNull(); // never stored — stays derived
    expect(contractValue).toBe(61595);
  });

  it('the last line absorbs rounding so lines sum to the packed qty exactly', () => {
    const { lines } = rescaleLinesToQty([
      { id: 1, qty_mt: 10, price_per_mt: 1 }, { id: 2, qty_mt: 10, price_per_mt: 1 }, { id: 3, qty_mt: 10, price_per_mt: 1 },
    ], 30.001, 1);
    const sum = Math.round(lines.reduce((s, l) => s + l.qty_mt, 0) * 1000) / 1000;
    expect(sum).toBe(30.001);
  });

  it('no lines: header price × qty, as before', () => {
    expect(rescaleLinesToQty([], 25.2, 1060)).toEqual({ lines: [], contractValue: 26712 });
  });
});

describe('resolvePackingWeight update_invoice', () => {
  it('multi-line order: lines re-priced at their own rates, header = sum of lines', async () => {
    seed({
      lines: [{ qty_mt: 24, price_per_mt: 1290, bag_size_kg: 2 }, { qty_mt: 24, price_per_mt: 1250, bag_size_kg: 5 }],
      packedKg: 48500,
    });
    const res = resStub();
    await controller.resolvePackingWeight({ params: { id: '4' }, body: { resolution: 'update_invoice' }, user: { id: 1 } }, res);
    expect(res.code).toBe(200);
    const items = db.tables.export_order_items;
    expect(items.map((l) => l.qty_mt)).toEqual([24.25, 24.25]);
    expect(items.map((l) => l.line_total)).toEqual([31282.5, 30312.5]);
    const order = db.tables.export_orders[0];
    expect(order.qty_mt).toBe(48.5);
    expect(order.contract_value).toBe(61595);
    expect(order.contract_value).toBe(items.reduce((s, l) => s + l.line_total, 0));
    expect(order.price_per_mt).toBeCloseTo(1270, 6);
    expect(db.tables.receivables.find((r) => r.type === 'Balance').expected_amount).toBe(61595);
  });

  it('single-line order: same result as before', async () => {
    seed({ lines: [{ qty_mt: 25, price_per_mt: 1060, bag_size_kg: 25 }], packedKg: 25200 });
    const res = resStub();
    await controller.resolvePackingWeight({ params: { id: '4' }, body: { resolution: 'update_invoice' }, user: { id: 1 } }, res);
    expect(res.code).toBe(200);
    expect(db.tables.export_order_items[0].qty_mt).toBe(25.2);
    expect(db.tables.export_orders[0].contract_value).toBe(26712); // 25.2 × 1060
  });
});
