import { describe, it, expect } from 'vitest';
import { isStoredPayable, isSupplierDebt, payablesForRow, UNASSIGNED } from '../payableBuckets';

// P2-21: the Mill Finance supplier directory counts only what a supplier can be
// paid for. Paying every stored bill must take a supplier's outstanding to zero.
describe('isSupplierDebt', () => {
  it('a stored bill is a debt', () => {
    expect(isSupplierDebt({ id: 42, source: undefined })).toBe(true);
  });

  it("a batch's raw rice before the yield is the supplier's debt", () => {
    expect(isSupplierDebt({ id: 'MC-7', source: 'milling_costs', category: 'Raw Rice' })).toBe(true);
  });

  it.each([
    ['Electricity'], ['Labor'], ['Packaging'], ['Transport'], ['Diesel'],
  ])('a derived %s cost-sheet line is NOT a debt to the batch supplier', (category) => {
    expect(isSupplierDebt({ id: 'MC-9', source: 'milling_costs', category })).toBe(false);
  });

  it('derived export costs and legacy mill expenses are not mill supplier debt', () => {
    expect(isSupplierDebt({ id: 'EC-3', source: 'export_order_costs', category: 'Freight' })).toBe(false);
    expect(isSupplierDebt({ id: 'ME-1', source: 'mill_expenses', category: 'Overhead' })).toBe(false);
  });

  it('after every stored bill is paid, nothing payable is left for the supplier', () => {
    const rows = [
      { id: 1, supplierId: 5, outstanding: 0 },
      { id: 'MC-2', source: 'milling_costs', category: 'Electricity', supplierId: 5, outstanding: 900 },
    ];
    const owed = rows.filter(isSupplierDebt).reduce((s, p) => s + p.outstanding, 0);
    expect(owed).toBe(0);
    expect(payablesForRow(rows, 5).map((p) => p.id)).toEqual([1]);
    expect(isStoredPayable(rows[1])).toBe(false);
    expect(payablesForRow(rows, UNASSIGNED)).toEqual([]);
  });
});
