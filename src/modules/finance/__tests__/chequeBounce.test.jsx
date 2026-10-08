import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { bounceFormError, bouncePayload, canBounceItem } from '../utils/chequeBounce';
import { statusStyle } from '../../../shared/utils/statusStyle';
import BounceChequeDialog from '../components/BounceChequeDialog';

/**
 * B1 — marking an uncleared cheque bounced: the form rules, the request body
 * POST /payments/:id/bounce reads, the dialog, and the red Bounced status.
 */
describe('bounce form', () => {
  it('needs a reason; a charge needs an account and cannot be negative', () => {
    expect(bounceFormError({ reason: '  ' })).toMatch(/reason/);
    expect(bounceFormError({ reason: 'NSF' })).toBeNull();
    expect(bounceFormError({ reason: 'NSF', charge: '-1', accountId: '3' })).toMatch(/0 or more/);
    expect(bounceFormError({ reason: 'NSF', charge: '250', accountId: '' })).toMatch(/account/);
    expect(bounceFormError({ reason: 'NSF', charge: '250', accountId: '3' })).toBeNull();
  });

  it('sends the charge fields only when there is a charge', () => {
    expect(bouncePayload({ reason: ' NSF ', charge: '', chargeDate: '2026-10-09', accountId: '3' })).toEqual({ reason: 'NSF' });
    expect(bouncePayload({ reason: 'NSF', charge: '250.456', chargeDate: '2026-10-09', accountId: '3' }))
      .toEqual({ reason: 'NSF', bank_charge: 250.46, charge_date: '2026-10-09', charge_account_id: 3 });
  });

  it('only a cheque row with a payment can bounce', () => {
    expect(canBounceItem({ kind: 'cheque', paymentId: 5 })).toBe(true);
    expect(canBounceItem({ kind: 'credit', paymentId: null })).toBe(false);
    expect(canBounceItem({ kind: 'cheque' })).toBe(false);
  });

  it('Bounced is red', () => {
    expect(statusStyle('Bounced')).toMatch(/bg-red-50 text-red-700/);
    expect(statusStyle('bounced')).toMatch(/text-red-700/);
  });
});

describe('<BounceChequeDialog />', () => {
  const item = { paymentId: 5, paymentNo: 'PAY-005', reference: 'CHQ-77', amount: 40000, currency: 'PKR', bankAccountId: 3, party: 'Rice Co', partyType: 'supplier' };
  const accounts = [{ id: 3, name: 'Meezan', currency: 'PKR', type: 'bank' }];

  it('names the cheque, its amount and that the bill reopens; reason is required', () => {
    const html = renderToStaticMarkup(<BounceChequeDialog item={item} accounts={accounts} onCancel={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('Mark cheque CHQ-77 (PAY-005) bounced?');
    expect(html).toMatch(/Rs\s?40,000\.00/);
    expect(html).toContain('the bill to Rice Co reopens');
    expect(html).toContain('Reason *');
    expect(html).toContain('data-action="confirm-bounce"');
    // The account picker appears only once a charge is entered.
    expect(html).not.toContain('Account the bank charged');
  });

  it('renders nothing without a cheque', () => {
    expect(renderToStaticMarkup(<BounceChequeDialog item={null} accounts={accounts} onCancel={() => {}} onConfirm={() => {}} />)).toBe('');
  });
});
