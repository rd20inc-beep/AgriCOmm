/**
 * P4-06 — the one movement-type map every lot_transactions ledger reads. Every
 * type postMovement can write must be mapped (a missing one fell into an
 * uncounted "other" bucket and the ledger stopped footing), and the signed
 * buckets must keep  closing = opening + inward − outward + transfer − sales + other.
 */
const fs = require('fs');
const path = require('path');
const sm = require('../modules/analytics/stockMovements');
const { LOT_TRANSACTION_TYPE_MAP } = require('../modules/inventory/inventory.constants');

// The map postMovement actually uses lives in inventory.service (not exported).
function serviceTypes() {
  const src = fs.readFileSync(path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8');
  const block = src.slice(src.indexOf('const LOT_TRANSACTION_TYPE_MAP = {'));
  return [...block.slice(0, block.indexOf('};')).matchAll(/\]:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('stockMovements map', () => {
  test('every stored transaction type postMovement writes has a label and a real bucket', () => {
    const types = new Set([...serviceTypes(), ...Object.values(LOT_TRANSACTION_TYPE_MAP)]);
    expect(types.size).toBeGreaterThan(20);
    for (const t of types) {
      expect(sm.TXN_TO_MT[t]).toBeDefined();
      const mt = sm.movementTypeOf(t);
      expect(sm.LABELS[mt]).toBeDefined();
      expect(sm.bucketOf(mt)).not.toBe('other');
    }
  });

  test('reversals share their original\'s bucket', () => {
    const b = (t) => sm.bucketOf(sm.movementTypeOf(t));
    expect(b('milling_issue_reversal')).toBe(b('milling_issue'));
    expect(b('milling_receipt_reversal')).toBe(b('milling_receipt'));
    expect(b('byproduct_receipt_reversal')).toBe(b('byproduct_receipt'));
    expect(b('purchase_void_out')).toBe(b('purchase_in'));
    expect(b('return_in')).toBe(b('local_sale_out'));
    expect(sm.HOLD_TXN_TYPES.sort()).toEqual(['export_allocation', 'export_release', 'milling_hold', 'milling_release']);
  });

  test('signed totals foot to Σ quantity', () => {
    const sums = { opening: 10, inward: 1000 - 50, outward: -400 + 100, transfer: 25, sales: -200 + 50, other: 3 };
    const t = sm.signedBucketTotals(sums);
    const net = Object.values(sums).reduce((s, v) => s + v, 0);
    expect(t.opening + t.inward - t.outward + t.transfer - t.sales + t.other).toBe(net);
    expect(t).toMatchObject({ outward: 300, sales: 150 });
  });

  test('bucket CASE SQL covers the map', () => {
    const sql = sm.bucketCaseSql('t.transaction_type');
    expect(sql).toContain("WHEN 'milling_issue_reversal' THEN 'outward'");
    expect(sql).toContain("ELSE 'other'");
  });
});
