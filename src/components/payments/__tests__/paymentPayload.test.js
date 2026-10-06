import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM: HERE does not exist, and these tests read files relative to themselves.
const HERE = path.dirname(fileURLToPath(import.meta.url));
import {
  PAYMENT_METHODS, blankPaymentForm, netCash, validatePayment, paymentPayload, purchasePayPayload, money,
  pickAccountForMethod, isUnclearedCheque,
} from '../paymentPayload';

/**
 * The payload is the part that breaks silently. validate() runs with
 * stripUnknown, so a key named wrongly is deleted before the controller sees it:
 * no error, no failing test, and the field simply does nothing. These assert the
 * exact key set against the Joi schema in the repo, so renaming a field on the
 * server fails here rather than in production.
 */

const SCHEMAS = fs.readFileSync(
  path.resolve(HERE, '../../../../backend/src/middleware/schemas.js'), 'utf8',
);

/** The keys `recordPayment` declares, read out of the schema itself. */
function recordPaymentKeys() {
  const start = SCHEMAS.indexOf('const recordPayment = Joi.object({');
  expect(start).toBeGreaterThan(-1);
  const body = SCHEMAS.slice(start, SCHEMAS.indexOf('});', start));
  return new Set([...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
}

const form = () => ({
  ...blankPaymentForm({ amount: '1000', method: 'cheque' }),
  bankAccountId: '7', reference: 'CHQ-0042', dueDate: '2026-11-01', notes: 'October freight',
  whtRate: '2', whtAmount: '20', discountAmount: '30',
});

describe('paymentPayload', () => {
  it('sends only keys the recordPayment schema declares', () => {
    const declared = recordPaymentKeys();
    const sent = Object.keys(paymentPayload(form(), { payableId: 12 }));
    const stripped = sent.filter((k) => !declared.has(k));
    expect(stripped).toEqual([]);
  });

  it('carries every field the form collected', () => {
    const body = paymentPayload(form(), { payableId: 12, currency: 'PKR' });
    expect(body).toMatchObject({
      type: 'payment',
      amount: 1000,
      currency: 'PKR',
      payment_method: 'cheque',
      bank_account_id: 7,          // a number, not the select's string
      bank_reference: 'CHQ-0042',
      due_date: '2026-11-01',
      linked_payable_id: 12,
      notes: 'October freight',
      wht_amount: 20,
      wht_rate: 2,
      discount_amount: 30,
    });
  });

  it('links a receivable for a receipt, and never both', () => {
    const r = paymentPayload(form(), { type: 'receipt', receivableId: 5 });
    expect(r.type).toBe('receipt');
    expect(r.linked_receivable_id).toBe(5);
    expect('linked_payable_id' in r).toBe(false);
  });

  it('sends null rather than an empty string for the optional dates and refs', () => {
    // Joi accepts null for these but not ''. An empty cheque date sent as ''
    // fails validation on a payment that is otherwise fine.
    const body = paymentPayload(blankPaymentForm({ amount: '500' }), {});
    expect(body.due_date).toBeNull();
    expect(body.bank_reference).toBeNull();
    expect(body.attachment_url).toBeNull();
    expect(body.bank_account_id).toBeNull();
  });

  it('falls back to the caller-supplied note only when the user typed none', () => {
    expect(paymentPayload(blankPaymentForm({ amount: '1' }), { notes: 'Transport payment' }).notes)
      .toBe('Transport payment');
    expect(paymentPayload({ ...blankPaymentForm({ amount: '1' }), notes: 'mine' }, { notes: 'Transport payment' }).notes)
      .toBe('mine');
  });

  it('pays from a fixed account when the screen has one', () => {
    const body = paymentPayload({ ...form(), bankAccountId: '7' }, { bankAccountId: 99 });
    expect(body.bank_account_id).toBe(99);
  });
});

describe('netCash', () => {
  it('takes WHT and the discount off the cash, not off the amount settled', () => {
    // The vendor's claim clears at 1000; 950 leaves the bank, 20 goes to FBR and
    // 30 is discount income. Netting the payable instead leaves it short-paid.
    const f = form();
    expect(netCash(f)).toBe(950);
    expect(paymentPayload(f, {}).amount).toBe(1000);
  });

  it('never goes negative', () => {
    expect(netCash({ amount: '100', whtAmount: '200', discountAmount: '0' })).toBe(0);
  });
});

describe('validatePayment', () => {
  const ok = { ...blankPaymentForm({ amount: '500' }), bankAccountId: '3' };

  it('accepts a payment within the outstanding', () => {
    expect(validatePayment(ok, { outstanding: 500 })).toBeNull();
  });

  it('refuses a zero or missing amount', () => {
    expect(validatePayment({ ...ok, amount: '' }, {})).toBe('Enter a positive amount');
    expect(validatePayment({ ...ok, amount: '0' }, {})).toBe('Enter a positive amount');
  });

  it('refuses more than the outstanding, and names the figure', () => {
    expect(validatePayment({ ...ok, amount: '600' }, { outstanding: 500 }))
      .toBe('Amount exceeds the outstanding Rs 500.00.');
  });

  it('tolerates a cent of float slop rather than blocking a full settlement', () => {
    expect(validatePayment({ ...ok, amount: '500.005' }, { outstanding: 500 })).toBeNull();
  });

  it('does not cap when there is nothing to overpay against', () => {
    expect(validatePayment({ ...ok, amount: '999999' }, { outstanding: null })).toBeNull();
  });

  it('refuses WHT plus discount larger than the payment', () => {
    expect(validatePayment({ ...ok, whtAmount: '400', discountAmount: '200' }, {}))
      .toBe('WHT + discount cannot exceed the amount.');
  });

  it('requires an account unless the screen pays from a fixed one', () => {
    expect(validatePayment({ ...ok, bankAccountId: '' }, {})).toBe('Select a cash or bank account');
    expect(validatePayment({ ...ok, bankAccountId: '' }, { requireAccount: false })).toBeNull();
  });

  it('lets any cheque — same-day included — be recorded without an account (it is picked at clearing)', () => {
    expect(validatePayment({ ...ok, method: 'cheque', bankAccountId: '', dueDate: '' }, {})).toBeNull();
    expect(isUnclearedCheque({ method: 'cheque', dueDate: '' })).toBe(true);
    expect(isUnclearedCheque({ paymentMethod: 'cheque' })).toBe(true);
    expect(isUnclearedCheque({ method: 'bank_transfer' })).toBe(false);
  });
});

describe('purchasePayPayload', () => {
  it('uses the purchase endpoint field names, not the payment ones', () => {
    const body = purchasePayPayload(form(), { source: 'printed_bag', sourceId: 4 });
    // payment_reference here, bank_reference there — the drift that got a cheque
    // number dropped on one screen and kept on another.
    expect(body.payment_reference).toBe('CHQ-0042');
    expect('bank_reference' in body).toBe(false);
    expect(body).toMatchObject({ source: 'printed_bag', source_id: 4, amount: 1000, payment_method: 'cheque' });
  });

  it('sends the cheque clearing date, which the server uses to hold the settlement', () => {
    expect(purchasePayPayload(form(), { source: 'mill_store', sourceId: 1 }).due_date).toBe('2026-11-01');
  });

  it('sends no WHT or discount — the endpoint does not read them', () => {
    const body = purchasePayPayload(form(), { source: 'lot', sourceId: 1 });
    expect(Object.keys(body).filter((k) => /wht|discount|attachment/.test(k))).toEqual([]);
  });
});

describe('payment methods', () => {
  it('offers only values the recordPayment schema accepts', () => {
    const line = SCHEMAS.split('\n').find((l) => l.includes('payment_method: Joi.string().valid('));
    const allowed = new Set([...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const m of PAYMENT_METHODS) expect(allowed.has(m.value), m.value).toBe(true);
  });

  it('formats money the way the rest of the app does', () => {
    expect(money(1234.5)).toBe('Rs 1,234.50');
    expect(money(1234.5, 'USD')).toBe('$1,234.50');
  });
});

describe('pickAccountForMethod', () => {
  const ACCTS = [
    { id: 1, name: 'HBL', type: 'bank' },
    { id: 2, name: 'Meezan', type: 'bank', isFavorite: true },
    { id: 3, name: 'Mill Cash', type: 'cash' },
  ];
  it('drops a chosen account that does not suit the new method', () => {
    expect(pickAccountForMethod({ accounts: ACCTS, method: 'cash', current: '1' })).toBe('');
    expect(pickAccountForMethod({ accounts: ACCTS, method: 'bank_transfer', current: '1' })).toBe('1');
  });
  it('picks the only matching account', () => {
    expect(pickAccountForMethod({ accounts: ACCTS, method: 'cash', current: '' })).toBe('3');
  });
  it('preselects the starred account, never one of the wrong kind', () => {
    expect(pickAccountForMethod({ accounts: ACCTS, method: 'cheque', current: '' })).toBe('2');
    expect(pickAccountForMethod({ accounts: [...ACCTS, { id: 4, name: 'Petty', type: 'cash' }], method: 'cash', current: '' })).toBe('');
    expect(pickAccountForMethod({ accounts: [{ id: 5, type: 'cash', is_favorite: true }, ...ACCTS], method: 'online', current: '' })).toBe('2');
  });
});
