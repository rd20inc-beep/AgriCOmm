import { describe, test, expect } from 'vitest';
import { millableLots } from '../lotCategory';

const lot = (o) => ({ entity: 'mill', type: 'raw', availableQty: '1000', millingStatus: null, itemName: 'Sindbad', ...o });

describe('New Batch picker — millableLots', () => {
  test('a lot partly committed to a running batch still offers its free remainder', () => {
    const rows = millableLots([lot({ id: 1, millingStatus: 'In Milling', availableQty: '8000' })]);
    expect(rows.map((l) => l.id)).toEqual([1]);
  });

  test('no free qty, export stock and non-rice residue are left out', () => {
    const rows = millableLots([
      lot({ id: 1 }),
      lot({ id: 2, millingStatus: 'In Milling', availableQty: '0' }),
      lot({ id: 3, millingStatus: 'Consumed', availableQty: '0' }),
      lot({ id: 4, entity: 'export' }),
      lot({ id: 5, type: 'byproduct', itemName: 'Rice Bran' }),
      lot({ id: 6, type: 'packaging', itemName: 'PP Bag' }),
    ]);
    expect(rows.map((l) => l.id)).toEqual([1]);
  });

  test('empty input is safe', () => {
    expect(millableLots(undefined)).toEqual([]);
  });
});
