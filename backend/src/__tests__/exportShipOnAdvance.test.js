/**
 * Ship on the advance (owner decision 2026-10-07). An export order ships once
 * the advance is confirmed and the PRE-shipment documents are approved; the
 * balance, the BL Final and the Certificate of Origin are collected after
 * sailing and gate Close (CoO moved post-shipment, owner decision D1).
 *
 * Every case RUNS the real controller / workflow against the in-memory
 * database (helpers/memoryDb.js); nothing greps the source.
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

const mockAccounting = {
  autoPost: jest.fn().mockResolvedValue(null),
  createJournal: jest.fn().mockResolvedValue({ id: 1 }),
  postJournal: jest.fn().mockResolvedValue(null),
};
jest.mock('../services/accountingService', () => mockAccounting);
jest.mock('../modules/accounting/accounting.service', () => mockAccounting);

const mockAutomation = {
  onShipmentDeparted: jest.fn().mockResolvedValue(null),
  onAdvanceConfirmed: jest.fn().mockResolvedValue(null),
  onBalanceConfirmed: jest.fn().mockResolvedValue(null),
};
jest.mock('../services/automationService', () => mockAutomation);
jest.mock('../modules/admin/automation.service', () => mockAutomation);

const mockEmail = { sendBalanceReminder: jest.fn().mockResolvedValue(null) };
jest.mock('../services/emailService', () => mockEmail);
jest.mock('../modules/communications/email.service', () => mockEmail);

// The real checkMissingDocsWithConn left-joins document_store, which the
// in-memory db doesn't do; this keeps its rule (required and not fulfilled).
const mockDocs = {
  checkMissingDocsWithConn: jest.fn(async (conn, linkedType, linkedId) => {
    const rows = await conn('document_checklists').where({ linked_type: linkedType, linked_id: linkedId, is_required: true });
    return rows.filter((r) => !r.is_fulfilled);
  }),
};
jest.mock('../services/documentService', () => mockDocs);
jest.mock('../modules/documents/documents.service', () => mockDocs);

const mockNotify = { createForRole: jest.fn().mockResolvedValue(null) };
jest.mock('../services/notificationService', () => mockNotify);

const { state, reset, db } = require('./helpers/memoryDb');
const controller = require('../modules/exportOrders/exportOrders.controller');
const workflow = require('../modules/exportOrders/exportOrders.workflow');

function res() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const req = (over = {}) => ({ params: { id: '1' }, body: {}, user: { id: 1, role_id: 1 }, ...over });

function order(over = {}) {
  return {
    id: 1, order_no: 'EX-001', customer_id: 10, product_id: 20, product_name: 'Super Kernel',
    qty_mt: 100, price_per_mt: 500, contract_value: 50000, currency: 'USD', incoterm: 'FOB',
    advance_pct: 20, advance_expected: 10000, advance_received: 10000, financial_status: 'Confirmed',
    balance_expected: 40000, balance_received: 0, revenue_posted: false,
    booked_fx_rate: 280, contract_value_pkr_locked: 14000000,
    freight_display: 'in_price', bank_account_id: 3, status: 'Ready to Ship', current_step: 8,
    ...over,
  };
}

const CHECKLIST = ['phyto', 'bl_draft', 'bl_final', 'commercial_invoice', 'packing_list', 'coo', 'fumigation'];
// The checklist as an order has it once its pre-shipment documents are done:
// everything approved except the BL Final (the carrier issues it after sailing)
// and the Certificate of Origin (the chamber endorses it against the shipped BL).
function checklist({ unfulfilled = ['bl_final', 'coo'] } = {}) {
  return CHECKLIST.map((doc_type, i) => ({
    id: i + 1, linked_type: 'export_order', linked_id: 1, doc_type,
    is_required: true, is_fulfilled: !unfulfilled.includes(doc_type),
  }));
}
const DOC_ROWS = [
  ['phyto', 'Approved'], ['bl_draft', 'Approved'], ['commercial_invoice', 'Approved'],
  ['packing_list', 'Approved'], ['fumigation', 'Final'],
];
const docs = (list = DOC_ROWS) => list.map(([doc_type, status], i) => ({ id: i + 1, order_id: 1, doc_type, status }));

function seed({ o = {}, unfulfilled, documents = [] } = {}) {
  reset({
    export_orders: [order(o)],
    export_order_items: [],
    export_order_status_history: [],
    export_order_documents: documents,
    document_checklists: checklist({ unfulfilled }),
    inventory_reservations: [],
    export_packing_weights: [],
    chart_of_accounts: [],
  });
}

async function setStatus(status) {
  const r = res();
  await controller.updateStatus(req({ body: { status } }), r);
  return r;
}

beforeEach(() => { jest.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('pre-shipment vs post-shipment documents', () => {
  it('BL Final and CoO are the post-shipment documents; the other five are pre-shipment', () => {
    expect(workflow.POST_SHIPMENT_DOCS).toEqual(['blFinal', 'coo']);
    expect(workflow.PRE_SHIPMENT_DOCS).toEqual(['phyto', 'blDraft', 'invoice', 'packingList', 'fumigation']);
    expect([...workflow.PRE_SHIPMENT_DOCS, ...workflow.POST_SHIPMENT_DOCS].sort())
      .toEqual([...workflow.REQUIRED_DOCS].sort());
  });

  it('the five pre-shipment documents approved, without the BL Final or CoO, are enough to ship', () => {
    expect(workflow.preShipmentDocsApproved(docs())).toBe(true);
    expect(workflow.requiredDocsApproved(docs())).toBe(false);
  });

  it('a missing pre-shipment document still is not', () => {
    expect(workflow.preShipmentDocsApproved(docs(DOC_ROWS.slice(1)))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('shipping on the advance', () => {
  it('ships with the advance confirmed, nothing of the balance received and no BL Final yet', async () => {
    seed();
    const r = await setStatus('Shipped');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Shipped');
    // Revenue + COGS recognition at Shipped is unchanged.
    expect(mockInventory.lockOrderCOGS).toHaveBeenCalledWith(expect.anything(), 1, 280);
    expect(mockAccounting.autoPost).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ triggerEvent: 'export_revenue', amount: 14000000 }));
    expect(state.tables.export_orders[0].revenue_posted).toBe(true);
    // The balance is now due, after sailing.
    const flags = workflow.getAllowedActions(state.tables.export_orders[0]);
    expect(flags.balanceDue).toBe(true);
    expect(flags.canRequestBalance).toBe(true);
  });

  it('a 0% advance order ships without any advance', async () => {
    seed({ o: { advance_pct: 0, advance_expected: 0, advance_received: 0, financial_status: 'Not Required', balance_expected: 50000 } });
    const r = await setStatus('Shipped');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Shipped');
  });

  it.each(['Pending Confirmation', 'Partially Confirmed', 'Advance Not Entered', 'Rejected'])(
    'is refused while the advance is %s', async (financial_status) => {
      seed({ o: { financial_status, advance_received: financial_status === 'Partially Confirmed' ? 4000 : 0 } });
      const r = await setStatus('Shipped');
      expect(r.statusCode).toBe(400);
      expect(r.body.message).toMatch(/Cannot ship: the advance payment is not yet confirmed/);
      expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
      expect(mockAccounting.autoPost).not.toHaveBeenCalled();
    }
  );

  it('is refused while a pre-shipment document is unapproved, and names it', async () => {
    seed({ unfulfilled: ['phyto', 'bl_final', 'coo'] });
    const r = await setStatus('Shipped');
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/pre-shipment export documents.*Phytosanitary Certificate/);
    expect(r.body.message).not.toMatch(/BL Final/);
    expect(r.body.message).not.toMatch(/Certificate of Origin/);
  });

  it('ships without the Certificate of Origin (it is issued after sailing)', async () => {
    seed({ unfulfilled: ['coo'] });
    const r = await setStatus('Shipped');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Shipped');
  });

  it('ATD on a Ready to Ship order ships it with the balance unpaid', async () => {
    seed({ o: { gate_pass_no: 'GP-1' } });
    state.tables.shipment_containers = [];
    const r = res();
    await controller.updateShipment(req({ body: { atd: '2026-10-07', vessel_name: 'MV Test' } }), r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Shipped');
    expect(state.tables.export_orders[0].balance_received).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Ready to Ship no longer waits for the balance', () => {
  it('approving the pre-shipment documents takes a Docs In Preparation order to Ready to Ship', async () => {
    seed({ o: { status: 'Docs In Preparation', current_step: 6 }, documents: docs() });
    const out = await workflow.maybePromoteAfterDocuments(db, { order: { ...state.tables.export_orders[0] }, userId: 1 });
    expect(out.changed).toBe(true);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
    expect(state.tables.export_order_status_history.map((h) => h.to_status)).toEqual(['Ready to Ship']);
  });

  it('with the advance unconfirmed it waits, then moves the moment the advance is confirmed', async () => {
    seed({ o: { status: 'Docs In Preparation', financial_status: 'Pending Confirmation', advance_received: 0 }, documents: docs() });
    const waiting = await workflow.maybePromoteAfterDocuments(db, { order: { ...state.tables.export_orders[0] }, userId: 1 });
    expect(waiting.changed).toBe(false);
    expect(waiting.blockers[0]).toMatch(/advance payment is not yet confirmed/);
    expect(state.tables.export_orders[0].status).toBe('Docs In Preparation');

    // confirmAdvance stamps the order, then asks the workflow to promote.
    const stale = { ...state.tables.export_orders[0] };
    Object.assign(state.tables.export_orders[0], { advance_received: 10000, financial_status: 'Confirmed' });
    const out = await workflow.maybePromoteAfterAdvance(db, { order: stale, newAdvanceReceived: 10000, userId: 1 });
    expect(out.changed).toBe(true);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
  });

  it('a manual move to Ready to Ship is held to the same gate', async () => {
    seed({ o: { status: 'Docs In Preparation' }, unfulfilled: ['fumigation', 'coo', 'bl_final'] });
    const r = await setStatus('Ready to Ship');
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Cannot mark Ready to Ship: .*Fumigation Certificate/);
    expect(r.body.message).not.toMatch(/Certificate of Origin/);
  });

  it('a manual move to Ready to Ship is allowed without the Certificate of Origin', async () => {
    seed({ o: { status: 'Docs In Preparation' }, unfulfilled: ['coo', 'bl_final'] });
    const r = await setStatus('Ready to Ship');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
  });

  it('a Certificate of Origin row that is not approved does not hold up the auto-promotion', async () => {
    seed({ o: { status: 'Docs In Preparation', current_step: 6 }, documents: docs([...DOC_ROWS, ['coo', 'Draft']]) });
    const out = await workflow.maybePromoteAfterDocuments(db, { order: { ...state.tables.export_orders[0] }, userId: 1 });
    expect(out.changed).toBe(true);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
  });

  it('Docs In Preparation can no longer go to Awaiting Balance', async () => {
    seed({ o: { status: 'Docs In Preparation' } });
    const r = await setStatus('Awaiting Balance');
    expect(r.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('legacy Awaiting Balance orders', () => {
  it('move on to Ready to Ship with the balance still unpaid', async () => {
    seed({ o: { status: 'Awaiting Balance', current_step: 7 } });
    const r = await setStatus('Ready to Ship');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
    expect(state.tables.export_orders[0].current_step).toBe(8);
  });

  it('and then ship', async () => {
    seed({ o: { status: 'Awaiting Balance', current_step: 7 } });
    expect((await setStatus('Ready to Ship')).statusCode).toBe(200);
    expect((await setStatus('Shipped')).statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Shipped');
  });

  it('a balance receipt still nudges one on to Ready to Ship', async () => {
    seed({ o: { status: 'Awaiting Balance' }, documents: docs() });
    const out = await workflow.maybePromoteAfterBalance(db, {
      order: { ...state.tables.export_orders[0] }, newBalanceReceived: 40000, userId: 1,
    });
    expect(out.balanceFull).toBe(true);
    expect(out.changed).toBe(true);
    expect(state.tables.export_orders[0].status).toBe('Ready to Ship');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Close collects the balance and the post-shipment documents', () => {
  it('is refused while the balance is outstanding', async () => {
    seed({ o: { status: 'Arrived', current_step: 10 }, unfulfilled: [] });
    const r = await setStatus('Closed');
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Cannot close: the balance is still outstanding \(0\.00 of 40000\.00 received\)/);
    expect(state.tables.export_orders[0].status).toBe('Arrived');
  });

  it('is refused with the balance in but the BL Final not yet approved', async () => {
    seed({ o: { status: 'Arrived', balance_received: 40000 }, unfulfilled: ['bl_final'] });
    const r = await setStatus('Closed');
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Cannot close: .*BL Final/);
  });

  it('is refused with the balance in but the Certificate of Origin not yet approved', async () => {
    seed({ o: { status: 'Arrived', balance_received: 40000 }, unfulfilled: ['coo'] });
    const r = await setStatus('Closed');
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Cannot close: .*Certificate of Origin/);
    expect(state.tables.export_orders[0].status).toBe('Arrived');
  });

  it('closes once the balance is received and the BL Final and CoO approved', async () => {
    seed({ o: { status: 'Arrived', balance_received: 40000 }, unfulfilled: [] });
    const r = await setStatus('Closed');
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_orders[0].status).toBe('Closed');
  });

  it('the Close flag follows the balance', () => {
    expect(workflow.getAllowedActions(order({ status: 'Arrived' })).canCloseOrder).toBe(false);
    expect(workflow.getAllowedActions(order({ status: 'Arrived', balance_received: 40000 })).canCloseOrder).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the balance after shipment', () => {
  it('a reminder can be sent for a Shipped order', async () => {
    seed({ o: { status: 'Shipped' } });
    const r = res();
    await controller.requestBalance(req({ body: { notes: 'Chase balance' } }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.requested_amount).toBe(40000);
    expect(mockEmail.sendBalanceReminder).toHaveBeenCalled();
  });

  it('deriveBalanceStatus tracks it after sailing', () => {
    expect(workflow.deriveBalanceStatus(order({ status: 'In Milling' }))).toBe('Due After Shipment');
    expect(workflow.deriveBalanceStatus(order({ status: 'Shipped' }))).toBe('Balance Due');
    expect(workflow.deriveBalanceStatus(order({ status: 'Arrived', balance_received: 15000 }))).toBe('Partially Received');
    expect(workflow.deriveBalanceStatus(order({ status: 'Arrived', balance_received: 40000 }))).toBe('Received');
    expect(workflow.deriveBalanceStatus(order({ balance_expected: 0 }))).toBe('Not Required');
  });
});
