/**
 * Contra transfers — fast, DB-less checks (the end-to-end flow against a real
 * Postgres lives in contraTransfer.integration.test.js):
 *
 *  1. computeContraAmounts — the currency / rate / tolerance rules.
 *  2. The service executed on an in-memory knex: an internal transfer moves
 *     both accounts and posts no journal; bank charges post Dr 6200 / Cr 1000;
 *     a bad request writes nothing; a mill-only payer is held to mill accounts.
 *  3. Joi: every field the service reads survives validate(); reverse and edit
 *     need a reason.
 *  4. The route stacks: create is finance.confirm_payment OR milling.edit,
 *     reverse / edit are Owner / Super Admin.
 *  5. Migration 319 adds the direction CHECK with 'internal'.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());

jest.mock('../utils/docNumber', () => {
  const seq = {};
  return {
    nextDocNo: jest.fn(async (trx, { prefix, pad = 4 }) => {
      seq[prefix] = (seq[prefix] || 0) + 1;
      return `${prefix}${String(seq[prefix]).padStart(pad, '0')}`;
    }),
  };
});

jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async (trx, { entity, refType, refNo, description, lines, origCurrency, origFxRate }) => {
    const [j] = await trx('journal_entries').insert({
      journal_no: `JE-${Math.random().toString(36).slice(2, 8)}`, entity, ref_type: refType, ref_no: refNo,
      description, status: 'Draft', orig_currency: origCurrency, orig_fx_rate: origFxRate,
    }).returning('*');
    for (const l of lines) await trx('journal_lines').insert({ journal_id: j.id, account_id: l.account_id, debit: l.debit, credit: l.credit });
    return j;
  }),
  postJournal: jest.fn(async (trx, id) => { await trx('journal_entries').where({ id }).update({ status: 'Posted' }); }),
}));

const db = require('../config/database');
const ft = require('../modules/finance/fundTransfers.service');
const schemas = require('../middleware/schemas');

function seed(extra = {}) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  Object.assign(db.tables, {
    bank_accounts: [
      { id: 1, name: 'HO Cash', type: 'cash', entity: 'general', currency: 'PKR', current_balance: 1000000, is_active: true },
      { id: 2, name: 'HO Bank', type: 'bank', entity: 'general', currency: 'PKR', current_balance: 0, is_active: true },
      { id: 3, name: 'USD Bank', type: 'bank', entity: 'general', currency: 'USD', current_balance: 20000, is_active: true },
      { id: 4, name: 'Mill Cash', type: 'cash', entity: 'mill', currency: 'PKR', current_balance: 5000, is_active: true },
      { id: 5, name: 'Mill Bank', type: 'bank', entity: 'mill', currency: 'PKR', current_balance: 0, is_active: true },
    ],
    chart_of_accounts: [{ id: 100, code: '1000', name: 'Cash & Bank' }, { id: 130, code: '1130', name: 'IC' }, { id: 620, code: '6200', name: 'Bank Charges' }],
    fund_transfers: [], bank_transactions: [], journal_entries: [], journal_lines: [], payments: [],
    ...extra,
  });
}
const balances = () => Object.fromEntries(db.tables.bank_accounts.map((a) => [a.id, Number(a.current_balance)]));
const create = (body, opts) => ft.createContraInTrx(db, { reference: 'SLIP-1', ...body }, 7, opts);

describe('1. computeContraAmounts', () => {
  const c = ft.computeContraAmounts;
  test('same currency: destination = amount, no FX flag', () => {
    expect(c({ fromCurrency: 'PKR', toCurrency: 'PKR', amount: 500000 })).toMatchObject({ toAmount: 500000, fxRate: null, amountPkr: 500000, fxUnbooked: false });
    expect(c({ fromCurrency: 'USD', toCurrency: 'USD', amount: 100 })).toMatchObject({ toAmount: 100, amountPkr: null, fxUnbooked: false });
    expect(c({ fromCurrency: 'USD', toCurrency: 'USD', amount: 100, fxRate: 280 })).toMatchObject({ amountPkr: 28000 });
  });
  test('USD → PKR multiplies, PKR → USD divides — the rate is always PKR per USD', () => {
    expect(c({ fromCurrency: 'USD', toCurrency: 'PKR', amount: 10000, fxRate: 280 })).toMatchObject({ toAmount: 2800000, amountPkr: 2800000, fxUnbooked: true, foreign: 'USD' });
    expect(c({ fromCurrency: 'PKR', toCurrency: 'USD', amount: 2800000, fxRate: 280 })).toMatchObject({ toAmount: 10000, amountPkr: 2800000, fxUnbooked: true });
  });
  test('a rate is required across currencies; two foreign currencies are refused', () => {
    expect(() => c({ fromCurrency: 'USD', toCurrency: 'PKR', amount: 1 })).toThrow(/exchange rate is required/);
    expect(() => c({ fromCurrency: 'USD', toCurrency: 'EUR', amount: 1, fxRate: 1.1 })).toThrow(/two foreign currencies/);
    expect(() => c({ fromCurrency: 'PKR', toCurrency: 'PKR', amount: 0 })).toThrow(/greater than zero/);
    expect(() => c({ fromCurrency: 'USD', toCurrency: 'PKR', amount: 1, fxRate: -2 })).toThrow(/greater than zero/);
  });
  test('a typed converted amount must agree with amount × rate within 0.01 + 1 ppm', () => {
    // A back-computed 6-dp rate: 2,801,234.56 / 10,000 = 280.123456
    expect(c({ fromCurrency: 'USD', toCurrency: 'PKR', amount: 10000, fxRate: 280.123456, toAmount: 2801234.56 }).toAmount).toBe(2801234.56);
    expect(() => c({ fromCurrency: 'USD', toCurrency: 'PKR', amount: 10000, fxRate: 280, toAmount: 2800010 })).toThrow(/does not match/);
    expect(ft.fxTolerance(2800000)).toBeCloseTo(2.81, 5);
  });
});

describe('2. the service on an in-memory knex', () => {
  test('internal PKR transfer: both balances move, two linked rows, completed, no journal, no payment', async () => {
    seed();
    const t = await create({ from_account_id: 1, to_account_id: 2, amount: 500000 });
    expect(t).toMatchObject({ direction: 'internal', status: 'completed', from_entity: 'general', to_entity: 'general', fx_unbooked: false });
    expect(balances()).toMatchObject({ 1: 500000, 2: 500000 });
    expect(db.tables.bank_transactions.map((b) => [b.bank_account_id, b.type, b.amount, b.category, b.fund_transfer_id, b.reference]))
      .toEqual([[1, 'debit', 500000, 'Contra Transfer', t.id, t.transfer_no], [2, 'credit', 500000, 'Contra Transfer', t.id, t.transfer_no]]);
    expect(db.tables.journal_entries).toHaveLength(0);
    expect(db.tables.payments).toHaveLength(0);
  });

  test('USD → PKR with USD bank charges: native moves, fx_unbooked, fee journal at the transfer rate', async () => {
    seed();
    const t = await create({ from_account_id: 3, to_account_id: 1, amount: 1000, currency: 'USD', fx_rate: 280, bank_charges: 10 });
    expect(t).toMatchObject({ currency: 'USD', to_currency: 'PKR', to_amount: 280000, fx_unbooked: true, bank_charges: 10 });
    expect(t.rate_basis).toMatch(/^USD→PKR @ 280 on \d{4}-\d{2}-\d{2} \(manual\)$/);
    expect(balances()).toMatchObject({ 3: 18990, 1: 1280000 });
    const fee = db.tables.bank_transactions.find((b) => b.category === 'Bank Charges');
    expect(fee).toMatchObject({ bank_account_id: 3, type: 'debit', amount: 10, currency: 'USD', fund_transfer_id: t.id });
    expect(db.tables.journal_entries).toHaveLength(1);
    expect(db.tables.journal_entries[0]).toMatchObject({ ref_type: 'Fund Transfer', ref_no: t.transfer_no, status: 'Posted', orig_currency: 'USD', orig_fx_rate: 280 });
    expect(db.tables.journal_lines.map((l) => [l.account_id, l.debit, l.credit])).toEqual([[620, 2800, 0], [100, 0, 2800]]);
  });

  test('bad requests throw before anything is written', async () => {
    seed();
    const before = JSON.stringify(db.tables);
    const bad = [
      [{ from_account_id: 1, to_account_id: 1, amount: 5 }, 400, /different accounts/],
      [{ from_account_id: 1, to_account_id: 2, amount: 0 }, 400, /greater than zero/],
      [{ from_account_id: 1, to_account_id: 2, amount: 5, reference: ' ' }, 400, /Reference/],
      [{ from_account_id: 1, to_account_id: 2, amount: 5, currency: 'USD' }, 400, /holds PKR/],
      [{ from_account_id: 3, to_account_id: 1, amount: 5, to_currency: 'USD' }, 400, /holds PKR/],
      [{ from_account_id: 3, to_account_id: 1, amount: 5 }, 400, /exchange rate is required/],
      [{ from_account_id: 2, to_account_id: 1, amount: 5 }, 409, /Insufficient balance/],
      [{ from_account_id: 1, to_account_id: 2, amount: 999999, bank_charges: 2 }, 409, /amount \+ bank charges/],
    ];
    for (const [body, status, msg] of bad) {
      const err = await create(body).catch((e) => e);
      expect([body, err.statusCode]).toEqual([body, status]);
      expect(err.message).toMatch(msg);
    }
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  test('a repeated client_ref is a 409 carrying the existing transfer', async () => {
    seed();
    const t = await create({ from_account_id: 1, to_account_id: 2, amount: 10, client_ref: '11111111-1111-4111-8111-111111111111' });
    const err = await create({ from_account_id: 1, to_account_id: 2, amount: 10, client_ref: '11111111-1111-4111-8111-111111111111' }).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.existing.id).toBe(t.id);
    expect(db.tables.fund_transfers).toHaveLength(1);
  });

  test('a mill-only payer may only use mill accounts — on both sides', async () => {
    seed();
    const e1 = await create({ from_account_id: 4, to_account_id: 2, amount: 1 }, { millOnly: true }).catch((e) => e);
    expect(e1.statusCode).toBe(403);
    const e2 = await create({ from_account_id: 1, to_account_id: 2, amount: 1 }, { millOnly: true }).catch((e) => e);
    expect(e2.statusCode).toBe(403);
    const ok = await create({ from_account_id: 4, to_account_id: 5, amount: 1000 }, { millOnly: true });
    expect(ok).toMatchObject({ direction: 'internal', from_entity: 'mill', to_entity: 'mill' });
  });

  test('Head Office → Mill becomes a pending ho_to_mill transfer with its 1000/1130 journal', async () => {
    seed();
    const t = await create({ from_account_id: 1, to_account_id: 4, amount: 300 });
    expect(t).toMatchObject({ direction: 'ho_to_mill', status: 'pending' });
    expect(balances()).toMatchObject({ 1: 999700, 4: 5000 });
    expect(db.tables.journal_entries.map((j) => j.entity)).toEqual(['general']);
  });

  test('reverse undoes the charges and the destination by its own amount', async () => {
    seed();
    const t = await create({ from_account_id: 3, to_account_id: 1, amount: 100, currency: 'USD', fx_rate: 280, bank_charges: 1 });
    const out = await ft.reverseInTrx(db, t.id, 9, { reason: 'wrong' });
    expect(out.transfer).toMatchObject({ status: 'reversed', reversed_by: 9, reversal_reason: 'wrong', updated_by: 9 });
    expect(balances()).toMatchObject({ 3: 20000, 1: 1000000 });
    const rev = db.tables.bank_transactions.filter((b) => /Reversal/.test(b.category));
    expect(rev.map((b) => [b.bank_account_id, b.type, b.amount, b.currency, b.category])).toEqual([
      [3, 'credit', 100, 'USD', 'Contra Transfer Reversal'],
      [3, 'credit', 1, 'USD', 'Bank Charges Reversal'],
      [1, 'debit', 28000, 'PKR', 'Contra Transfer Reversal'],
    ]);
    expect(db.tables.journal_entries.map((j) => [j.ref_type, j.status])).toEqual([['Fund Transfer', 'Posted'], ['Fund Transfer Reversal', 'Posted']]);
    const err = await ft.reverseInTrx(db, t.id, 9, {}).catch((e) => e);
    expect(err.statusCode).toBe(409);
  });
});

describe('3. Joi schemas', () => {
  const run = (schema, body) => schema.validate(body, { abortEarly: false, stripUnknown: true });
  const READS = ['from_account_id', 'to_account_id', 'amount', 'currency', 'to_amount', 'to_currency', 'fx_rate',
    'rate_date', 'bank_charges', 'transfer_date', 'method', 'reference', 'notes', 'attachment_url', 'attachment_name', 'client_ref'];
  const full = {
    from_account_id: 1, to_account_id: 2, amount: 10, currency: 'USD', to_amount: 2800, to_currency: 'PKR', fx_rate: 280,
    rate_date: '2026-10-08', bank_charges: 1, transfer_date: '2026-10-08', method: 'bank_transfer', reference: 'TT-1',
    notes: 'n', attachment_url: 'a.pdf', attachment_name: 'a.pdf', client_ref: '11111111-1111-4111-8111-111111111111',
  };
  test('every field the service reads survives validate()', () => {
    const { error, value } = run(schemas.createContraTransfer, full);
    expect(error).toBeUndefined();
    expect(READS.filter((k) => !(k in value))).toEqual([]);
    expect(value.transfer_date).toBe('2026-10-08'); // kept as a string
  });
  test('reference is required; edit and reverse need a reason', () => {
    expect(run(schemas.createContraTransfer, { ...full, reference: '' }).error).toBeTruthy();
    expect(run(schemas.replaceContraTransfer, full).error).toBeTruthy();
    expect(run(schemas.replaceContraTransfer, { ...full, reason: 'typo' }).value.reason).toBe('typo');
    expect(run(schemas.reverseFundTransfer, {}).error).toBeTruthy();
    expect(run(schemas.reverseFundTransfer, { reason: '  ' }).error).toBeTruthy();
  });
});

describe('4. route guards', () => {
  const router = require('../modules/finance/finance.routes');
  const layer = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  test('every contra route exists', () => {
    for (const [m, p] of [['post', '/contra-transfers'], ['get', '/contra-transfers/rate'], ['get', '/fund-transfers/:id'],
      ['post', '/fund-transfers/:id/replace'], ['post', '/fund-transfers/:id/reverse'], ['post', '/fund-transfers/attachment']]) {
      expect([m, p, !!layer(m, p)]).toEqual([m, p, true]);
    }
  });
  test('edit and reverse are Owner / Super Admin', async () => {
    db.tables.users = [{ id: 1, role_name: 'Finance Manager' }, { id: 2, role_name: 'Owner' }, { id: 3, role_name: 'Super Admin' }];
    for (const p of ['/fund-transfers/:id/replace', '/fund-transfers/:id/reverse']) {
      const guard = layer('post', p).route.stack[0].handle;
      for (const [uid, ok] of [[1, false], [2, true], [3, true]]) {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
        const next = jest.fn();
        await guard({ params: { id: '9' }, user: { id: uid } }, res, next);
        expect([p, uid, next.mock.calls.length === 1]).toEqual([p, uid, ok]);
      }
    }
  });
});

describe('5. migration 319', () => {
  const mig = require('../../migrations/20261008_319_contra_transfers');
  test("the direction CHECK admits exactly the three values the code writes", () => {
    expect(mig.DIRECTIONS).toEqual(['ho_to_mill', 'mill_to_ho', 'internal']);
  });
});
