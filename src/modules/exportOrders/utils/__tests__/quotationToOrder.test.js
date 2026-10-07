import { describe, it, expect } from 'vitest';
import { quotationToOrder } from '../quotationToOrder';
import { lineBagSpec } from '../orderLines';

const quote = (items) => ({
  quotation_no: 'QUO-0007', currency: 'USD', total_amount: 12000, items,
});

describe('quotationToOrder', () => {
  it('gives each line its own bag and master bag; a multi-line header borrows none', () => {
    const o = quotationToOrder(quote([
      { product_name: 'Super Basmati', qty_mt: '10', price_per_mt: '600', line_total: '6000',
        bag_size_kg: '2.00', bag_type: 'BOPP', master_bag_size_kg: '10.00', master_bag_type: 'PP Master' },
      { product_name: 'Super Basmati', qty_mt: '10', price_per_mt: '600', line_total: '6000',
        bag_size_kg: '5.00', bag_type: 'PP', master_bag_size_kg: '20.00', master_bag_type: 'Carton' },
    ]));
    expect(o.items.map((it) => [it.bagSizeKg, it.masterBagSizeKg, it.masterBagType])).toEqual([
      [2, 10, 'PP Master'],
      [5, 20, 'Carton'],
    ]);
    expect(o.bagSizeKg).toBeNull();
    expect(o.masterBagSizeKg).toBeNull();
    // What the PI renderer reads per line: each line's own spec, not line 1's.
    const specs = o.items.map((it) => lineBagSpec(it, o, { single: false }));
    expect(specs.map((s) => [s.bagSizeKg, s.masterBagSizeKg])).toEqual([[2, 10], [5, 20]]);
  });

  it('a one-line quote mirrors its line on the header', () => {
    const o = quotationToOrder(quote([
      { product_name: 'Super Basmati', qty_mt: '20', price_per_mt: '600', line_total: '12000',
        bag_size_kg: '5', bag_type: 'PP', master_bag_size_kg: '20', master_bag_type: 'Carton' },
    ]));
    expect(o).toMatchObject({ bagSizeKg: 5, bagType: 'PP', masterBagSizeKg: 20, masterBagType: 'Carton' });
  });

  it('a line with no master bag stays without one', () => {
    const o = quotationToOrder(quote([
      { product_name: 'IRRI-6', qty_mt: '20', price_per_mt: '400', bag_size_kg: '50', master_bag_size_kg: null },
    ]));
    expect(o.items[0].masterBagSizeKg).toBeNull();
    expect(o.items[0].masterBagType).toBe('');
  });
});
