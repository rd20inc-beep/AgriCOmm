import { describe, it, expect } from 'vitest';
import { paymentWord, groupPaymentWord, payableDue, localToday, defaultBankAccountId } from '../saleStatus';
import { isFavorite } from '../../../../shared/utils/favorites';

describe('paymentWord — one set of words', () => {
  it('derives Paid / Partial / Credit from the money, whatever word is stored', () => {
    expect(paymentWord({ status: 'Completed', dueAmount: 0, paidAmount: 100, paymentStatus: 'Paid' })).toBe('Paid');
    expect(paymentWord({ status: 'Completed', dueAmount: 50, paidAmount: 50 })).toBe('Partial');
    expect(paymentWord({ status: 'Completed', dueAmount: 100, paidAmount: 0, paymentStatus: 'Unpaid' })).toBe('Credit');
    expect(paymentWord({ status: 'Completed', due_amount: 100, paid_amount: 0, payment_status: 'Pending' })).toBe('Credit');
  });
  it('a cancelled sale is Rejected, not Paid', () => {
    expect(paymentWord({ status: 'Cancelled', dueAmount: 0, paidAmount: 0 })).toBe('Rejected');
  });
  it('a group ignores rejected lines', () => {
    expect(groupPaymentWord([{ status: 'Completed', dueAmount: 10, paidAmount: 5 }, { status: 'Cancelled', dueAmount: 0 }])).toBe('Partial');
    expect(groupPaymentWord([{ status: 'Cancelled' }, { status: 'Cancelled' }])).toBe('Rejected');
  });
});

describe('payableDue', () => {
  it('only counts confirmed lines', () => {
    expect(payableDue([
      { status: 'Completed', dueAmount: 100.1 }, { status: 'Completed', dueAmount: '200' },
      { status: 'Pending', dueAmount: 999 }, { status: 'Cancelled', dueAmount: 5 },
    ])).toBe(300.1);
  });
});

describe('localToday', () => {
  it('uses the local calendar, not UTC', () => {
    const d = new Date(2026, 9, 5, 0, 30); // 00:30 local on 5 Oct
    expect(localToday(d)).toBe('2026-10-05');
  });
});

describe('defaultBankAccountId', () => {
  it('prefers the starred account, else a sole account, else none', () => {
    expect(defaultBankAccountId([{ id: 1 }, { id: 2, isFavorite: true }], isFavorite)).toBe('2');
    expect(defaultBankAccountId([{ id: 3 }], isFavorite)).toBe('3');
    expect(defaultBankAccountId([{ id: 1 }, { id: 2 }], isFavorite)).toBe('');
  });
});
