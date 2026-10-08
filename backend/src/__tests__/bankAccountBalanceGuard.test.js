/**
 * Bank-account master edits must not move money.
 *
 * The Admin edit form used to send the whole row back, current_balance included,
 * and updateBankAccount wrote {...req.body} — so fixing an IBAN rewrote the
 * balance with no bank_transactions row and no journal, and a payment that
 * landed while the form was open was silently overwritten by the stale figure.
 *
 * Executed against an in-memory knex (DB-less, runs in CI):
 *   - an edit of descriptive fields leaves current_balance alone
 *   - a different balance → 400 and nothing written
 *   - stale form (a payment moved the balance after the form loaded) → stored
 *     balance survives, whether the old client re-sends it or the new one omits it
 *   - currency / entity change on an account with transactions → 409
 *   - create gives the account its own GL account under 1000 (G-8) and an
 *     opening balance writes the BT row + a Posted Dr account GL / Cr 3000
 *   - the Joi schemas keep every field the service reads; the routes validate
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());

jest.mock('../utils/docNumber', () => {
  let n = 0;
  return { nextDocNo: jest.fn(async (trx, { prefix }) => { n += 1; return `${prefix}${String(n).padStart(4, '0')}`; }) };
});

jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async (trx, { entity, refType, refNo, lines }) => {
    const [j] = await trx('journal_entries').insert({
      journal_no: `JE-T-${refNo}`, entity, ref_type: refType, ref_no: refNo, status: 'Draft',
    }).returning('*');
    for (const l of lines) await trx('journal_lines').insert({ journal_id: j.id, account_id: l.account_id, debit: l.debit, credit: l.credit });
    return j;
  }),
  postJournal: jest.fn(async (trx, id) => { await trx('journal_entries').where({ id }).update({ status: 'Posted' }); }),
}));

jest.mock('../modules/finance/fxRate.service', () => ({
  getRateForDate: jest.fn(async () => ({ rate: 280, source: 'fx_rates' })),
}));

const db = require('../config/database');
const svc = require('../modules/admin/bankAccounts.service');
const controller = require('../modules/admin/admin.controller');
const schemas = require('../middleware/schemas');

const T = db.tables;
function seed() {
  for (const k of Object.keys(T)) delete T[k];
  T.bank_accounts = [
    { id: 1, name: 'HBL Current', bank_name: 'HBL', iban: 'PK00OLD', type: 'bank', currency: 'PKR', entity: 'general', current_balance: '1500000.00', is_export_default: false },
    { id: 2, name: 'Fresh USD', type: 'bank', currency: 'USD', entity: 'general', current_balance: '0.00', is_export_default: false },
  ];
  T.bank_transactions = [{ id: 1, bank_account_id: 1, type: 'credit', amount: 1500000, status: 'posted' }];
  T.payments = [];
  T.fund_transfers = [];
  T.journal_entries = [];
  T.journal_lines = [];
  T.chart_of_accounts = [{ id: 10, code: '1000', name: 'Cash & Bank' }, { id: 30, code: '3000', name: "Owner's Equity" }];
}
const acct = (id) => T.bank_accounts.find((a) => a.id === id);

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const call = async (handler, { params = {}, body = {} } = {}) => {
  const res = mockRes();
  await controller[handler]({ params, body, user: { id: 7 } }, res);
  return res;
};

beforeEach(seed);

describe('updateBankAccount — balance is never written', () => {
  test('editing the IBAN (as the new form sends it, no balance) leaves current_balance untouched', async () => {
    const res = await call('updateBankAccount', { params: { id: 1 }, body: { name: 'HBL Current', iban: 'PK36SCBL0000001123456702', currency: 'PKR', type: 'bank' } });
    expect(res.statusCode).toBe(200);
    expect(acct(1).iban).toBe('PK36SCBL0000001123456702');
    expect(acct(1).current_balance).toBe('1500000.00');
  });

  test('a client re-sending the SAME balance is accepted and the balance is not rewritten', async () => {
    const res = await call('updateBankAccount', { params: { id: 1 }, body: { iban: 'PK99', current_balance: 1500000 } });
    expect(res.statusCode).toBe(200);
    expect(acct(1).current_balance).toBe('1500000.00');
    expect(acct(1).iban).toBe('PK99');
  });

  test('a DIFFERENT balance → 400 with the policy message, and nothing at all is written', async () => {
    const before = JSON.stringify(T.bank_accounts);
    const res = await call('updateBankAccount', { params: { id: 1 }, body: { iban: 'PK-NEW', current_balance: 9999999 } });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Balances change only through payments, transfers or a Danger Zone adjustment.');
    expect(JSON.stringify(T.bank_accounts)).toBe(before);
  });

  test('stale form: a payment moved the balance after the form loaded — the stored balance survives', async () => {
    // Form loaded at 1,500,000; a receipt then credits 250,000.
    acct(1).current_balance = '1750000.00';
    // Old client: sends the balance it loaded → refused, nothing written.
    const old = await call('updateBankAccount', { params: { id: 1 }, body: { iban: 'PK-STALE', current_balance: 1500000 } });
    expect(old.statusCode).toBe(400);
    expect(acct(1).current_balance).toBe('1750000.00');
    expect(acct(1).iban).toBe('PK00OLD');
    // New client: no balance in the payload → the edit lands, the balance stays.
    const now = await call('updateBankAccount', { params: { id: 1 }, body: { iban: 'PK-STALE', currency: 'PKR' } });
    expect(now.statusCode).toBe(200);
    expect(acct(1).current_balance).toBe('1750000.00');
    expect(acct(1).iban).toBe('PK-STALE');
  });

  test('columns outside the whitelist (id, uid, created_at) are ignored', async () => {
    await svc.updateBankAccount(db, 1, { id: 99, uid: 'HACK', created_at: '2000-01-01', name: 'Renamed' });
    expect(acct(1)).toMatchObject({ id: 1, name: 'Renamed' });
    expect(acct(1).uid).toBeUndefined();
    expect(acct(1).created_at).toBeUndefined();
  });

  test('currency change on an account with transactions → 409, unchanged', async () => {
    const res = await call('updateBankAccount', { params: { id: 1 }, body: { currency: 'USD' } });
    expect(res.statusCode).toBe(409);
    expect(acct(1).currency).toBe('PKR');
  });

  test('entity change on an account with payments → 409', async () => {
    T.payments.push({ id: 5, bank_account_id: 2 });
    const res = await call('updateBankAccount', { params: { id: 2 }, body: { entity: 'mill' } });
    expect(res.statusCode).toBe(409);
    expect(acct(2).entity).toBe('general');
  });

  test('currency change on an unused, zero-balance account is allowed', async () => {
    const res = await call('updateBankAccount', { params: { id: 2 }, body: { currency: 'EUR' } });
    expect(res.statusCode).toBe(200);
    expect(acct(2).currency).toBe('EUR');
  });

  test('unknown id → 404', async () => {
    const res = await call('updateBankAccount', { params: { id: 404 }, body: { name: 'x' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('createBankAccount — an opening balance is booked, not just written', () => {
  test('opening balance → account at that balance + its own GL account + BT "Opening Balance" row + Posted Dr account GL / Cr 3000', async () => {
    const res = await call('createBankAccount', { body: { name: 'Meezan Ops', type: 'bank', currency: 'PKR', entity: 'mill', opening_balance: 250000 } });
    expect(res.statusCode).toBe(201);
    const a = res.body.data.bank_account;
    expect(Number(a.current_balance)).toBe(250000);

    const bt = T.bank_transactions.filter((t) => t.bank_account_id === a.id);
    expect(bt).toHaveLength(1);
    expect(bt[0]).toMatchObject({ type: 'credit', amount: 250000, source: 'opening_balance', category: 'Opening Balance', status: 'posted', running_balance: 250000, created_by: 7 });

    expect(T.journal_entries).toHaveLength(1);
    const je = T.journal_entries[0];
    expect(je).toMatchObject({ status: 'Posted', ref_type: 'opening_balance', ref_no: `OPEN-BANK-${a.id}`, entity: 'mill' });
    // Its own GL account: next free code under 1000, named after the account.
    const gl = T.chart_of_accounts.find((c) => c.id === acct(a.id).gl_account_id);
    expect(gl).toMatchObject({ code: '1011', name: 'Meezan Ops', type: 'Asset', parent_id: 10, currency: 'PKR', entity: 'mill' });
    const lines = T.journal_lines.filter((l) => l.journal_id === je.id);
    expect(lines.find((l) => l.account_id === 10)).toBeUndefined();
    expect(lines.find((l) => l.account_id === gl.id)).toMatchObject({ debit: 250000, credit: 0 });
    expect(lines.find((l) => l.account_id === 30)).toMatchObject({ debit: 0, credit: 250000 });
  });

  test('a USD opening balance posts the PKR equivalent to the GL, native amount to the sub-ledger', async () => {
    const res = await call('createBankAccount', { body: { name: 'BAHL USD', currency: 'USD', opening_balance: 1000, opening_fx_rate: 281.5 } });
    const a = res.body.data.bank_account;
    expect(T.bank_transactions.find((t) => t.bank_account_id === a.id)).toMatchObject({ amount: 1000, currency: 'USD' });
    const lines = T.journal_lines;
    const gl = T.chart_of_accounts.find((c) => c.id === acct(a.id).gl_account_id);
    expect(gl).toMatchObject({ currency: 'USD', parent_id: 10 });
    expect(lines.find((l) => l.account_id === gl.id).debit).toBe(281500);
    expect(lines.find((l) => l.account_id === 30).credit).toBe(281500);
  });

  test('no opening balance → no BT row, no journal', async () => {
    const res = await call('createBankAccount', { body: { name: 'Petty', type: 'cash' } });
    expect(res.statusCode).toBe(201);
    expect(Number(res.body.data.bank_account.current_balance)).toBe(0);
    expect(T.bank_transactions).toHaveLength(1); // only the seeded one
    expect(T.journal_entries).toHaveLength(0);
  });
});

describe('Joi + routes', () => {
  const run = (schema, body) => schema.validate(body, { abortEarly: false, stripUnknown: true });

  test('update schema keeps every whitelisted field and the balance (so a changed one can be refused)', () => {
    const body = Object.fromEntries([...svc.EDITABLE, ...svc.LOCKED_ONCE_USED].map((k) => [k, k.startsWith('is_') || k === 'approved_for_customer' ? true : 'x']));
    body.name = 'A'; body.type = 'bank'; body.currency = 'PKR'; body.entity = 'general'; body.current_balance = 5;
    const { error, value } = run(schemas.updateBankAccount, body);
    expect(error).toBeUndefined();
    for (const k of Object.keys(body)) expect(value).toHaveProperty(k);
  });

  test('create schema keeps the opening fields and requires a name', () => {
    const { value } = run(schemas.createBankAccount, { name: 'A', opening_balance: 10, opening_fx_rate: 280 });
    expect(value).toMatchObject({ opening_balance: 10, opening_fx_rate: 280 });
    expect(run(schemas.createBankAccount, { opening_balance: 10 }).error).toBeDefined();
  });

  test('POST and PUT /bank-accounts run validate()', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../modules/admin/admin.routes'), 'utf8');
    expect(src).toMatch(/'\/bank-accounts',\s*\n\s*authorize\('admin', 'manage_master_data'\),\s*\n\s*validate\(schemas\.createBankAccount\)/);
    expect(src).toMatch(/'\/bank-accounts\/:id',\s*\n\s*authorize\('admin', 'manage_master_data'\),\s*\n\s*validate\(schemas\.updateBankAccount\)/);
  });
});
