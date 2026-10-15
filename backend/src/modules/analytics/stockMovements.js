// What a stock movement IS, for every ledger that reads lot_transactions (P4-06 /
// RPT-04, INV-27). The Inventory Movement Ledger, the Stock Ledger and Lot 360
// each kept their own copy of the type → label map, and the copies had drifted:
// the reversal types P3 added (a reversed yield or milling issue, a voided
// purchase), service dispatches and sale returns had no label and fell into an
// "other" bucket that no total counted, so the columns stopped footing to the
// balance. One map now, covering every type postMovement writes
// (inventory.service LOT_TRANSACTION_TYPE_MAP) plus the legacy spellings.
//
// The quantity on a lot_transactions row is SIGNED (postMovement writes
// direction × kg), so a balance is always Σ quantity_kg and a reversal nets its
// original by itself. Buckets are signed the same way: a milling-issue reversal
// sits in "outward" with a + quantity and so REDUCES outward; a sale return
// sits in "sales" and reduces sales; a voided purchase sits in "inward" and
// reduces inward. That keeps the identity
//
//   closing = opening + inward − outward + transfer − sales + other
//
// true for any set of rows. Holds (export reservation, milling commitment)
// move a hold column, never the quantity — they are zero-quantity rows.

// Stored transaction_type → the movement_type the ledger API speaks (and the
// FE filter dropdown uses).
const TXN_TO_MT = {
  purchase_in: 'purchase_receipt',
  purchase_void_out: 'purchase_void',
  purchase_correction_in: 'receipt_correction_in',
  purchase_correction_out: 'receipt_correction_out',
  opening_balance: 'opening_balance',
  warehouse_transfer_in: 'transfer_in',
  transfer_to_mill: 'transfer_in',
  warehouse_transfer_out: 'transfer_out',
  transfer_to_export: 'transfer_out',
  milling_issue: 'production_issue',
  milling_issue_reversal: 'production_issue_reversal',
  milling_receipt: 'production_output',
  milling_receipt_reversal: 'production_output_reversal',
  byproduct_receipt: 'byproduct_output',
  byproduct_receipt_reversal: 'byproduct_output_reversal',
  export_dispatch_out: 'export_dispatch',
  dispatch_out: 'export_dispatch', // legacy spelling
  local_sale_out: 'local_sale',
  sales_allocation: 'local_sale', // legacy spelling
  return_in: 'return',
  service_dispatch_out: 'service_dispatch',
  service_dispatch_in: 'service_dispatch_reversal',
  export_allocation: 'reservation_hold',
  export_release: 'reservation_release',
  milling_hold: 'milling_hold',
  milling_release: 'milling_release',
  stock_adjustment_plus: 'adjustment_plus',
  stock_adjustment_minus: 'adjustment_minus',
  lot_merge: 'adjustment_plus',
  lot_split: 'adjustment_minus',
  damage_out: 'damage_writeoff',
  shortage_out: 'shortage_writeoff',
};

const LABELS = {
  purchase_receipt: 'Purchase received',
  purchase_void: 'Purchase voided',
  internal_receipt: 'Internal receipt',
  receipt_correction_in: 'Received qty corrected (+)',
  receipt_correction_out: 'Received qty corrected (−)',
  opening_balance: 'Opening balance',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  production_issue: 'Issued to milling',
  production_issue_reversal: 'Milling issue reversed',
  production_output: 'Milling output',
  production_output_reversal: 'Milling output reversed',
  byproduct_output: 'By-product output',
  byproduct_output_reversal: 'By-product output reversed',
  export_dispatch: 'Export dispatch',
  local_sale: 'Local sale',
  return: 'Sale return',
  service_dispatch: 'Service dispatch (client rice)',
  service_dispatch_reversal: 'Service dispatch reversed',
  reservation_hold: 'Reserved',
  reservation_release: 'Reservation released',
  milling_hold: 'Committed to milling',
  milling_release: 'Milling commitment released',
  adjustment_plus: 'Adjustment (+)',
  adjustment_minus: 'Adjustment (−)',
  damage_writeoff: 'Damage write-off',
  shortage_writeoff: 'Shortage write-off',
};

// movement_type → Stock Ledger column. Reversals share their original's column.
const BUCKET = {
  opening_balance: 'opening',
  purchase_receipt: 'inward', purchase_void: 'inward',
  receipt_correction_in: 'inward', receipt_correction_out: 'inward',
  production_output: 'inward', production_output_reversal: 'inward',
  byproduct_output: 'inward', byproduct_output_reversal: 'inward',
  adjustment_plus: 'inward',
  production_issue: 'outward', production_issue_reversal: 'outward',
  adjustment_minus: 'outward', damage_writeoff: 'outward', shortage_writeoff: 'outward',
  transfer_in: 'transfer', transfer_out: 'transfer',
  local_sale: 'sales', export_dispatch: 'sales', return: 'sales',
  service_dispatch: 'sales', service_dispatch_reversal: 'sales',
  reservation_hold: 'hold', reservation_release: 'hold', milling_hold: 'hold', milling_release: 'hold',
};

// Zero-quantity hold rows (stored types).
const HOLD_TXN_TYPES = Object.keys(TXN_TO_MT).filter((t) => BUCKET[TXN_TO_MT[t]] === 'hold');

const movementTypeOf = (txnType) => {
  const t = String(txnType || '');
  return TXN_TO_MT[t] || t;
};
const labelOf = (mt) => LABELS[mt] || String(mt || '').replace(/_/g, ' ');
const bucketOf = (mt) => BUCKET[mt] || 'other';

/** The stored transaction types behind a movement_type (the FE filter). */
function txnTypesFor(movementType) {
  const wanted = Object.keys(TXN_TO_MT).filter((k) => TXN_TO_MT[k] === movementType);
  return wanted.length ? wanted : [movementType];
}

/** SQL CASE: stored transaction_type (column `col`) → ledger bucket. */
function bucketCaseSql(col = 't.transaction_type') {
  const whens = Object.keys(TXN_TO_MT)
    .map((t) => `WHEN '${t}' THEN '${bucketOf(TXN_TO_MT[t])}'`)
    .join(' ');
  return `(CASE ${col} ${whens} ELSE 'other' END)`;
}

/**
 * Signed bucket totals from per-bucket Σ quantity_kg:
 *   inward / transfer / other / opening = Σ qty; outward / sales = −Σ qty.
 */
function signedBucketTotals(sumsByBucket) {
  const s = (b) => Number(sumsByBucket[b]) || 0;
  return {
    opening: s('opening'),
    inward: s('inward'),
    outward: -s('outward'),
    transfer: s('transfer'),
    sales: -s('sales'),
    other: s('other'),
  };
}

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

module.exports = {
  TXN_TO_MT, LABELS, BUCKET, HOLD_TXN_TYPES,
  movementTypeOf, labelOf, bucketOf, txnTypesFor, bucketCaseSql, signedBucketTotals, round3,
};
