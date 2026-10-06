import { describe, it, expect } from 'vitest';
import { formatTick, formatTooltip } from '../chartFormat';

describe('finance chart formatting', () => {
  it('abbreviates only axis ticks', () => {
    expect(formatTick(2_500_000)).toBe('2.5M');
    expect(formatTick(12_400)).toBe('12K');
    expect(formatTick(950)).toBe('950');
    expect(formatTick(-3_000_000)).toBe('-3.0M');
  });

  it('shows exact figures in tooltips with the currency prefix', () => {
    expect(formatTooltip(12345678.5, 'Rs ')).toBe('Rs 12,345,678.5');
    expect(formatTooltip(1234, '$')).toBe('$1,234');
    expect(formatTooltip(-1234, 'Rs ')).toBe('-Rs 1,234');
    expect(formatTooltip(null, '$')).toBe('—');
  });
});
