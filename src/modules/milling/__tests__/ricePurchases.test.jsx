import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseRow } from '../pages/RicePurchasesLedger';
import { purchaseFigures, purchasesCsv } from '../ricePurchases';

// P3-14: the ledger shows what the server computed — KG, Rs/kg and
// value = kg × Rs/kg — and the CSV carries the same figures.
const row = {
  id: 1, arrival_date: '2026-10-01', vehicle_no: 'LES-1234', driver_name: 'Ali',
  supplier_name: 'ZZ Supplier', product_name: 'Super Basmati', batch_id: 7, batch_no: 'M-007',
  lot_id: 9, lot_no: 'SB-001', weight_kg: 21825, total_bags: 873,
  price_per_kg: 85.5, value_pkr: 1866037.5,
  quality_json: { moisture: 12.5, broken: 4 }, notes: 'ok',
};

const render = (r) => renderToStaticMarkup(
  <MemoryRouter><table><tbody><PurchaseRow r={r} /></tbody></table></MemoryRouter>,
);

describe('Rice Purchases row', () => {
  it('shows weight in KG, price per KG and the server value', () => {
    const html = render(row);
    expect(html).toContain('21,825 kg');
    expect(html).toContain('Rs 85.50');
    expect(html).toContain('Rs 1,866,037.50');
    expect(html).toContain('data-label="Weight (KG)"');
    expect(html).toContain('data-label="Price/KG"');
    expect(html).not.toContain('Price/MT');
  });

  it('a lot-first truck shows its lot variety when there is no product name', () => {
    const html = render({ ...row, product_name: null, product_code: null, variety: '1121 Sella' });
    expect(html).toContain('1121 Sella');
  });

  it('an unpriced truck shows a dash, not 0', () => {
    const html = render({ ...row, price_per_kg: null, value_pkr: null });
    expect(html).toContain('21,825 kg');
    expect((html.match(/>—</g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Rice Purchases CSV', () => {
  it('matches the screen: KG weight, Rs/kg, value', () => {
    const csv = purchasesCsv([row]);
    const [header, line] = csv.split('\n');
    expect(header).toContain('Weight (KG)');
    expect(header).toContain('Price/KG');
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    expect(cells[7]).toBe('21825.00');
    expect(cells[9]).toBe('85.5');
    expect(cells[10]).toBe('1866037.50');
    const f = purchaseFigures(row);
    expect(f.valuePkr).toBeCloseTo(f.weightKg * f.pricePerKg, 2);
  });
});
