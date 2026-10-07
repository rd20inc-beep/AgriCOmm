import { describe, it, expect } from 'vitest';
import { statusText, statusStyle } from '../../utils/statusStyle';

describe('StatusBadge words', () => {
  it('shows stored snake_case / lowercase words in Title Case', () => {
    expect(statusText('partially_paid')).toBe('Partially Paid');
    expect(statusText('prepared')).toBe('Prepared');
    expect(statusText('Ready to Ship')).toBe('Ready to Ship');
    expect(statusText('N/A')).toBe('N/A');
    expect(statusText(undefined)).toBe(undefined);
  });

  it('colours a word the same whatever its case', () => {
    expect(statusStyle('paid')).toBe(statusStyle('Paid'));
    expect(statusStyle('In stock')).toBe(statusStyle('In Stock'));
    expect(statusStyle('partially_paid')).toContain('amber');
  });

  it('gives the previously uncoloured statuses a tone', () => {
    for (const s of ['Issued', 'Sent', 'Accepted', 'Booked', 'Active', 'Pass', 'Fail', 'Milled', 'In Stock', 'Prepared', 'Accrued', 'voided']) {
      expect(statusStyle(s)).not.toBe(statusStyle('some unknown word'));
    }
  });
});
