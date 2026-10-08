import { describe, it, expect } from 'vitest';
import { isNetLowered, rowsMissingNetReason, netOverrideReasonFor } from '../payrollNet';

// B3: paying less than the computed net needs a reason; within Rs 1 is the net.
describe('payroll "Paying now"', () => {
  it('a reduction of more than Rs 1 is a lowered net; the net (or within Rs 1) is not', () => {
    expect(isNetLowered(25000, 30000)).toBe(true);
    expect(isNetLowered(29998.9, 30000)).toBe(true);
    expect(isNetLowered(29999, 30000)).toBe(false);
    expect(isNetLowered(30000, 30000.4)).toBe(false);
    expect(isNetLowered(30000, 30000)).toBe(false);
  });

  it('lists the rows still missing a reason', () => {
    const netOf = (r) => r.computed;
    const rows = [
      { id: 1, net: 20000, computed: 30000, netReason: '' },
      { id: 2, net: 20000, computed: 30000, netReason: 'Half paid in cash' },
      { id: 3, net: 30000, computed: 30000, netReason: '' },
      { id: 4, net: 10, computed: 30000, netReason: '   ' },
    ];
    expect(rowsMissingNetReason(rows, netOf).map((r) => r.id)).toEqual([1, 4]);
  });

  it('sends the reason only when the amount was lowered', () => {
    expect(netOverrideReasonFor({ net: 20000, netReason: ' Balance next month ' }, 30000)).toBe('Balance next month');
    expect(netOverrideReasonFor({ net: 30000, netReason: 'stale' }, 30000)).toBeNull();
    expect(netOverrideReasonFor({ net: 20000, netReason: '' }, 30000)).toBeNull();
  });
});
