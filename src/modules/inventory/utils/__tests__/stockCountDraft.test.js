import { describe, it, expect } from 'vitest';
import { unsavedCounts, stockCountDraftName } from '../stockCountDraft';

describe('Stock Take unsaved counts (P5-07)', () => {
  const items = [
    { id: 1, counted_qty: null },
    { id: 2, counted_qty: 120 },
    { id: 3, counted_qty: 50 },
  ];

  it('keeps only counts that differ from what is saved', () => {
    expect(unsavedCounts({ 1: '40', 2: '120', 3: '55' }, items)).toEqual({ 1: '40', 3: '55' });
  });

  it('treats 120 and "120.00" as the same saved count', () => {
    expect(unsavedCounts({ 2: '120.00' }, items)).toEqual({});
  });

  it('keeps a restored draft while the count is still loading', () => {
    expect(unsavedCounts({ 1: '40' }, [])).toEqual({ 1: '40' });
  });

  it('drops drafts for lines no longer on the count', () => {
    expect(unsavedCounts({ 99: '5' }, items)).toEqual({});
  });

  it('is stored per count', () => {
    expect(stockCountDraftName(7)).not.toBe(stockCountDraftName(8));
  });
});
