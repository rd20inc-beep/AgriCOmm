/**
 * P2-20 / owner decision D-10: no literal 280 fallback anywhere; one resolver
 * per currency; postings refused without a rate.
 *
 *   - CI grep: no `|| 280`, `?? 280`, `: 280` used as a rate, or a RATE
 *     constant of 280 in backend/src or the frontend src (tests excluded).
 *   - The resolver answers per currency, flags an estimate as stale, and
 *     never hands one currency another's rate.
 *   - requireRate refuses a posting with no rate (422 FX_RATE_MISSING).
 */
const fs = require('fs');
const path = require('path');
const { fakeKnex } = require('./helpers/fakeKnex');

jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
const db = require('../config/database');
const fx = require('../modules/finance/fxRate.service');

const ROOTS = [path.join(__dirname, '..'), path.join(__dirname, '..', '..', '..', 'src')];
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['__tests__', 'node_modules'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const FALLBACKS = [
  /(\|\||\?\?)\s*280\b/, // x || 280, x ?? 280
  /\?\s*[^:;]+:\s*280\s*[;),]/, // cond ? rate : 280
  /\b[A-Za-z_]*(RATE|Rate|rate)[A-Za-z_]*\s*[:=]\s*280\b/, // FALLBACK_RATE = 280, pkr_rate: 280, rate: 280
];

describe('no hard-coded 280 FX fallback (CI grep)', () => {
  test('backend/src and src are clean', () => {
    const hits = [];
    for (const root of ROOTS) {
      for (const f of walk(root)) {
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (FALLBACKS.some((re) => re.test(code))) hits.push(`${path.relative(path.join(__dirname, '..', '..', '..'), f)}:${i + 1}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('fx resolver (per currency, D-10)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const old = '2020-01-01';
  beforeEach(() => {
    db.tables.fx_rates = [
      { id: 1, from_currency: 'USD', to_currency: 'PKR', rate: 281, effective_date: today, is_active: true },
      { id: 2, from_currency: 'EUR', to_currency: 'PKR', rate: 305, effective_date: old, is_active: true },
      { id: 3, from_currency: 'GBP', to_currency: 'PKR', rate: 0, effective_date: today, is_active: true },
    ];
  });

  test('each currency gets its own rate, flagged as an estimate', async () => {
    expect(await fx.getLatestRate('USD')).toMatchObject({ rate: 281, estimated: true, stale: false, missing: false });
    expect(await fx.getLatestRate('eur')).toMatchObject({ currency: 'EUR', rate: 305, stale: true });
    expect(await fx.getLatestRate('PKR')).toMatchObject({ rate: 1 });
  });

  test('a currency with no (or a zero) rate gets none — never the USD rate or 280', async () => {
    expect(await fx.getLatestRate('GBP')).toMatchObject({ rate: null, missing: true });
    expect(await fx.getLatestRate('AED')).toMatchObject({ rate: null, missing: true });
    expect(await fx.getRateForDate('EUR', '2019-12-31')).toMatchObject({ rate: null, missing: true });
    expect(await fx.getRateForDate('EUR', today)).toMatchObject({ rate: 305 });
  });

  test('requireRate: postings are refused without a rate', async () => {
    expect(await fx.requireRate('USD', today)).toBe(281);
    expect(await fx.requireRate('PKR', today)).toBe(1);
    await expect(fx.requireRate('AED', today, { what: 'This payment' })).rejects.toMatchObject({ statusCode: 422, code: 'FX_RATE_MISSING' });
    await expect(fx.requireRate('EUR', '2019-01-01')).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
  });

  test('lockRateForOrder: manual wins, else the currency\'s own rate, else refused', async () => {
    expect(await fx.lockRateForOrder('EUR', today, 300)).toMatchObject({ rate: 300, source: 'manual' });
    expect(await fx.lockRateForOrder('EUR', today)).toMatchObject({ rate: 305, source: 'fx_rates' });
    await expect(fx.lockRateForOrder('AED', today)).rejects.toMatchObject({ statusCode: 400, code: 'FX_RATE_MISSING' });
  });

  test('addRate mirrors system_settings.pkr_rate for USD only', async () => {
    db.tables.system_settings = [{ key: 'pkr_rate', value: '281' }];
    await fx.addRate({ currencyCode: 'EUR', rate: 310, effectiveDate: today });
    expect(db.tables.system_settings[0].value).toBe('281');
    await expect(fx.addRate({ currencyCode: 'PKR', rate: 1, effectiveDate: today })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('shape() is pure and dates the staleness', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    expect(fx.shape('USD', { rate: '280', effective_date: '2026-10-19' }, now)).toMatchObject({ stale: false, ageDays: 1 });
    expect(fx.shape('USD', { rate: '280', effective_date: '2026-10-01' }, now)).toMatchObject({ stale: true });
    expect(fakeKnex).toBeDefined();
  });
});

describe('the payment engine refuses a foreign payment with no rate (D-10)', () => {
  test('EUR payable, no EUR rate on file → 422, nothing written', async () => {
    db.tables.fx_rates = [];
    db.tables.payables = [{ id: 5, original_amount: 100, paid_amount: 0, outstanding: 100, currency: 'EUR', entity: 'general' }];
    db.tables.bank_accounts = [{ id: 3, name: 'ZZ PKR', currency: 'PKR', current_balance: 1000 }];
    db.tables.payments = [];
    db.tables.bank_transactions = [];
    const { recordMoneyMovement } = require('../modules/finance/paymentEngine');
    await expect(recordMoneyMovement(db, {
      type: 'payment', payable: db.tables.payables[0], amount: 100, currency: 'EUR',
      method: 'bank_transfer', bankAccountId: 3, paymentDate: '2026-10-01', paymentNo: 'PAY-T1',
    })).rejects.toMatchObject({ statusCode: 422, code: 'FX_RATE_MISSING' });
    expect(db.tables.payments).toHaveLength(0);
    expect(db.tables.bank_transactions).toHaveLength(0);
    expect(db.tables.bank_accounts[0].current_balance).toBe(1000);
  });
});
