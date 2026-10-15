/**
 * READ-ONLY detection for the export receivables fixes (P2-01 / P2-18).
 *
 *   A. receivables whose outstanding ≠ expected − received (not written off)
 *        A1 reset   outstanding > expected − received — the EXP-01 signature:
 *                   a contract-summary save rebuilt a paid receivable to owing
 *        A2 other   outstanding < expected − received
 *        A3 overpaid received > expected (cannot be corrected by formula —
 *                   manual review)
 *   B. export orders whose stored money fields disagree with their receivables
 *      (what migration 342's refresh_export_order_financials would write):
 *        advance_received / balance_received ≠ Σ received of that type,
 *        financial_status ≠ derived (only orders with a live Advance receivable)
 *   C. receivables whose expected ≠ the order's advance / balance expected
 *      (e.g. a debit note erased from balance_expected) — review only
 *   D. rows breaking the parent-link CHECKs, and which constraints are still
 *      NOT VALID
 *
 * Writes nothing. Output is COUNTS and row IDS only — no names, no amounts.
 *   node scripts/detectReceivableOutstandingDrift.js
 * Runbook: docs/runbooks/receivable-outstanding-correction.md
 */

const CONSTRAINTS = [
  'chk_receivables_outstanding_equation',
  'chk_receivables_export_parent',
  'chk_receivables_service_parent',
  'chk_payments_receivable_is_receipt',
  'chk_payments_payable_is_payment',
];

const DRIFT_SQL = `
  SELECT id,
         CASE WHEN received_amount > expected_amount + 0.01 THEN 'overpaid'
              WHEN outstanding > expected_amount - received_amount THEN 'reset'
              ELSE 'other' END AS kind
    FROM receivables
   WHERE status <> 'Written Off'
     AND abs(outstanding - (expected_amount - received_amount)) > 0.01
   ORDER BY id`;

// Mirrors refresh_export_order_financials (migration 342).
const ORDER_DRIFT_SQL = `
  WITH r AS (
    SELECT order_id,
           count(*) FILTER (WHERE type = 'Advance') AS adv_n,
           count(*) FILTER (WHERE type = 'Advance' AND status <> 'Written Off') AS adv_live,
           COALESCE(sum(received_amount) FILTER (WHERE type = 'Advance'), 0) AS adv_recv,
           count(*) FILTER (WHERE type = 'Balance') AS bal_n,
           COALESCE(sum(received_amount) FILTER (WHERE type = 'Balance'), 0) AS bal_recv
      FROM receivables WHERE order_id IS NOT NULL GROUP BY order_id
  ), p AS (
    SELECT r.order_id,
           count(*) FILTER (WHERE pm.status = 'Pending Finance Confirmation') AS pending_n,
           count(*) FILTER (WHERE pm.status = 'Rejected') AS rejected_n
      FROM payments pm JOIN receivables r ON r.id = pm.linked_receivable_id
     WHERE r.type = 'Advance' AND pm.type = 'receipt' AND r.order_id IS NOT NULL
     GROUP BY r.order_id
  ), d AS (
    SELECT o.id,
           CASE WHEN r.adv_n > 0 THEN r.adv_recv ELSE o.advance_received END AS want_adv,
           CASE WHEN r.bal_n > 0 THEN r.bal_recv ELSE o.balance_received END AS want_bal,
           CASE WHEN r.adv_live > 0 AND o.status <> 'Cancelled' THEN
             CASE WHEN COALESCE(o.advance_expected, 0) <= 0 THEN 'Not Required'
                  WHEN (CASE WHEN r.adv_n > 0 THEN r.adv_recv ELSE o.advance_received END) >= COALESCE(o.advance_expected, 0) - 0.01 THEN 'Confirmed'
                  WHEN COALESCE(p.pending_n, 0) > 0 THEN 'Pending Confirmation'
                  WHEN (CASE WHEN r.adv_n > 0 THEN r.adv_recv ELSE o.advance_received END) > 0.01 THEN 'Partially Confirmed'
                  WHEN COALESCE(p.rejected_n, 0) > 0 THEN 'Rejected'
                  ELSE 'Advance Not Entered' END
           ELSE o.financial_status END AS want_fs,
           o.advance_received, o.balance_received, o.financial_status
      FROM export_orders o JOIN r ON r.order_id = o.id LEFT JOIN p ON p.order_id = o.id
  )
  SELECT id,
         (advance_received IS DISTINCT FROM want_adv) AS adv,
         (balance_received IS DISTINCT FROM want_bal) AS bal,
         (financial_status IS DISTINCT FROM want_fs) AS fs
    FROM d
   WHERE advance_received IS DISTINCT FROM want_adv
      OR balance_received IS DISTINCT FROM want_bal
      OR financial_status IS DISTINCT FROM want_fs
   ORDER BY id`;

const EXPECTED_MISMATCH_SQL = `
  SELECT r.id
    FROM receivables r JOIN export_orders o ON o.id = r.order_id
   WHERE r.status <> 'Written Off'
     AND ((r.type = 'Advance' AND abs(r.expected_amount - COALESCE(o.advance_expected, 0)) > 0.01)
       OR (r.type = 'Balance' AND abs(r.expected_amount - COALESCE(o.balance_expected, 0)) > 0.01))
   ORDER BY r.id`;

const LINK_SQL = {
  chk_receivables_export_parent: "SELECT id FROM receivables WHERE NOT (type IS NULL OR type NOT IN ('Advance', 'Balance') OR order_id IS NOT NULL) ORDER BY id",
  chk_receivables_service_parent: "SELECT id FROM receivables WHERE NOT (type IS NULL OR type <> 'Service Milling' OR service_invoice_id IS NOT NULL) ORDER BY id",
  chk_payments_receivable_is_receipt: "SELECT id FROM payments WHERE NOT (linked_receivable_id IS NULL OR type = 'receipt') ORDER BY id",
  chk_payments_payable_is_payment: "SELECT id FROM payments WHERE NOT (linked_payable_id IS NULL OR type = 'payment') ORDER BY id",
};

const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

async function detect(db) {
  const drift = rowsOf(await db.raw(DRIFT_SQL));
  const orderDrift = rowsOf(await db.raw(ORDER_DRIFT_SQL));
  const expectedMismatch = rowsOf(await db.raw(EXPECTED_MISMATCH_SQL));
  const links = {};
  for (const [name, sql] of Object.entries(LINK_SQL)) links[name] = rowsOf(await db.raw(sql)).map((r) => r.id);
  const cons = rowsOf(await db.raw('SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY(?)', [CONSTRAINTS]));
  return {
    reset: drift.filter((r) => r.kind === 'reset').map((r) => r.id),
    other: drift.filter((r) => r.kind === 'other').map((r) => r.id),
    overpaid: drift.filter((r) => r.kind === 'overpaid').map((r) => r.id),
    orderDrift,
    expectedMismatch: expectedMismatch.map((r) => r.id),
    links,
    constraints: Object.fromEntries(CONSTRAINTS.map((c) => {
      const row = cons.find((r) => r.conname === c);
      return [c, row ? (row.convalidated ? 'VALID' : 'NOT VALID') : 'missing'];
    })),
  };
}

const ids = (list) => (list.length ? ` ids: ${list.slice(0, 200).join(', ')}${list.length > 200 ? ' …' : ''}` : '');

function report(res, log = console.log) {
  log('A. receivables: outstanding ≠ expected − received (not written off)');
  log(`   A1 reset (EXP-01): ${res.reset.length}${ids(res.reset)}`);
  log(`   A2 other:          ${res.other.length}${ids(res.other)}`);
  log(`   A3 overpaid (manual review): ${res.overpaid.length}${ids(res.overpaid)}`);
  log(`B. export orders disagreeing with their receivables: ${res.orderDrift.length}`);
  log(`   advance_received: ${res.orderDrift.filter((r) => r.adv).length}, balance_received: ${res.orderDrift.filter((r) => r.bal).length}, financial_status: ${res.orderDrift.filter((r) => r.fs).length}${ids(res.orderDrift.map((r) => r.id))}`);
  log(`C. receivables whose expected ≠ the order's (review only): ${res.expectedMismatch.length}${ids(res.expectedMismatch)}`);
  log('D. parent-link CHECK violators:');
  for (const [name, list] of Object.entries(res.links)) log(`   ${name}: ${list.length}${ids(list)}`);
  log('Constraints:');
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
    console.error('detectReceivableOutstandingDrift failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, CONSTRAINTS, LINK_SQL };
