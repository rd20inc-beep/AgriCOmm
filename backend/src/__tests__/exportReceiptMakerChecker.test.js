/**
 * Export receipts are maker-checker (audit R10a): whoever recorded a receipt
 * does not confirm it. confirmPendingExportReceipt never compared the pending
 * row's created_by with the confirming user, and the one-step confirm-advance /
 * confirm-balance routes let a single person record AND post the money. An
 * Owner or Super Admin may still do both.
 *
 * Runs the real controller + exportReceipts + payment engine on the in-memory
 * knex (helpers/fakeKnex).
 */
const fs = require('fs');
const path = require('path');

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
jest.mock('../services/inventoryService', () => ({ reserveStock: jest.fn(async () => null), MOVEMENT_TYPES: {} }));
jest.mock('../modules/inventory/inventory.service', () => ({ reserveStock: jest.fn(async () => null), MOVEMENT_TYPES: {} }));
jest.mock('../services/automationService', () => ({
  onAdvanceConfirmed: jest.fn(async () => null), onBalanceConfirmed: jest.fn(async () => null),
}));
jest.mock('../modules/admin/automation.service', () => ({
  onAdvanceConfirmed: jest.fn(async () => null), onBalanceConfirmed: jest.fn(async () => null),
}));
jest.mock('../services/exportOrderEventBus', () => ({ publishExportOrderUpdate: jest.fn() }));

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const exportController = require('../modules/exportOrders/exportOrders.controller');

const COA = ['1000', '1110', '1310', '6210'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
const PKR_BANK = { id: 8, name: 'HBL', currency: 'PKR', current_balance: 100000, type: 'bank', entity: 'export', is_active: true };
const USERS = [{ id: 3, role_id: 5 }, { id: 4, role_id: 5 }, { id: 9, role_id: 10 }, { id: 1, role_id: 1 }];
const ROLES = [{ id: 1, name: 'Super Admin' }, { id: 5, name: 'Finance Manager' }, { id: 10, name: 'Owner' }];

function seed(createdBy) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  const tables = {
    chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [],
    export_order_status_history: [], inventory_reservations: [], users: USERS, roles: ROLES,
    export_orders: [{ id: 1, order_no: 'EX-001', status: 'Awaiting Advance', currency: 'PKR', customer_id: 7, advance_expected: 50000, advance_received: 0, balance_expected: 0, bank_account_id: 8, qty_mt: 0 }],
    receivables: [{ id: 3, type: 'Advance', entity: 'export', order_id: 1, customer_id: 7, currency: 'PKR', expected_amount: 50000, received_amount: 0, outstanding: 50000, status: 'Pending' }],
    payments: [{ id: 70, payment_no: 'PAY-070', type: 'receipt', status: 'Pending Finance Confirmation', linked_receivable_id: 3, amount: 50000, currency: 'PKR', fx_rate: 1, base_amount_pkr: 50000, payment_method: 'bank_transfer', bank_account_id: 8, payment_date: '2026-10-08', created_by: createdBy }],
    bank_accounts: [PKR_BANK],
  };
  for (const [k, rows] of Object.entries(tables)) db.tables[k] = rows.map((r) => ({ ...r }));
  db.locks.length = 0;
  accounting.journals.length = 0;
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const row = (table, id) => db.tables[table].find((r) => String(r.id) === String(id));
const confirm = async (userId) => {
  const r = res();
  await exportController.confirmExportReceipt({ params: { paymentId: '70' }, body: {}, user: { id: userId } }, r);
  return r;
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.error.mockRestore(); console.warn.mockRestore(); });

describe('confirming a pending export receipt', () => {
  test('the user who recorded it is refused with 403 and nothing posts', async () => {
    seed(3);
    const r = await confirm(3);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/another Finance user must confirm/);
    expect(row('payments', 70).status).toBe('Pending Finance Confirmation');
    expect(accounting.journals).toEqual([]);
    expect(row('bank_accounts', 8).current_balance).toBe(100000);
  });

  test('another Finance user confirms it', async () => {
    seed(3);
    const r = await confirm(4);
    expect(r.statusCode).toBe(200);
    // The pending row is kept as Superseded (P2-15); the posted row follows it.
    const posted = db.tables.payments.find((p) => p.status !== 'Superseded');
    expect(posted).toMatchObject({ created_by: 3, confirmed_by: 4 });
    expect(db.tables.payments.find((p) => p.status === 'Superseded')).toMatchObject({ superseded_by_payment_id: posted.id });
  });

  test.each([[9, 'Owner'], [1, 'Super Admin']])('user %i (%s) may confirm a receipt they recorded', async (uid) => {
    seed(uid);
    const r = await confirm(uid);
    expect(r.statusCode).toBe(200);
    expect(accounting.journals).toHaveLength(1);
  });

  test('a legacy pending row with no recorder can be confirmed', async () => {
    seed(null);
    expect((await confirm(4)).statusCode).toBe(200);
  });
});

describe('one-step confirm-advance / confirm-balance', () => {
  const direct = async (userId) => {
    seed(3);
    db.tables.payments = [];
    const r = res();
    await exportController.confirmAdvance({ params: { id: '1' }, body: { amount: 50000, payment_method: 'bank_transfer' }, user: { id: userId } }, r);
    return r;
  };

  test('a Finance user cannot record and confirm in one step', async () => {
    const r = await direct(4);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/Pending Finance Confirmation/);
    expect(db.tables.payments).toEqual([]);
    expect(row('export_orders', 1).advance_received).toBe(0);
  });

  test('the Owner can', async () => {
    const r = await direct(9);
    expect(r.statusCode).toBe(200);
    expect(row('export_orders', 1).advance_received).toBe(50000);
  });

  test('both routes also require finance.confirm_payment', () => {
    const src = fs.readFileSync(path.join(__dirname, '../modules/exportOrders/exportOrders.routes.js'), 'utf8');
    for (const kind of ['advance', 'balance']) {
      const at = src.indexOf(`'/:id/confirm-${kind}'`);
      const stmt = src.slice(at, src.indexOf(');', at));
      expect(stmt).toContain("authorize('finance', 'confirm_payment')");
    }
  });
});
