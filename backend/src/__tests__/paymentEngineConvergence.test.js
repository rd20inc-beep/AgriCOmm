/**
 * Phase 1 — every money-in / money-out writer goes through ONE engine
 * (finance/paymentEngine.recordMoneyMovement). For each writer this checks the
 * journal it posts (accounts, amounts, entity, party), that the cash / bank
 * side has its bank_transactions row, that the payment carries its source
 * document, that the document is settled — and that a ledger failure fails the
 * call instead of being swallowed.
 *
 * Runs against the in-memory knex (helpers/fakeKnex) so the real controllers
 * and services execute. Each test fails on the code before the convergence:
 *   R5  export receipt confirm: Dr 1020 via autoPost outside the trx, errors
 *       swallowed, no bank_transactions row;
 *   R6  Purchases-tab lot payment: missed the lot's payable (source_table NULL),
 *       no payments row, payable left open;
 *   R7  salary expense paid from Money Out: Dr 2010 instead of 2040;
 *   R8  Money In receipt on an export receivable: settled the receivable only,
 *       never the order;
 *   A4  service-milling receipts: no journal, no account choice for a transfer;
 *       opening AR / service receivables through Money In credited 1110.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
let mockDocSeq = 0;
jest.mock('../utils/docNumber', () => ({
  nextDocNo: jest.fn(async (_trx, { prefix }) => `${prefix}${++mockDocSeq}`),
}));
jest.mock('../modules/accounting/accounting.service', () => {
  const journals = [];
  return {
    journals,
    createJournal: jest.fn(async (_trx, j) => { journals.push(j); return { id: 500 + journals.length }; }),
    postJournal: jest.fn(async () => ({})),
    autoPost: jest.fn(async () => null),
    reverseJournal: jest.fn(async () => ({})),
  };
});
jest.mock('../modules/inventory/inventory.service', () => ({ reserveStock: jest.fn(async () => null), MOVEMENT_TYPES: {} }));
jest.mock('../services/inventoryService', () => ({ reserveStock: jest.fn(async () => null), MOVEMENT_TYPES: {} }));
jest.mock('../modules/admin/automation.service', () => ({
  onAdvanceConfirmed: jest.fn(async () => null), onBalanceConfirmed: jest.fn(async () => null),
}));
jest.mock('../services/automationService', () => ({
  onAdvanceConfirmed: jest.fn(async () => null), onBalanceConfirmed: jest.fn(async () => null),
}));
jest.mock('../services/exportOrderEventBus', () => ({ publishExportOrderUpdate: jest.fn() }));

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const financeController = require('../modules/finance/finance.controller');
const exportController = require('../modules/exportOrders/exportOrders.controller');
const serviceController = require('../modules/serviceMilling/serviceMilling.controller');
const expensesService = require('../modules/expenses/expenses.service');

// ids: 1000→10, 1110→11, 1120→12, 1310→13, 2010→14, 2040→15, 2060→16, 4060→17, 1020→18
const COA = ['1000', '1110', '1120', '1310', '2010', '2040', '2060', '4060', '1020'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
const ACC = Object.fromEntries(COA.map((a) => [a.code, a.id]));

function seed(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries({
    chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [], payments: [],
    export_order_status_history: [], inventory_reservations: [], ...tables,
  })) {
    db.tables[k] = rows.map((r) => ({ ...r }));
  }
  db.locks.length = 0;
  accounting.journals.length = 0;
  accounting.createJournal.mockImplementation(async (_trx, j) => { accounting.journals.push(j); return { id: 500 + accounting.journals.length }; });
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const row = (table, id) => db.tables[table].find((r) => String(r.id) === String(id));
const lines = (j) => j.lines.map((l) => [l.account_id, l.debit, l.credit]);
const bt = () => db.tables.bank_transactions;
const ledgerDown = () => accounting.createJournal.mockImplementation(async () => { throw new Error('Period 2026-10 is closed.'); });

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.error.mockRestore(); console.warn.mockRestore(); });

const PKR_BANK = { id: 8, name: 'HBL', currency: 'PKR', current_balance: 100000, type: 'bank', entity: 'general', is_active: true };
const USD_BANK = { id: 9, name: 'USD a/c', currency: 'USD', current_balance: 0, type: 'bank', entity: 'export', is_active: true };
const MILL_CASH = { id: 41, name: 'Mill Cash', currency: 'PKR', current_balance: 50000, type: 'cash', entity: 'mill', is_active: true };

// ─── R7: Money Out pays a salaries expense — Dr 2040, not 2010 ────────────────
describe('R7 · recordPayment on an expense payable debits the account the accrual credited', () => {
  const tables = (category) => ({
    business_expenses: [{ id: 7, expense_no: 'EXP-2026-0007', category, expense_type: 'mill', amount_pkr: 6300, paid_amount: 0, payment_status: 'Pending' }],
    payables: [{ id: 20, pay_no: 'PAY-EXP0006', entity: 'mill', original_amount: 6300, paid_amount: 0, outstanding: 6300, status: 'Pending', source_table: 'business_expenses', source_id: 7 }],
    bank_accounts: [MILL_CASH],
  });
  const body = { type: 'payment', linked_payable_id: 20, amount: 6300, currency: 'PKR', payment_method: 'cash', payment_date: '2026-10-08' };

  test('salaries → Dr 2040 / Cr 1000, source stamped, BT row, expense + payable settled', async () => {
    seed(tables('salaries'));
    const r = res();
    await financeController.recordPayment({ body, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    const pay = r.body.data.payment;
    expect(pay).toMatchObject({ source_table: 'business_expenses', source_id: 7, linked_payable_id: 20, bank_account_id: 41 });
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment', refNo: pay.payment_no, entity: 'mill' });
    expect(lines(accounting.journals[0])).toEqual([[ACC['2040'], 6300, 0], [ACC['1000'], 0, 6300]]);
    expect(bt()).toEqual([expect.objectContaining({ bank_account_id: 41, type: 'debit', amount: 6300, source: 'record_payment', linked_payment_id: pay.id })]);
    expect(row('payables', 20)).toMatchObject({ paid_amount: 6300, outstanding: 0, status: 'Paid' });
    expect(row('business_expenses', 7)).toMatchObject({ paid_amount: 6300, payment_status: 'Paid' });
    expect(row('bank_accounts', 41).current_balance).toBe(43700);
  });

  test('any other expense → Dr 2010', async () => {
    seed(tables('maintenance'));
    const r = res();
    await financeController.recordPayment({ body, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(lines(accounting.journals[0])).toEqual([[ACC['2010'], 6300, 0], [ACC['1000'], 0, 6300]]);
  });

  test('a ledger failure fails the payment (400) — nothing reports success', async () => {
    seed(tables('salaries'));
    ledgerDown();
    const r = res();
    await financeController.recordPayment({ body, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/ledger entry could not be posted.*closed/);
  });

  test('a hauler payable is stamped to the hauler on the GL', async () => {
    seed({
      payables: [{ id: 30, pay_no: 'PAY-030', entity: 'mill', original_amount: 900, paid_amount: 0, outstanding: 900, status: 'Pending', hauler_id: 5, source_table: 'lot_transport', source_id: 3 }],
      transport_costs: [{ id: 1, payable_id: 30, status: 'unpaid' }],
      bank_accounts: [MILL_CASH],
    });
    const r = res();
    await financeController.recordPayment({ body: { ...body, linked_payable_id: 30, amount: 900 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(accounting.journals[0]).toMatchObject({ partyType: 'hauler', partyId: 5, entity: 'mill' });
    expect(row('transport_costs', 1).status).toBe('paid');
  });
});

// ─── R8: Money In on an export receivable → pending Finance confirmation ──────
describe('R8 · a Money In receipt on an export receivable goes through the order', () => {
  const tables = () => ({
    export_orders: [{ id: 1, order_no: 'EX-001', status: 'Awaiting Advance', currency: 'USD', customer_id: 95, advance_expected: 2650, advance_received: 0, balance_expected: 23850, balance_received: 0, booked_fx_rate: 280, bank_account_id: 9, qty_mt: 26.5 }],
    receivables: [
      { id: 1, recv_no: 'RCV-ADV-EX-001', type: 'Advance', entity: 'export', order_id: 1, customer_id: 95, currency: 'USD', expected_amount: 2650, received_amount: 0, outstanding: 2650, status: 'Pending' },
      { id: 2, recv_no: 'RCV-BAL-EX-001', type: 'Balance', entity: 'export', order_id: 1, customer_id: 95, currency: 'USD', expected_amount: 23850, received_amount: 0, outstanding: 23850, status: 'Pending' },
    ],
    bank_accounts: [USD_BANK, PKR_BANK],
  });

  test('records Pending Finance Confirmation: no bank, no GL, receivable untouched, order flagged', async () => {
    seed(tables());
    const r = res();
    await financeController.recordPayment({ body: { type: 'receipt', linked_receivable_id: 1, amount: 2650, currency: 'USD', payment_method: 'bank_transfer', bank_account_id: 9, payment_date: '2026-10-08' }, user: { id: 3 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.pending_confirmation).toBe(true);
    expect(r.body.data.payment).toMatchObject({ status: 'Pending Finance Confirmation', linked_receivable_id: 1, source_table: 'export_orders', source_id: 1 });
    expect(accounting.journals).toEqual([]);
    expect(bt()).toEqual([]);
    expect(row('bank_accounts', 9).current_balance).toBe(0);
    expect(row('receivables', 1).received_amount).toBe(0);
    expect(row('export_orders', 1).financial_status).toBe('Pending Confirmation');
  });

  test('Finance confirms it: order advance + receivable + bank + BT + Dr 1000 / Cr 1310 in PKR at the confirmed rate', async () => {
    seed(tables());
    await financeController.recordPayment({ body: { type: 'receipt', linked_receivable_id: 1, amount: 2650, currency: 'USD', payment_method: 'bank_transfer', bank_account_id: 9, payment_date: '2026-10-08', bank_reference: 'SWIFT-1' }, user: { id: 3 } }, res());
    const pendingId = db.tables.payments[0].id;
    const r = res();
    await exportController.confirmExportReceipt({ params: { paymentId: String(pendingId) }, body: { fx_rate: 281.5 }, user: { id: 4 } }, r);
    expect(r.statusCode).toBe(200);
    const order = row('export_orders', 1);
    expect(order).toMatchObject({ advance_received: 2650, advance_fx_rate: 281.5, financial_status: 'Confirmed', status: 'Advance Received' });
    expect(row('receivables', 1)).toMatchObject({ received_amount: 2650, outstanding: 0, status: 'Paid' });
    // The pending placeholder is replaced by the posted row: maker kept, checker stamped.
    expect(db.tables.payments).toHaveLength(1);
    const posted = db.tables.payments[0];
    expect(posted).toMatchObject({ created_by: 3, confirmed_by: 4, linked_receivable_id: 1, base_amount_pkr: 745975, bank_account_id: 9, bank_reference: 'SWIFT-1', source_table: 'export_orders' });
    // USD account banks the native USD; the BT row carries the same figure.
    expect(row('bank_accounts', 9).current_balance).toBe(2650);
    expect(bt()).toEqual([expect.objectContaining({ bank_account_id: 9, type: 'credit', amount: 2650, currency: 'USD', source: 'export_receipt', linked_payment_id: posted.id })]);
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Export Order', refNo: 'EX-001', entity: 'export', partyType: 'customer', partyId: 95, origCurrency: 'USD', origFxRate: 281.5 });
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 745975, 0], [ACC['1310'], 0, 745975]]);
  });
});

// ─── R5: export receipt confirmation posts inside the trx, Dr 1000 ────────────
describe('R5 · confirming an export receipt', () => {
  const tables = () => ({
    export_orders: [{ id: 1, order_no: 'EX-001', status: 'Shipped', currency: 'USD', customer_id: 95, advance_expected: 0, advance_received: 0, balance_expected: 1000, balance_received: 0, booked_fx_rate: 280, advance_fx_rate: null, bank_account_id: 8 }],
    receivables: [{ id: 2, recv_no: 'RCV-BAL-EX-001', type: 'Balance', entity: 'export', order_id: 1, customer_id: 95, currency: 'USD', expected_amount: 1000, received_amount: 0, outstanding: 1000, status: 'Pending' }],
    payments: [{ id: 70, payment_no: 'PAY-070', type: 'receipt', status: 'Pending Finance Confirmation', linked_receivable_id: 2, amount: 1000, currency: 'USD', fx_rate: 280, base_amount_pkr: 280000, payment_method: 'bank_transfer', bank_account_id: 8, payment_date: '2026-10-08', created_by: 3 }],
    bank_accounts: [PKR_BANK],
  });

  test('balance: Dr 1000 / Cr 1110 (never 1020), PKR account banks the PKR figure, BT row', async () => {
    seed(tables());
    const r = res();
    await exportController.confirmExportReceipt({ params: { paymentId: '70' }, body: { fx_rate: 279 }, user: { id: 4 } }, r);
    expect(r.statusCode).toBe(200);
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 279000, 0], [ACC['1110'], 0, 279000]]);
    expect(accounting.journals[0].lines.map((l) => l.account_id)).not.toContain(ACC['1020']);
    expect(accounting.autoPost).not.toHaveBeenCalled();
    expect(row('bank_accounts', 8).current_balance).toBe(100000 + 279000);
    expect(bt()).toEqual([expect.objectContaining({ type: 'credit', amount: 279000, currency: 'PKR', bank_account_id: 8 })]);
    expect(row('export_orders', 1)).toMatchObject({ balance_received: 1000, balance_received_pkr: 279000 });
  });

  test('a ledger failure fails the confirmation and leaves the pending receipt in place', async () => {
    seed(tables());
    ledgerDown();
    const r = res();
    await exportController.confirmExportReceipt({ params: { paymentId: '70' }, body: { fx_rate: 279 }, user: { id: 4 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/ledger entry could not be posted/);
    expect(row('payments', 70)).toMatchObject({ status: 'Pending Finance Confirmation' });
  });

  test('the direct confirm-advance route posts through the same engine', async () => {
    seed({
      export_orders: [{ id: 1, order_no: 'EX-002', status: 'Awaiting Advance', currency: 'PKR', customer_id: 7, advance_expected: 50000, advance_received: 0, balance_expected: 0, bank_account_id: 8, qty_mt: 0 }],
      receivables: [{ id: 3, type: 'Advance', entity: 'export', order_id: 1, customer_id: 7, currency: 'PKR', expected_amount: 50000, received_amount: 0, outstanding: 50000, status: 'Pending' }],
      bank_accounts: [PKR_BANK],
    });
    const r = res();
    await exportController.confirmAdvance({ params: { id: '1' }, body: { amount: 50000, payment_method: 'bank_transfer', bank_reference: 'R-1' }, user: { id: 4 } }, r);
    expect(r.statusCode).toBe(200);
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 50000, 0], [ACC['1310'], 0, 50000]]);
    expect(bt()).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({ bank_reference: 'R-1', source_table: 'export_orders', source_id: 1 });
  });

  test('a receipt with no account to land in is refused (it would post Dr 1000 with no bank move)', async () => {
    seed({ ...tables(), export_orders: [{ ...tables().export_orders[0], bank_account_id: null }], payments: [{ ...tables().payments[0], bank_account_id: null }] });
    const r = res();
    await exportController.confirmExportReceipt({ params: { paymentId: '70' }, body: {}, user: { id: 4 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Choose the account/);
    expect(accounting.journals).toEqual([]);
  });
});

// ─── R6: paying a raw-rice lot from Purchases settles its payables ────────────
describe('R6 · payPurchase resolves the real payable', () => {
  const tables = () => ({
    inventory_lots: [{ id: 5, lot_no: 'LOT-5', entity: 'mill', supplier_id: 4, landed_cost_total: 1500, paid_amount: 0, due_amount: 1300, payment_status: 'Pending' }],
    payables: [
      // createPurchaseLot's shape: the rice line has NO source_table.
      { id: 41, pay_no: 'PAY-041', entity: 'mill', category: 'Raw Material', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', supplier_id: 4, source_table: null, source_id: 5, linked_ref: 'LOT-5' },
      { id: 42, pay_no: 'PAY-042', entity: 'mill', category: 'Bags', original_amount: 300, paid_amount: 0, outstanding: 300, status: 'Pending', supplier_id: 4, source_table: 'lot_bag', source_id: 5, linked_ref: 'LOT-5' },
      // The hauler's bill on the same lot is someone else's — not paid here.
      { id: 43, pay_no: 'PAY-043', entity: 'mill', category: 'Transport', original_amount: 200, paid_amount: 0, outstanding: 200, status: 'Pending', hauler_id: 6, source_table: 'lot_transport', source_id: 5, linked_ref: 'LOT-5' },
    ],
    transport_costs: [],
    bank_accounts: [PKR_BANK],
  });

  test('a lot payment settles the rice line then the itemised lines, one PAY row each, with BT rows and Dr 2010 / Cr 1000', async () => {
    seed(tables());
    const r = res();
    await financeController.payPurchase({ body: { source: 'lot', source_id: 5, amount: 1200, payment_method: 'bank_transfer', bank_account_id: 8, payment_date: '2026-10-08' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.payments.map((p) => [p.payable_id, p.amount])).toEqual([[41, 1000], [42, 200]]);
    expect(row('payables', 41)).toMatchObject({ paid_amount: 1000, status: 'Paid' });
    expect(row('payables', 42)).toMatchObject({ paid_amount: 200, status: 'Partial' });
    expect(row('payables', 43)).toMatchObject({ paid_amount: 0 });
    expect(row('inventory_lots', 5)).toMatchObject({ paid_amount: 1200, payment_status: 'Partial' });
    expect(db.tables.payments.every((p) => p.source_table === 'inventory_lots' && p.source_id === 5)).toBe(true);
    expect(bt()).toHaveLength(2);
    expect(bt().every((b) => b.type === 'debit' && b.linked_payment_id)).toBe(true);
    expect(row('bank_accounts', 8).current_balance).toBe(100000 - 1200);
    expect(accounting.journals.map(lines)).toEqual([
      [[ACC['2010'], 1000, 0], [ACC['1000'], 0, 1000]],
      [[ACC['2010'], 200, 0], [ACC['1000'], 0, 200]],
    ]);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment', partyType: 'supplier', partyId: 4, entity: 'mill' });
  });

  test('refuses more than the supplier is owed on the lot (transport is paid to the transporter)', async () => {
    seed(tables());
    const r = res();
    await financeController.payPurchase({ body: { source: 'lot', source_id: 5, amount: 1500, payment_method: 'bank_transfer', bank_account_id: 8 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/owed to the supplier on this lot.*1300\.00/);
    expect(db.tables.payments).toEqual([]);
  });

  test('a Purchases-tab payment is reversible like any other', async () => {
    seed(tables());
    await financeController.payPurchase({ body: { source: 'lot', source_id: 5, amount: 1000, payment_method: 'bank_transfer', bank_account_id: 8 }, user: { id: 1 } }, res());
    const p = db.tables.payments[0];
    db.tables.journal_entries.push({ id: 90, ref_no: p.payment_no, ref_type: 'Payment', status: 'Posted', entity: 'mill', party_type: 'supplier', party_id: 4 });
    db.tables.journal_lines.push(
      { id: 1, journal_id: 90, account_id: ACC['2010'], debit: 1000, credit: 0 },
      { id: 2, journal_id: 90, account_id: ACC['1000'], debit: 0, credit: 1000 },
    );
    accounting.journals.length = 0;
    const r = res();
    await financeController.reversePayment({ params: { id: String(p.id) }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('payables', 41)).toMatchObject({ paid_amount: 0, status: 'Pending' });
    expect(row('inventory_lots', 5).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(100000);
    expect(lines(accounting.journals[0])).toEqual([[ACC['2010'], 0, 1000], [ACC['1000'], 1000, 0]]);
  });

  test('a mill-store purchase settles its payable through the engine', async () => {
    seed({
      mill_purchases: [{ id: 3, purchase_no: 'MP-3', total_amount: 400, paid_amount: 0, payment_status: 'Pending', supplier_id: 2 }],
      payables: [{ id: 50, entity: 'mill', original_amount: 400, paid_amount: 0, outstanding: 400, status: 'Pending', supplier_id: 2, source_table: 'mill_purchases', source_id: 3 }],
      bank_accounts: [MILL_CASH],
    });
    const r = res();
    await financeController.payPurchase({ body: { source: 'mill_store', source_id: 3, amount: 400, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('payables', 50).status).toBe('Paid');
    expect(row('mill_purchases', 3)).toMatchObject({ paid_amount: 400, payment_status: 'Paid', bank_account_id: 41, payment_method: 'cash' });
    expect(bt()).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({ linked_payable_id: 50, source_table: 'mill_purchases', bank_account_id: 41 });
  });

  test('a source with no payable is paid against the source row (and still gets a payment row)', async () => {
    seed({
      export_order_costs: [{ id: 9, order_id: 1, amount: 700, base_amount_pkr: 700, fx_rate: 1, paid_amount: 0, payment_status: 'Pending' }],
      payables: [],
      bank_accounts: [PKR_BANK],
    });
    const r = res();
    await financeController.payPurchase({ body: { source: 'export_cost', source_id: 9, payment_method: 'bank_transfer', bank_account_id: 8 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(db.tables.payments[0]).toMatchObject({ source_table: 'export_order_costs', source_id: 9, linked_payable_id: null, amount: 700 });
    expect(row('export_order_costs', 9)).toMatchObject({ paid_amount: 700, payment_status: 'Paid' });
    expect(accounting.journals[0]).toMatchObject({ entity: 'export' });
  });
});

// ─── Service-milling receipts: GL + BT + account choice ──────────────────────
describe('A4 · service-milling receipts', () => {
  const tables = () => ({
    service_milling_invoices: [{ id: 4, invoice_no: 'SMI-4', client_customer_id: 61, total_amount: 10000, received_amount: 0, balance_amount: 10000, payment_status: 'Unpaid' }],
    receivables: [{ id: 12, recv_no: 'RCV-SMI-4', type: 'Service Milling', entity: 'mill', customer_id: 61, service_invoice_id: 4, expected_amount: 10000, received_amount: 0, outstanding: 10000, status: 'Pending' }],
    bank_accounts: [PKR_BANK, MILL_CASH],
  });

  test('a bank transfer lands in the picked account and posts Dr 1000 / Cr 1120 (mill, client)', async () => {
    seed(tables());
    const r = res();
    await serviceController.recordPayment({ params: { id: '4' }, body: { amount: 4000, payment_method: 'bank_transfer', bank_account_id: 8, reference: 'TT-9' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.payment).toMatchObject({ service_invoice_id: 4, linked_receivable_id: 12, bank_account_id: 8 });
    expect(row('bank_accounts', 8).current_balance).toBe(104000);
    expect(bt()).toEqual([expect.objectContaining({ bank_account_id: 8, type: 'credit', amount: 4000, source: 'service_milling' })]);
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 4000, 0], [ACC['1120'], 0, 4000]]);
    expect(accounting.journals[0]).toMatchObject({ entity: 'mill', partyType: 'customer', partyId: 61 });
    expect(row('service_milling_invoices', 4)).toMatchObject({ received_amount: 4000, balance_amount: 6000, payment_status: 'Partial' });
    expect(row('receivables', 12)).toMatchObject({ received_amount: 4000, status: 'Partial' });
  });

  test('cash with no account lands in Mill Cash', async () => {
    seed(tables());
    const r = res();
    await serviceController.recordPayment({ params: { id: '4' }, body: { amount: 10000, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(row('bank_accounts', 41).current_balance).toBe(60000);
    expect(row('service_milling_invoices', 4).payment_status).toBe('Paid');
  });

  test('a bank transfer with no account is refused instead of posting with no bank move', async () => {
    seed(tables());
    const r = res();
    await serviceController.recordPayment({ params: { id: '4' }, body: { amount: 100, payment_method: 'bank_transfer' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(db.tables.payments).toEqual([]);
  });

  test('Money In on the service receivable credits 1120 (not 1110) and settles the invoice too', async () => {
    seed(tables());
    const r = res();
    await financeController.recordPayment({ body: { type: 'receipt', linked_receivable_id: 12, amount: 10000, currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: 8, payment_date: '2026-10-08' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 10000, 0], [ACC['1120'], 0, 10000]]);
    expect(row('service_milling_invoices', 4)).toMatchObject({ received_amount: 10000, payment_status: 'Paid' });
  });

  test('a ledger failure fails the receipt', async () => {
    seed(tables());
    ledgerDown();
    const r = res();
    await serviceController.recordPayment({ params: { id: '4' }, body: { amount: 100, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/ledger entry could not be posted/);
  });
});

describe('opening AR receipt through Money In', () => {
  test('a mill opening receivable (booked to 1120) is credited to 1120, entity mill', async () => {
    seed({
      receivables: [{ id: 11, recv_no: 'RCV-OPEN-72', type: 'Balance', entity: 'mill', customer_id: 72, currency: 'PKR', expected_amount: 5000, received_amount: 0, outstanding: 5000, status: 'Pending' }],
      bank_accounts: [MILL_CASH],
    });
    const r = res();
    await financeController.recordPayment({ body: { type: 'receipt', linked_receivable_id: 11, amount: 5000, currency: 'PKR', payment_method: 'cash', payment_date: '2026-10-08' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(lines(accounting.journals[0])).toEqual([[ACC['1000'], 5000, 0], [ACC['1120'], 0, 5000]]);
    expect(accounting.journals[0]).toMatchObject({ entity: 'mill', partyType: 'customer', partyId: 72 });
    expect(bt()).toHaveLength(1);
  });
});

// ─── Expenses: create pay-now and markPaid go through the engine ─────────────
describe('expenses pay through the engine', () => {
  test('pay-now at create: PAY- row stamped with the expense, BT row, Dr 2040 for salaries, settled', async () => {
    seed({ business_expenses: [], payables: [], bank_accounts: [MILL_CASH], milling_costs: [], suppliers: [] });
    const exp = await expensesService.create({
      expense_type: 'mill', category: 'salaries', amount: 6300, currency: 'PKR', expense_date: '2026-10-08',
      pay_now: true, payment_method: 'cash',
    }, 1);
    expect(exp).toMatchObject({ payment_status: 'Paid', paid_amount: 6300, bank_account_id: 41, payment_method: 'cash' });
    const pay = db.tables.payments[0];
    expect(pay).toMatchObject({ source_table: 'business_expenses', source_id: exp.id, bank_account_id: 41 });
    expect(pay.payment_no).toMatch(/^PAY-\d+$/);
    expect(db.tables.payables[0]).toMatchObject({ paid_amount: 6300, status: 'Paid' });
    expect(bt()).toEqual([expect.objectContaining({ type: 'debit', amount: 6300, source: 'salaries', linked_payment_id: pay.id })]);
    expect(lines(accounting.journals[0])).toEqual([[ACC['2040'], 6300, 0], [ACC['1000'], 0, 6300]]);
  });

  test('pay-now by bank transfer with no account is refused (it used to post the GL with no bank move)', async () => {
    seed({ business_expenses: [], payables: [], bank_accounts: [PKR_BANK], suppliers: [] });
    await expect(expensesService.create({
      expense_type: 'general', category: 'rent', amount: 100, currency: 'PKR', expense_date: '2026-10-08',
      pay_now: true, payment_method: 'bank_transfer',
    }, 1)).rejects.toThrow(/Choose the account/);
  });

  test('markPaid: an installment settles through the engine with its BT row and journal', async () => {
    seed({
      business_expenses: [{ id: 3, expense_no: 'EXP-3', category: 'rent', expense_type: 'general', amount_pkr: 1000, paid_amount: 0, payment_status: 'Pending' }],
      payables: [{ id: 60, entity: 'general', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', source_table: 'business_expenses', source_id: 3 }],
      bank_accounts: [PKR_BANK],
    });
    const out = await expensesService.markPaid(3, { amount: 400, bank_account_id: 8, payment_method: 'bank_transfer', paid_date: '2026-10-08' }, 1);
    expect(out).toMatchObject({ paid_amount: 400, payment_status: 'Partial' });
    expect(row('payables', 60)).toMatchObject({ paid_amount: 400, status: 'Partial' });
    expect(bt()).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ entity: 'general' });
    expect(lines(accounting.journals[0])).toEqual([[ACC['2010'], 400, 0], [ACC['1000'], 0, 400]]);
  });

  test('markPaid: a ledger failure throws (the caller\'s transaction rolls back)', async () => {
    seed({
      business_expenses: [{ id: 3, expense_no: 'EXP-3', category: 'rent', expense_type: 'general', amount_pkr: 1000, paid_amount: 0, payment_status: 'Pending' }],
      payables: [{ id: 60, entity: 'general', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', source_table: 'business_expenses', source_id: 3 }],
      bank_accounts: [PKR_BANK],
    });
    ledgerDown();
    await expect(expensesService.markPaid(3, { amount: 400, bank_account_id: 8, payment_method: 'bank_transfer' }, 1)).rejects.toThrow(/ledger entry could not be posted/);
  });
});

// ─── H2: derived rows in the payables feed ───────────────────────────────────
describe('H2 · the payables feed', () => {
  test('an export cost with its own payable is listed once, in PKR; derived rows say where they are settled', async () => {
    seed({
      payables: [{ id: 70, pay_no: 'PAY-EOC0001', entity: 'export', payable_type: 'expense', original_amount: 5000, paid_amount: 0, outstanding: 5000, status: 'Pending', currency: 'PKR', source_table: 'export_order_costs', source_id: 1, created_at: '2026-10-01' }],
      export_order_costs: [
        { id: 1, order_id: 1, category: 'freight', amount: 5000, base_amount_pkr: 5000, currency: 'PKR', fx_rate: 1, paid_amount: 0, created_at: '2026-10-01' },
        { id: 2, order_id: 1, category: 'clearing', amount: 800, base_amount_pkr: 800, currency: 'PKR', fx_rate: 1, paid_amount: 0, created_at: '2026-10-02' },
      ],
      milling_costs: [], mill_expenses: [], batch_source_lots: [], export_orders: [{ id: 1, order_no: 'EX-001' }],
    });
    const r = res();
    await financeController.getPayables({ query: {}, user: { id: 1, role_id: 1, _roleName: 'Super Admin' } }, r);
    expect(r.statusCode).toBe(200);
    const rows = r.body.data.payables;
    const ids = rows.map((p) => String(p.id));
    expect(ids).toContain('70');
    expect(ids).not.toContain('EC-1'); // its real payable is listed
    const ec2 = rows.find((p) => p.id === 'EC-2');
    expect(ec2).toMatchObject({ currency: 'PKR', original_amount: 800, derived: true });
    expect(ec2.settle_hint).toMatch(/Purchases/);
  });
});
