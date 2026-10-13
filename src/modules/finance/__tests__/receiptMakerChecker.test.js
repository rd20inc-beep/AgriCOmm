import { describe, it, expect } from 'vitest';
import { isOwnPendingReceipt, OWN_RECEIPT_NOTE } from '../utils/receiptMakerChecker';
import { buildNeedsAttention } from '../utils/needsAttention';

/**
 * Maker-checker on export receipts: the user who recorded a pending receipt is
 * not offered Confirm (the server would answer 403). Owner / Super Admin are
 * exempt — they may confirm their own.
 */
const receipt = { id: 1, orderNo: 'EX-101', receiptType: 'advance', amount: 2000, currency: 'USD', createdBy: 3, recordedByName: 'Fin One' };
const FM = (m, a) => ['finance.view', 'finance.confirm_payment'].includes(`${m}.${a}`);

describe('isOwnPendingReceipt', () => {
  it('is the recorder, by id', () => {
    expect(isOwnPendingReceipt(receipt, { id: 3, role: 'Finance Manager' })).toBe(true);
    expect(isOwnPendingReceipt(receipt, { id: '3', role: 'Finance Manager' })).toBe(true);
    expect(isOwnPendingReceipt(receipt, { id: 4, role: 'Finance Manager' })).toBe(false);
  });

  it('never for an Owner or Super Admin', () => {
    expect(isOwnPendingReceipt(receipt, { id: 3, role: 'Owner' })).toBe(false);
    expect(isOwnPendingReceipt(receipt, { id: 3, role: 'Super Admin' })).toBe(false);
  });

  it('never when the recorder is unknown', () => {
    expect(isOwnPendingReceipt({ ...receipt, createdBy: null }, { id: 3, role: 'Finance Manager' })).toBe(false);
    expect(isOwnPendingReceipt(receipt, null)).toBe(false);
  });
});

describe('Needs Attention — a receipt you recorded', () => {
  const item = (viewer) => buildNeedsAttention({ pendingReceipts: [receipt], viewer }, FM).items.find((i) => i.key === 'receipt-1');

  it('shows without a Confirm action, saying who confirms it', () => {
    const own = item({ id: 3, role: 'Finance Manager' });
    expect(own.action).toBeNull();
    expect(own.sub).toBe(OWN_RECEIPT_NOTE);
  });

  it('keeps Confirm for another Finance user and for the Owner', () => {
    expect(item({ id: 4, role: 'Finance Manager' }).action).toMatchObject({ type: 'confirmReceipt' });
    expect(item({ id: 3, role: 'Owner' }).action).toMatchObject({ type: 'confirmReceipt' });
  });
});
