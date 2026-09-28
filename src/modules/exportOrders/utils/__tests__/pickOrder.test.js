import { describe, it, expect } from 'vitest';
import { togglePick, movePick, inReferenceOrder, positionOf } from '../pickOrder';

// The order this list is in becomes the page order of the downloaded PDF.
const REF = ['phyto', 'blFinal', 'invoice', 'packingList', 'coo'];

describe('togglePick', () => {
  it('adds in the reference order, not the order boxes were ticked', () => {
    let p = [];
    p = togglePick(p, 'coo', { reference: REF });
    p = togglePick(p, 'invoice', { reference: REF });
    p = togglePick(p, 'phyto', { reference: REF });
    expect(p).toEqual(['phyto', 'invoice', 'coo']);
  });

  it('removes without disturbing the rest', () => {
    expect(togglePick(['phyto', 'invoice', 'coo'], 'invoice', { reference: REF })).toEqual(['phyto', 'coo']);
  });

  it('appends to the end once the operator has sorted by hand', () => {
    // Re-sorting here would throw away the arrangement they just made.
    expect(togglePick(['coo', 'phyto'], 'invoice', { reference: REF, handSorted: true }))
      .toEqual(['coo', 'phyto', 'invoice']);
  });

  it('keeps a key that is not in the reference list, at the end', () => {
    expect(togglePick(['invoice'], 'custom', { reference: REF })).toEqual(['invoice', 'custom']);
  });

  it('is a no-op on a double add', () => {
    const once = togglePick([], 'coo', { reference: REF });
    expect(togglePick(togglePick(once, 'coo', { reference: REF }), 'coo', { reference: REF })).toEqual(once);
  });
});

describe('movePick', () => {
  const p = ['invoice', 'packingList', 'coo'];

  it('moves one place earlier', () => {
    expect(movePick(p, 'coo', -1)).toEqual(['invoice', 'coo', 'packingList']);
  });

  it('moves one place later', () => {
    expect(movePick(p, 'invoice', 1)).toEqual(['packingList', 'invoice', 'coo']);
  });

  it('refuses to move the first one earlier or the last one later', () => {
    expect(movePick(p, 'invoice', -1)).toBe(p);
    expect(movePick(p, 'coo', 1)).toBe(p);
  });

  it('ignores a key that is not selected', () => {
    expect(movePick(p, 'phyto', -1)).toBe(p);
  });

  it('never loses or duplicates a document', () => {
    let cur = ['a', 'b', 'c', 'd'];
    for (const [k, d] of [['c', -1], ['a', 1], ['d', -1], ['b', -1], ['a', -1]]) cur = movePick(cur, k, d);
    expect([...cur].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(cur).toHaveLength(4);
  });

  it('two moves in opposite directions return the original', () => {
    expect(movePick(movePick(p, 'invoice', 1), 'invoice', -1)).toEqual(p);
  });
});

describe('inReferenceOrder — the "Default order" button', () => {
  it('restores the tab order from any arrangement', () => {
    expect(inReferenceOrder(['coo', 'phyto', 'invoice'], REF)).toEqual(['phyto', 'invoice', 'coo']);
  });

  it('keeps unknown keys, after the known ones', () => {
    expect(inReferenceOrder(['custom', 'coo', 'phyto'], REF)).toEqual(['phyto', 'coo', 'custom']);
  });
});

describe('positionOf', () => {
  it('is the 1-based page position shown on the row', () => {
    expect(positionOf(['invoice', 'coo'], 'invoice')).toBe(1);
    expect(positionOf(['invoice', 'coo'], 'coo')).toBe(2);
  });
});
