/**
 * An export order's price_per_mt is contract value ÷ total qty — on a
 * multi-line order the weighted AVERAGE of its lines (24 MT @ 1290 + 24 MT @
 * 1250 → 1270), nobody's rate. Every place that shows the order-level figure
 * has to say so (label + line range) or show the lines; a single-line order
 * reads exactly as before.
 *
 * Covered: Sales Ledger (printable), Order Profitability report, smart
 * auto-filled invoice + yield-scenario average selling price, the simple
 * proforma/commercial invoice HTML, and the proforma e-mail.
 *
 * Run against a recording fake of knex: each query's terminal call is answered
 * by a per-table function that sees what the query asked for.
 */

jest.mock('../config/database', () => {
  let rows = {};
  const queries = [];
  const builder = (table) => {
    const state = { table, wheres: [], whereIns: [], raws: [], cols: [] };
    const answer = (terminal) => {
      const r = rows[String(table).split(' ')[0]];
      return typeof r === 'function' ? r({ ...state, terminal }) : r;
    };
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          queries.push(state);
          return (res, rej) => Promise.resolve(answer('all') ?? []).then(res, rej);
        }
        if (prop === 'first') return async () => { queries.push(state); return answer('first'); };
        if (prop === 'clone') return () => b;
        if (prop === 'where' || prop === 'andWhere') return (...a) => { state.wheres.push(a); return b; };
        if (prop === 'whereIn') return (col, vals) => { state.whereIns.push([col, vals]); return b; };
        if (prop === 'select') {
          return (...a) => { a.forEach((x) => { if (x && x.raw) state.raws.push(String(x.raw[0])); else if (typeof x === 'string') state.cols.push(x); }); return b; };
        }
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(table);
  db.raw = (...a) => ({ raw: a });
  db.fn = { now: () => 'now()' };
  db.schema = { hasColumn: async () => true, hasTable: async () => true };
  db.transaction = async (fn) => fn(db);
  db.__set = (r) => { rows = r; queries.length = 0; };
  db.__queries = queries;
  return db;
});

const mockSendMail = jest.fn(async () => ({}));
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mockSendMail }) }));

const db = require('../config/database');

// Order 1: two lines at different prices. Order 2: one line.
const MIXED = { id: 1, order_no: 'EX-001', qty_mt: '48', price_per_mt: '1270', contract_value: '60960', currency: 'USD', product_name: 'Super Basmati' };
const SINGLE = { id: 2, order_no: 'EX-002', qty_mt: '24', price_per_mt: '1290', contract_value: '30960', currency: 'USD', product_name: 'Super Basmati' };
const LINES = {
  1: [
    { order_id: 1, line_no: 1, product_name: 'Super Basmati', qty_mt: '24', price_per_mt: '1290', line_total: '30960' },
    { order_id: 1, line_no: 2, product_name: '1121 Sella', qty_mt: '24', price_per_mt: '1250', line_total: '30000' },
  ],
  2: [{ order_id: 2, line_no: 1, product_name: 'Super Basmati', qty_mt: '24', price_per_mt: '1290', line_total: '30960' }],
};
// export_order_items answered for whereIn(order_id, ids) or where({ order_id }).
const itemsFor = (q) => {
  const inIds = q.whereIns.find(([c]) => String(c).endsWith('order_id'));
  if (inIds) return inIds[1].flatMap((id) => LINES[id] || []);
  const w = q.wheres.find((a) => a[0] && typeof a[0] === 'object' && a[0].order_id != null);
  return w ? (LINES[w[0].order_id] || []) : [];
};

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
};

describe('Sales Ledger — export order rate', () => {
  const controller = require('../modules/analytics/reporting.controller');

  test('multi-line order is flagged as an average with its line range; single-line unchanged', async () => {
    db.__set({
      local_sales: [],
      export_orders: [MIXED, SINGLE],
      export_order_items: itemsFor,
    });
    const res = mockRes();
    await controller.printableSalesLedger({ query: {} }, res);
    expect(res.body.success).toBe(true);
    const [mixed, single] = res.body.data.export;

    expect(mixed).toMatchObject({ ratePerMt: 1270, rateMixed: true, rateLabel: 'Avg price per MT', rateMin: 1250, rateMax: 1290, mt: 48 });
    expect(mixed.valueUsd).toBe(48 * 1270);
    expect(single).toMatchObject({ ratePerMt: 1290, rateMixed: false, rateLabel: 'Price per MT', rateMin: 1290, rateMax: 1290, mt: 24 });
    expect(res.body.data.totals.exportMt).toBe(72);
  });

  test('reads export_orders.qty_mt (the table has no qty_kg — selecting it 500ed the whole ledger)', async () => {
    db.__set({ local_sales: [], export_orders: [], export_order_items: [] });
    await controller.printableSalesLedger({ query: {} }, mockRes());
    const eo = db.__queries.find((q) => q.table === 'export_orders as o');
    expect(eo.cols).toContain('o.qty_mt');
    expect(eo.cols).not.toContain('o.qty_kg');
  });
});

describe('Order Profitability — price label', () => {
  const reportingService = require('../modules/analytics/reporting.service');

  test('avg label + range for a multi-line order, plain price for a single-line one', async () => {
    db.__set({
      export_orders: (q) => (q.terminal === 'first' ? { total: '2' } : [MIXED, SINGLE]),
      export_order_costs: [],
      export_order_items: itemsFor,
    });
    const out = await reportingService.getOrderProfitability({});
    const [mixed, single] = out.data;
    expect(mixed).toMatchObject({ pricePerMT: 1270, priceMixed: true, priceLabel: 'Avg price per MT', priceMin: 1250, priceMax: 1290 });
    expect(single).toMatchObject({ pricePerMT: 1290, priceMixed: false, priceLabel: 'Price per MT', priceMin: 1290, priceMax: 1290 });
  });
});

describe('Smart service', () => {
  const smart = require('../modules/analytics/smart.service');

  test('auto-filled invoice carries the lines and labels the header price', async () => {
    db.__set({ export_orders: () => MIXED, customers: undefined, products: undefined, export_order_items: itemsFor });
    const doc = await smart.autoFillDocumentData(1, 'invoice');
    expect(doc).toMatchObject({ pricePerMT: 1270, priceMixed: true, priceLabel: 'Avg price per MT', priceMin: 1250, priceMax: 1290, totalValue: 60960 });
    expect(doc.lines.map((l) => [l.qtyMT, l.pricePerMT, l.amount])).toEqual([[24, 1290, 30960], [24, 1250, 30000]]);
  });

  test('auto-filled invoice of a single-line order is unchanged', async () => {
    db.__set({ export_orders: () => SINGLE, customers: undefined, products: undefined, export_order_items: itemsFor });
    const doc = await smart.autoFillDocumentData(2, 'invoice');
    expect(doc).toMatchObject({ pricePerMT: 1290, priceMixed: false, priceLabel: 'Price per MT' });
    expect(doc.lines).toHaveLength(1);
  });

  test('yield scenario prices output at the QUANTITY-weighted average, not AVG of order averages', async () => {
    let raw = '';
    db.__set({
      milling_batches: undefined,
      export_orders: (q) => { raw = q.raws.join(' '); return { avg_price: '1276.67' }; },
      scenarios: [{ id: 9 }],
    });
    const out = await smart.simulateYieldScenario({ rawQtyMT: 10, moisturePct: 12, brokenPct: 4, productVariety: 'Basmati' });
    expect(raw).toMatch(/SUM\(eo\.qty_mt \* eo\.price_per_mt\) \/ NULLIF\(SUM\(eo\.qty_mt\), 0\)/);
    expect(raw).not.toMatch(/AVG\(eo\.price_per_mt\)/);
    expect(out.expected.estimatedRevenue).toBeCloseTo(out.expected.outputMT * 1276.67, 2);
  });
});

describe('Simple invoice HTML (documents.generatePDF)', () => {
  const documentService = require('../modules/documents/documents.service');
  const html = async (order) => {
    let content = '';
    db.__set({
      document_templates: undefined,
      export_orders: () => order,
      export_order_items: itemsFor,
      documents: (q) => q,
    });
    // Capture the HTML handed to the documents insert / file write.
    const fs = require('fs');
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((_, c) => { content = String(c); });
    const mk = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    try { await documentService.generatePDF(db, { docType: 'proforma_invoice', linkedType: 'export_order', linkedId: order.id, userId: 1 }); } catch (e) { /* insert shape not modelled */ }
    spy.mockRestore(); mk.mockRestore();
    return content;
  };

  test('multi-line order lists each line and labels the average', async () => {
    const out = await html(MIXED);
    expect(out).toContain('Super Basmati — 24 MT @ USD 1290/MT');
    expect(out).toContain('1121 Sella — 24 MT @ USD 1250/MT');
    expect(out).toContain('<strong>Avg price/MT:</strong> USD 1270.00 (1250–1290)');
    expect(out).not.toContain('<strong>Price/MT:</strong>');
  });

  test('single-line order prints Price/MT as before', async () => {
    const out = await html(SINGLE);
    expect(out).toContain('  <p><strong>Price/MT:</strong> USD 1290</p>');
    expect(out).not.toContain('Avg price');
  });
});

describe('Proforma e-mail', () => {
  const emailService = require('../modules/communications/email.service');
  const TEMPLATE = {
    subject_template: 'PI {{piNumber}}',
    body_template: 'Price/MT: {{currency}} {{pricePerMT}} | Total Value: {{currency}} {{totalValue}}',
  };
  const send = async (order) => {
    mockSendMail.mockClear();
    db.__set({
      export_orders: () => ({ ...order, customer_email: 'buyer@example.com', customer_name: 'Buyer' }),
      email_templates: () => TEMPLATE,
      export_order_items: itemsFor,
      email_logs: [{ id: 1 }],
    });
    await emailService.sendProformaInvoice({ orderId: order.id, userId: 1 });
    return mockSendMail.mock.calls[0][0].html;
  };

  test('multi-line order: price goes out as an average with its range', async () => {
    expect(await send(MIXED)).toBe('Price/MT: USD avg 1,270 (1,250–1,290) | Total Value: USD 60960');
  });

  test('single-line order: price as before (and the total is filled in)', async () => {
    expect(await send(SINGLE)).toBe('Price/MT: USD 1290 | Total Value: USD 30960');
  });
});
