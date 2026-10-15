/**
 * READ-ONLY detection for the lot quantity invariant (P3-01 / P3-02).
 *
 *   available_qty = qty − reserved_qty − milling_reserved_qty   (± 0.01 kg)
 *
 *   A. lots whose stored available_qty disagrees with qty − holds
 *        A1 use-in-batch   the lot was fed to a batch by the old "Use in Batch"
 *                          (a milling_vehicle_arrivals row named after the lot,
 *                          'Allocated from purchase lot …'): available was
 *                          lowered, the rice was never held or consumed
 *        A2 over-held      qty − holds < 0: the holds exceed the stock
 *        A3 other          any other drift
 *   B. holds that disagree with what holds them (review only)
 *        B1 reserved_qty ≠ Σ Active inventory_reservations
 *        B2 milling_reserved_qty > 0 with no open batch holding the lot
 *   C. qty ≠ Σ lot_transactions.quantity_kg (> 1 kg) — ledger break (review)
 *   D. qty ≠ net_weight_kg (> 0.01 kg) (review)
 *   E. status out of step with qty: empty but 'Available' / stocked but 'Depleted'
 *   F. the migration-371 CHECKs and whether they are VALID yet
 *
 * Writes nothing. Output is COUNTS and lot / batch IDS only — no names, no amounts.
 *   node scripts/detectLotQuantityDrift.js
 * Runbook: docs/runbooks/lot-quantity-invariant.md
 */

const CONSTRAINTS = [
  'inventory_lots_available_derived_chk',
  'inventory_lots_milling_reserved_nonneg_chk',
  'inventory_lots_status_chk',
];
const OPEN_BATCH = "('Queued', 'In Progress', 'Pending', 'Pending Approval', 'On Hold')";

const DRIFT_SQL = `
  WITH alloc AS (
    SELECT l.id AS lot_id, array_agg(DISTINCT a.batch_id) AS batch_ids
      FROM inventory_lots l
      JOIN milling_vehicle_arrivals a ON a.vehicle_no = l.lot_no AND a.batch_id IS NOT NULL
                                      AND a.notes ILIKE 'Allocated from purchase lot%'
     GROUP BY l.id
  )
  SELECT l.id,
         CASE WHEN alloc.lot_id IS NOT NULL THEN 'use_in_batch'
              WHEN l.qty - l.reserved_qty - l.milling_reserved_qty < -0.01 THEN 'over_held'
              ELSE 'other' END AS kind,
         alloc.batch_ids
    FROM inventory_lots l
    LEFT JOIN alloc ON alloc.lot_id = l.id
   WHERE abs(l.available_qty - (l.qty - l.reserved_qty - l.milling_reserved_qty)) > 0.01
      OR l.milling_reserved_qty < 0
   ORDER BY l.id`;

const RESERVED_SQL = `
  SELECT l.id
    FROM inventory_lots l
    LEFT JOIN (SELECT lot_id, sum(reserved_qty) AS s FROM inventory_reservations
                WHERE status = 'Active' GROUP BY lot_id) r ON r.lot_id = l.id
   WHERE abs(l.reserved_qty - COALESCE(r.s, 0)) > 0.01
   ORDER BY l.id`;

const ORPHAN_HOLD_SQL = `
  SELECT l.id
    FROM inventory_lots l
   WHERE l.milling_reserved_qty > 0.01
     AND NOT EXISTS (
       SELECT 1 FROM batch_source_lots s JOIN milling_batches b ON b.id = s.batch_id
        WHERE s.lot_id = l.id AND b.status IN ${OPEN_BATCH})
   ORDER BY l.id`;

const LEDGER_SQL = `
  SELECT l.id
    FROM inventory_lots l
    LEFT JOIN (SELECT lot_id, sum(quantity_kg) AS s FROM lot_transactions GROUP BY lot_id) t ON t.lot_id = l.id
   WHERE abs(l.qty - COALESCE(t.s, 0)) > 1
   ORDER BY l.id`;

const NET_SQL = 'SELECT id FROM inventory_lots WHERE abs(qty - net_weight_kg) > 0.01 ORDER BY id';

const STATUS_SQL = `
  SELECT id, CASE WHEN qty <= 0.001 THEN 'to_depleted' ELSE 'to_available' END AS kind
    FROM inventory_lots
   WHERE (qty <= 0.001 AND status = 'Available') OR (qty > 0.001 AND status = 'Depleted')
   ORDER BY id`;

const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

async function detect(db) {
  const drift = rowsOf(await db.raw(DRIFT_SQL));
  const status = rowsOf(await db.raw(STATUS_SQL));
  const cons = rowsOf(await db.raw('SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY(?)', [CONSTRAINTS]));
  const idsOf = async (sql) => rowsOf(await db.raw(sql)).map((r) => r.id);
  return {
    useInBatch: drift.filter((r) => r.kind === 'use_in_batch').map((r) => ({ id: r.id, batchIds: r.batch_ids || [] })),
    overHeld: drift.filter((r) => r.kind === 'over_held').map((r) => r.id),
    other: drift.filter((r) => r.kind === 'other').map((r) => r.id),
    reservedMismatch: await idsOf(RESERVED_SQL),
    orphanHolds: await idsOf(ORPHAN_HOLD_SQL),
    ledgerBreak: await idsOf(LEDGER_SQL),
    netMismatch: await idsOf(NET_SQL),
    toDepleted: status.filter((r) => r.kind === 'to_depleted').map((r) => r.id),
    toAvailable: status.filter((r) => r.kind === 'to_available').map((r) => r.id),
    constraints: Object.fromEntries(CONSTRAINTS.map((c) => {
      const row = cons.find((r) => r.conname === c);
      return [c, row ? (row.convalidated ? 'VALID' : 'NOT VALID') : 'missing'];
    })),
  };
}

const ids = (list) => (list.length ? ` ids: ${list.slice(0, 200).join(', ')}${list.length > 200 ? ' …' : ''}` : '');

function report(res, log = console.log) {
  log('A. available_qty ≠ qty − reserved − milling_reserved');
  log(`   A1 old "Use in Batch" (lot:batches): ${res.useInBatch.length}${ids(res.useInBatch.map((r) => `${r.id}:${r.batchIds.join('/')}`))}`);
  log(`   A2 over-held (manual review): ${res.overHeld.length}${ids(res.overHeld)}`);
  log(`   A3 other: ${res.other.length}${ids(res.other)}`);
  log('B. holds vs what holds them (review only)');
  log(`   B1 reserved_qty ≠ active reservations: ${res.reservedMismatch.length}${ids(res.reservedMismatch)}`);
  log(`   B2 milling hold with no open batch: ${res.orphanHolds.length}${ids(res.orphanHolds)}`);
  log(`C. qty ≠ lot ledger (> 1 kg, review only): ${res.ledgerBreak.length}${ids(res.ledgerBreak)}`);
  log(`D. qty ≠ net_weight_kg (review only): ${res.netMismatch.length}${ids(res.netMismatch)}`);
  log('E. status out of step with qty');
  log(`   empty but Available → Depleted: ${res.toDepleted.length}${ids(res.toDepleted)}`);
  log(`   stocked but Depleted → Available: ${res.toAvailable.length}${ids(res.toAvailable)}`);
  log('F. constraints:');
  for (const [name, state] of Object.entries(res.constraints)) log(`   ${name}: ${state}`);
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    report(await detect(db), log);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectLotQuantityDrift failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, CONSTRAINTS, OPEN_BATCH };
