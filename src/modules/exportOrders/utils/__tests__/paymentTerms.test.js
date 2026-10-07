import { describe, it, expect } from 'vitest';
import { describePaymentTerms, balanceLabel } from '../paymentTerms';

describe('describePaymentTerms', () => {
  it('PI-004: no advance + CAD — box and clause agree', () => {
    const p = describePaymentTerms({ advancePct: 0, paymentTerms: 'CAD' });
    expect(p.boxTitle).toBe('No Advance');
    expect(p.boxSubtitle).toBe('100% CAD');
    expect(p.clause).toBe('CAD.');
    expect(p.boxSubtitle).not.toMatch(/BL/);
  });

  it('an advance keeps the stated terms for the balance', () => {
    const p = describePaymentTerms({ advancePct: 20, paymentTerms: 'Balance against L/C at sight' });
    expect(p.boxTitle).toBe('20% Advance');
    expect(p.boxSubtitle).toBe('80% L/C at sight');
    expect(p.isLC).toBe(true);
    expect(p.clause).toContain('20% advance via an irrevocable Letter of Credit');
    expect(p.clause).toContain('balance 80% — Balance against L/C at sight.');
  });

  it('no terms: the old defaults, with the box matching them', () => {
    const adv = describePaymentTerms({ advancePct: 30 });
    expect(adv.boxSubtitle).toBe('70% Against BL');
    expect(adv.clause).toMatch(/scanned copy of the Bill of Lading/);
    const none = describePaymentTerms({ advancePct: 0 });
    expect(none.boxSubtitle).toBe('100% Against Docs');
    expect(none.clause).toMatch(/shipping documents at sight/);
  });

  it('terms that already state the advance are used as the whole clause', () => {
    const p = describePaymentTerms({ advancePct: 20, paymentTerms: '20% Advance / 80% Against BL' });
    expect(p.clause).toBe('20% Advance / 80% Against BL.');
    expect(p.boxSubtitle).toBe('80% Against BL');
  });

  it('full advance', () => {
    const p = describePaymentTerms({ advancePct: 100, paymentTerms: 'TT' });
    expect(p.boxTitle).toBe('100% Advance');
    expect(p.boxSubtitle).toBe('Paid in advance');
    expect(p.clause).toMatch(/^100% advance payment via TT/);
  });

  it('falls back to the customer default terms', () => {
    expect(describePaymentTerms({ advancePct: 0, customerPaymentTerms: 'D/P at sight' }).boxSubtitle).toBe('100% D/P');
  });

  it('balanceLabel shortens long free text', () => {
    expect(balanceLabel('Cash against documents through buyer bank')).toBe('CAD');
    expect(balanceLabel('Payment 30 days after arrival of goods at destination')).toBe('As per terms');
    expect(balanceLabel('Net 30')).toBe('Net 30');
  });
});
