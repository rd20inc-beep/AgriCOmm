/**
 * Export-order workflow fixes (EXP-F4..F13). Every case here RUNS the real
 * handler or helper against an in-memory database; nothing greps the source.
 *
 *  - action flags are money-based (advance/balance recordable whenever owed)
 *  - Close is only offered where STATUS_TRANSITIONS allows it
 *  - an Overview qty/price edit keeps export_order_items in step (or refuses)
 *  - customer/currency are locked once money is in
 *  - stock can't be allocated past the order quantity or after dispatch
 *  - drafts save with blanks and are fully validated on Submit
 *  - documents promote the order only when the REQUIRED set is approved
 */

jest.mock('../config/database', () => require('./helpers/memoryDb').db);

const mockInventory = {
  reserveStock: jest.fn().mockResolvedValue(null),
  releaseReservation: jest.fn().mockResolvedValue(null),
  dispatchForShipment: jest.fn().mockResolvedValue(null),
  lockOrderCOGS: jest.fn().mockResolvedValue(null),
};
jest.mock('../services/inventoryService', () => mockInventory);
jest.mock('../modules/inventory/inventory.service', () => mockInventory);
const mockNotify = { createForRole: jest.fn().mockResolvedValue(null) };
jest.mock('../services/notificationService', () => mockNotify);
// The Ready to Ship gate reads the document checklist; the real query
// left-joins document_store, which the in-memory db doesn't do.
const mockDocs = {
  checkMissingDocsWithConn: jest.fn(async (conn, linkedType, linkedId) => {
    const rows = await conn('document_checklists').where({ linked_type: linkedType, linked_id: linkedId, is_required: true });
    return rows.filter((r) => !r.is_fulfilled);
  }),
  createChecklist: jest.fn(async (conn, { linkedType, linkedId, items }) => conn('document_checklists').insert(
    items.map((it) => ({ linked_type: linkedType, linked_id: linkedId, doc_type: it.doc_type, is_required: it.is_required !== false, is_fulfilled: false }))
  ).returning('*')),
};
jest.mock('../services/documentService', () => mockDocs);
jest.mock('../modules/documents/documents.service', () => mockDocs);

const { state, reset } = require('./helpers/memoryDb');
const controller = require('../modules/exportOrders/exportOrders.controller');
const workflow = require('../modules/exportOrders/exportOrders.workflow');
const schemas = require('../middleware/schemas');

function res() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const req = (over = {}) => ({ params: {}, body: {}, user: { id: 1, role_id: 1 }, ...over });

function order(over = {}) {
  return {
    id: 1, order_no: 'EX-001', customer_id: 10, product_id: 20, product_name: 'Super Kernel',
    qty_mt: 100, price_per_mt: 500, contract_value: 50000, currency: 'USD', incoterm: 'FOB',
    advance_pct: 20, advance_expected: 10000, advance_received: 0,
    balance_expected: 40000, balance_received: 0, revenue_posted: false,
    booked_fx_rate: 280, contract_value_pkr_locked: 14000000,
    freight_display: 'in_price', packing_type: 'retail', palletized: false,
    bank_account_id: 3, status: 'Awaiting Advance', current_step: 2,
    ...over,
  };
}
const item = (over = {}) => ({
  id: 1, order_id: 1, line_no: 1, product_id: 20, product_name: 'Super Kernel',
  qty_mt: 100, price_per_mt: 500, line_total: 50000, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('action flags follow the money, not the stage', () => {
  const flags = (o) => workflow.getAllowedActions(order(o));

  it('an In Milling order with its advance still owed can record the advance', () => {
    expect(flags({ status: 'In Milling', advance_received: 0 }).canConfirmAdvance).toBe(true);
    expect(flags({ status: 'Docs In Preparation', advance_received: 4000 }).canConfirmAdvance).toBe(true);
  });

  it('a fully received advance, a departed order, or a terminal one cannot', () => {
    expect(flags({ status: 'In Milling', advance_received: 10000 }).canConfirmAdvance).toBe(false);
    expect(flags({ status: 'Shipped' }).canConfirmAdvance).toBe(false);
    expect(flags({ status: 'Arrived' }).canConfirmAdvance).toBe(false);
    expect(flags({ status: 'Cancelled' }).canConfirmAdvance).toBe(false);
  });

  it('a balance re-opened after shipment (freight debit note) can be recorded', () => {
    const f = flags({ status: 'Shipped', advance_received: 10000, balance_expected: 41500, balance_received: 40000 });
    expect(f.canRequestBalance).toBe(true);
    expect(flags({ status: 'In Milling' }).canRequestBalance).toBe(true);
  });

  it('a settled balance or a Closed/Cancelled order cannot', () => {
    expect(flags({ status: 'Arrived', balance_received: 40000 }).canRequestBalance).toBe(false);
    expect(flags({ status: 'Closed' }).canRequestBalance).toBe(false);
    expect(flags({ status: 'Cancelled' }).canRequestBalance).toBe(false);
  });

  it('Close matches STATUS_TRANSITIONS: Arrived only, never Shipped', () => {
    for (const status of Object.keys(workflow.STATUS_TRANSITIONS)) {
      expect(flags({ status, balance_received: 40000 }).canCloseOrder)
        .toBe(workflow.canTransition(status, 'Closed'));
    }
    expect(flags({ status: 'Shipped', balance_received: 40000 }).canCloseOrder).toBe(false);
    expect(flags({ status: 'Arrived', balance_received: 40000 }).canCloseOrder).toBe(true);
  });

  it('an Arrived order with the balance still owed is not offered Close but shows it due', () => {
    const f = flags({ status: 'Arrived', advance_received: 10000, balance_received: 0 });
    expect(f.canCloseOrder).toBe(false);
    expect(f.balanceDue).toBe(true);
    expect(f.balanceStatus).toBe('Balance Due');
    expect(f.canRequestBalance).toBe(true);
    // Before sailing the balance is not yet due.
    const pre = flags({ status: 'Ready to Ship', advance_received: 10000, balance_received: 0 });
    expect(pre.balanceDue).toBe(false);
    expect(pre.balanceStatus).toBe('Due After Shipment');
  });

  it('shipment details open from In Milling; departure dates only from Ready to Ship', () => {
    expect(flags({ status: 'Advance Received' }).canUpdateShipment).toBe(false);
    expect(flags({ status: 'In Milling' }).canUpdateShipment).toBe(true);
    expect(flags({ status: 'Docs In Preparation' }).canUpdateShipment).toBe(true);
    expect(flags({ status: 'In Milling' }).canRecordDeparture).toBe(false);
    expect(flags({ status: 'Ready to Ship' }).canRecordDeparture).toBe(true);
  });

  it('there is no hold flag; Draft offers Submit', () => {
    expect(flags({})).not.toHaveProperty('canPutOnHold');
    expect(flags({ status: 'Draft' }).canSubmitDraft).toBe(true);
    expect(flags({ status: 'Awaiting Advance' }).canSubmitDraft).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('editing qty/price on the Overview keeps the P.I. lines in step', () => {
  async function put(body, seed) {
    reset({ export_orders: [order(seed.order)], export_order_items: seed.items, receivables: seed.receivables || [] });
    const r = res();
    await controller.update(req({ params: { id: '1' }, body }), r);
    return r;
  }

  it('a single-line order rescales its one line (qty, price and amount)', async () => {
    const r = await put({ qty_mt: 120, price_per_mt: 510 }, { items: [item()] });
    expect(r.statusCode).toBe(200);
    const line = state.tables.export_order_items[0];
    expect(line.qty_mt).toBe(120);
    expect(line.price_per_mt).toBe(510);
    expect(line.line_total).toBe(61200);
    expect(state.tables.export_orders[0].contract_value).toBe(61200);
  });

  it('a multi-line order is refused rather than guessed at', async () => {
    const r = await put({ qty_mt: 120 }, {
      items: [item(), item({ id: 2, line_no: 2, qty_mt: 50, price_per_mt: 450, line_total: 22500 })],
    });
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Edit the line items instead/);
    expect(state.tables.export_orders[0].qty_mt).toBe(100);
    expect(state.tables.export_order_items[0].qty_mt).toBe(100);
  });

  it('re-sending unchanged qty/price on a multi-line order is not an edit', async () => {
    const r = await put({ qty_mt: 100, price_per_mt: 500, incoterm: 'CFR' }, {
      items: [item(), item({ id: 2, line_no: 2 })],
    });
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].incoterm).toBe('CFR');
  });

  it('editing the same lines (by id) updates them in place, so reservations keep their line', async () => {
    const r = await put({ items: [
      { id: 1, product_id: 20, qty_mt: 60, price_per_mt: 500 },
      { id: 2, product_id: 21, qty_mt: 40, price_per_mt: 450 },
    ] }, { items: [item(), item({ id: 2, line_no: 2, product_id: 21, qty_mt: 50, price_per_mt: 450, line_total: 22500 })] });
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_order_items.map((l) => [l.id, l.line_no, l.qty_mt, l.line_total]))
      .toEqual([[1, 1, 60, 30000], [2, 2, 40, 18000]]);
    expect(state.tables.export_orders[0]).toMatchObject({ qty_mt: 100, contract_value: 48000 });
  });

  it('items[] still replaces the lines outright', async () => {
    const r = await put({ items: [{ product_id: 20, qty_mt: 10, price_per_mt: 600 }] }, { items: [item()] });
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_order_items).toHaveLength(1);
    expect(state.tables.export_order_items[0].line_total).toBe(6000);
  });
});

describe('customer and currency are part of the locked contract', () => {
  async function put(body, over) {
    reset({
      export_orders: [order(over)],
      export_order_items: [item()],
      receivables: [
        { id: 1, order_id: 1, type: 'Advance', customer_id: 10, currency: 'USD', expected_amount: 10000 },
        { id: 2, order_id: 1, type: 'Balance', customer_id: 10, currency: 'USD', expected_amount: 40000 },
      ],
    });
    const r = res();
    await controller.update(req({ params: { id: '1' }, body }), r);
    return r;
  }

  it('the currency cannot change once an advance is in', async () => {
    const r = await put({ currency: 'EUR' }, { advance_received: 10000 });
    expect(r.statusCode).toBe(400);
    expect(state.tables.export_orders[0].currency).toBe('USD');
  });

  it('the customer cannot change once revenue is posted', async () => {
    const r = await put({ customer_id: 99 }, { revenue_posted: true });
    expect(r.statusCode).toBe(400);
    expect(state.tables.export_orders[0].customer_id).toBe(10);
  });

  it('before any money both may change, and the receivables follow', async () => {
    const r = await put({ currency: 'EUR', customer_id: 99 }, {});
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0]).toMatchObject({ currency: 'EUR', customer_id: 99 });
    for (const rc of state.tables.receivables) expect(rc).toMatchObject({ currency: 'EUR', customer_id: 99 });
  });

  it('the bank account and units per bag can be changed on edit', async () => {
    const r = await put({ bank_account_id: 7, units_per_bag: 10 }, {});
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0]).toMatchObject({ bank_account_id: 7, units_per_bag: 10 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('allocating stock', () => {
  const lot = { id: 5, lot_no: 'LOT-5', export_ready: true, available_qty: 200000, landed_cost_per_kg: 150, ownership: 'own' };

  async function allocate(qtyMt, orderOver = {}, reservations = []) {
    reset({
      export_orders: [order({ status: 'In Milling', ...orderOver })],
      inventory_lots: [lot],
      inventory_reservations: reservations,
      export_order_status_history: [],
    });
    const r = res();
    await controller.allocateStock(req({ params: { id: '1' }, body: { lot_id: 5, qty_mt: qtyMt } }), r);
    return r;
  }

  it.each(['Shipped', 'Arrived', 'Closed', 'Cancelled'])('is refused on a %s order', async (status) => {
    const r = await allocate(10, { status });
    expect(r.statusCode).toBe(400);
    expect(mockInventory.reserveStock).not.toHaveBeenCalled();
  });

  it('cannot hold more than the order is for', async () => {
    const r = await allocate(30, {}, [
      { id: 1, order_id: 1, lot_id: 9, reserved_qty: 80000, status: 'Active' },
      { id: 2, order_id: 1, lot_id: 9, reserved_qty: 50000, status: 'Released' }, // not counted
    ]);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/at most 20\.000 MT more/);
    expect(mockInventory.reserveStock).not.toHaveBeenCalled();
  });

  it('up to the order quantity (plus 1 kg of rounding) is allowed', async () => {
    const r = await allocate(20.0005, {}, [{ id: 1, order_id: 1, lot_id: 9, reserved_qty: 80000, status: 'Active' }]);
    expect(r.statusCode).toBe(200);
    expect(mockInventory.reserveStock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ qtyKg: 20000.5 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('documents promote the order only when the REQUIRED set is approved', () => {
  const required = [
    ['phyto', 'Approved'], ['bl_draft', 'Approved'], ['BL Final', 'Final'], ['commercial_invoice', 'Approved'],
    ['packingList', 'Approved'], ['Certificate of Origin', 'Approved'], ['fumigation', 'Final'],
  ];
  const docs = (list) => list.map(([doc_type, status], i) => ({ id: i + 1, order_id: 1, doc_type, status }));

  async function promote(list) {
    reset({
      export_orders: [order({ status: 'Docs In Preparation', advance_received: 10000 })],
      export_order_documents: docs(list),
      export_order_items: [item()],
      export_order_status_history: [],
    });
    const o = state.tables.export_orders[0];
    return workflow.maybePromoteAfterDocuments(require('./helpers/memoryDb').db, { order: { ...o }, userId: 1 });
  }

  it('all seven required, under any stored spelling, promote straight to Ready to Ship', async () => {
    const out = await promote(required);
    expect(out.changed).toBe(true);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
  });

  it("seven 'Draft Uploaded' rows do not", async () => {
    const out = await promote(required.map(([t]) => [t, 'Draft Uploaded']));
    expect(out.changed).toBe(false);
    expect(state.tables.export_orders[0].status).toBe('Docs In Preparation');
  });

  it('seven approved documents that are not the required ones do not', async () => {
    const out = await promote([
      ['proforma', 'Approved'], ['sales_contract', 'Approved'], ['weight_cert', 'Approved'],
      ['quality_cert', 'Approved'], ['insurance', 'Approved'], ['phyto', 'Approved'], ['coo', 'Approved'],
    ]);
    expect(out.changed).toBe(false);
  });

  it('six of seven plus an extra approved document do not', async () => {
    const out = await promote([...required.slice(0, 6), ['proforma', 'Approved']]);
    expect(out.changed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('drafts', () => {
  const draftBody = (over = {}) => ({
    customer_id: 10, product_id: 20, status: 'Draft', currency: 'USD', advance_pct: 20,
    items: [{ product_id: 20, product_name: 'Super Kernel', qty_mt: 0, price_per_mt: 0 }],
    ...over,
  });

  beforeEach(() => {
    reset({ export_orders: [], export_order_items: [], receivables: [], export_order_status_history: [], document_checklists: [] });
    jest.spyOn(controller, '_raiseMaterialsFor').mockResolvedValue(['PR-1']);
  });
  afterEach(() => jest.restoreAllMocks());

  it('the Draft schema accepts blank quantities, prices, Incoterm and bank; the live one does not', () => {
    const body = { ...draftBody(), qty_mt: '', price_per_mt: 0, contract_value: 0, incoterm: '', bank_account_id: null };
    expect(schemas.createExportOrderDraft.validate(body).error).toBeUndefined();
    expect(schemas.createExportOrder.validate({ ...body, status: 'Awaiting Advance' }).error).toBeDefined();
    // The customer is still required on a draft.
    expect(schemas.createExportOrderDraft.validate({ ...body, customer_id: undefined }).error).toBeDefined();
  });

  it('a blank draft saves, without purchase requests or receivables', async () => {
    const r = res();
    await controller.create(req({ body: draftBody() }), r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.order.status).toBe('Draft');
    expect(r.body.data.order.contract_value).toBe(0);
    expect(controller._raiseMaterialsFor).not.toHaveBeenCalled();
    expect(state.tables.receivables).toHaveLength(0);
  });

  it('a live order still raises its purchase requests at create', async () => {
    const r = res();
    await controller.create(req({ body: draftBody({
      status: 'Awaiting Advance', bank_account_id: 3, incoterm: 'FOB',
      items: [{ product_id: 20, qty_mt: 10, price_per_mt: 500 }],
    }) }), r);
    expect(r.statusCode).toBe(201);
    expect(controller._raiseMaterialsFor).toHaveBeenCalledTimes(1);
  });

  it('create() writes the port, freight terms and weight unit the form sends', async () => {
    const r = res();
    await controller.create(req({ body: draftBody({
      destination_port: 'Jebel Ali (Dubai)', doc_weight_unit: 'lb',
      freight_per_mt: 45, insurance_per_mt: 3, freight_basis_date: '2026-10-01',
      freight_valid_until: '2026-10-31', freight_display: 'separate', freight_clause: 'GRI for buyer',
      payment_terms: 'LC 60 Days',
    }) }), r);
    expect(r.statusCode).toBe(201);
    expect(state.tables.export_orders[0]).toMatchObject({
      destination_port: 'Jebel Ali (Dubai)', doc_weight_unit: 'lb',
      freight_per_mt: 45, insurance_per_mt: 3, freight_basis_date: '2026-10-01',
      freight_valid_until: '2026-10-31', freight_display: 'separate', freight_clause: 'GRI for buyer',
      payment_terms: 'LC 60 Days',
    });
  });

  it('Submit refuses an incomplete draft and says what is missing', async () => {
    const c = res();
    await controller.create(req({ body: draftBody() }), c);
    const id = String(c.body.data.order.id);

    const r = res();
    await controller.submitDraft(req({ params: { id } }), r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/a quantity on line 1/);
    expect(r.body.message).toMatch(/a company bank account/);
    expect(state.tables.export_orders[0].status).toBe('Draft');
    expect(controller._raiseMaterialsFor).not.toHaveBeenCalled();
  });

  it('a completed draft submits to Awaiting Advance, gets its receivables and its purchase requests', async () => {
    const c = res();
    await controller.create(req({ body: draftBody() }), c);
    const id = String(c.body.data.order.id);

    const u = res();
    await controller.update(req({ params: { id }, body: {
      incoterm: 'FOB', bank_account_id: 3,
      items: [{ product_id: 20, product_name: 'Super Kernel', qty_mt: 100, price_per_mt: 500 }],
    } }), u);
    expect(u.statusCode).toBe(200);

    const r = res();
    await controller.submitDraft(req({ params: { id } }), r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Awaiting Advance');
    expect(state.tables.receivables.map((x) => [x.type, x.expected_amount])).toEqual([
      ['Advance', 10000], ['Balance', 40000],
    ]);
    expect(controller._raiseMaterialsFor).toHaveBeenCalledTimes(1);
    expect(state.tables.export_order_status_history.map((h) => h.to_status)).toEqual(['Draft', 'Awaiting Advance']);
  });

  it('a 0% advance draft submits straight to Advance Received', async () => {
    const c = res();
    await controller.create(req({ body: draftBody({
      advance_pct: 0, incoterm: 'FOB', bank_account_id: 3,
      items: [{ product_id: 20, qty_mt: 10, price_per_mt: 500 }],
    }) }), c);
    const r = res();
    await controller.submitDraft(req({ params: { id: String(c.body.data.order.id) } }), r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Advance Received');
  });

  it('only a Draft can be submitted', async () => {
    reset({ export_orders: [order()], export_order_items: [item()] });
    const r = res();
    await controller.submitDraft(req({ params: { id: '1' } }), r);
    expect(r.statusCode).toBe(400);
  });

  it('a direct status change out of Draft gets the same validation', async () => {
    const c = res();
    await controller.create(req({ body: draftBody() }), c);
    const r = res();
    await controller.updateStatus(req({ params: { id: String(c.body.data.order.id) }, body: { status: 'Awaiting Advance' } }), r);
    expect(r.statusCode).toBe(400);
    expect(state.tables.export_orders[0].status).toBe('Draft');
  });
});
