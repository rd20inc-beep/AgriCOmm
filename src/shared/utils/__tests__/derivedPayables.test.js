import { describe, it, expect } from 'vitest';
import { isDerivedPayable, derivedPayableHint } from '../derivedPayables';

describe('derived payables (MC- / EC- / ME-) are not payable from Money Out', () => {
  it('flags the rows the server marks derived, and the lettered ids', () => {
    expect(isDerivedPayable({ id: 'MC-12', derived: true })).toBe(true);
    expect(isDerivedPayable({ id: 'EC-3' })).toBe(true);
    expect(isDerivedPayable({ id: 'ME-7' })).toBe(true);
    expect(isDerivedPayable({ payNo: 'MC-9' })).toBe(true);
  });

  it('leaves a real payable payable', () => {
    expect(isDerivedPayable({ id: 41, payNo: 'PAY-041' })).toBe(false);
    expect(isDerivedPayable({ id: '41' })).toBe(false);
    expect(isDerivedPayable({ id: 70, payNo: 'PAY-EOC0001' })).toBe(false);
    expect(isDerivedPayable(null)).toBe(false);
  });

  it('says where a derived row is settled — the server hint first', () => {
    expect(derivedPayableHint({ id: 'EC-3', settleHint: 'From the server' })).toBe('From the server');
    expect(derivedPayableHint({ id: 'EC-3' })).toMatch(/Purchases/);
    expect(derivedPayableHint({ id: 'MC-3' })).toMatch(/batch cost sheet/);
    expect(derivedPayableHint({ id: 'ME-3' })).toMatch(/expense/);
  });
});
