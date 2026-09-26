const { inventoryAccountForLot } = require('../modules/localSales/inventoryAccount');

describe('inventoryAccountForLot', () => {
  test('a by-product relieves 1240, not 1210', () => {
    // The live bug: LS-0001 sold a by-product lot and credited Raw Rice Stock.
    expect(inventoryAccountForLot({ type: 'byproduct', entity: 'mill' })).toBe('1240');
    expect(inventoryAccountForLot({ type: 'byproduct', entity: 'mill' })).not.toBe('1210');
  });

  test('finished splits by entity', () => {
    expect(inventoryAccountForLot({ type: 'finished', entity: 'mill' })).toBe('1220');
    expect(inventoryAccountForLot({ type: 'finished', entity: 'export' })).toBe('1230');
  });

  test('raw relieves 1210', () => {
    expect(inventoryAccountForLot({ type: 'raw', entity: 'mill' })).toBe('1210');
  });

  test('an unknown or missing type falls back to 1210 rather than throwing', () => {
    expect(inventoryAccountForLot({ type: 'something-new' })).toBe('1210');
    expect(inventoryAccountForLot({})).toBe('1210');
    expect(inventoryAccountForLot(null)).toBe('1210');
  });

  test('every lot type maps to a distinct, real account', () => {
    const map = {
      raw: inventoryAccountForLot({ type: 'raw' }),
      finishedMill: inventoryAccountForLot({ type: 'finished', entity: 'mill' }),
      finishedExport: inventoryAccountForLot({ type: 'finished', entity: 'export' }),
      byproduct: inventoryAccountForLot({ type: 'byproduct' }),
    };
    expect(map).toEqual({ raw: '1210', finishedMill: '1220', finishedExport: '1230', byproduct: '1240' });
    expect(new Set(Object.values(map)).size).toBe(4);
  });
});
