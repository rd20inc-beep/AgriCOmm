/**
 * READ-ONLY detection for the export shipment gates (P3-13 / D-18 and
 * P3-17 / D-17, 2026-10-15). Run BEFORE deploying them, to see which orders
 * already in flight will be held up, and again after.
 *
 *   A. open orders (not yet Shipped) that would fail the RESERVATION gate:
 *      Active reservations not within ±export_reservation_tolerance_pct
 *      (default 2) of the order quantity
 *        A1 none reserved   A2 short   A3 over
 *   B. open orders that would fail the PRE-SHIPMENT DOCUMENT gate: a required
 *      document with no stored file checked by a second person and no approved
 *      generated document — split by why (awaiting a check / pending review /
 *      generated but unapproved / missing). The 'Confirm Ready' ticks
 *      (export_order_documents) no longer count.
 *   C. shipped orders (Shipped / Arrived) that would fail the CLOSE document
 *      gate (all seven, including BL Final and Certificate of Origin)
 *   D. open orders holding a reservation on a lot of ANOTHER product than the
 *      order's lines — the auto-reserve on advance confirmation (EXP-03) did
 *      this; review before shipping
 *   E. shipped orders with no export dispatch in the lot ledger (EXP-02: they
 *      shipped with nothing reserved, so no lot was reduced) — review only;
 *      correcting them needs a person to name the lot (see the runbook)
 *
 * Orders in Ready to Ship are flagged '*': they are past the Ready to Ship
 * gate already but will be refused at Shipped.
 *
 * Writes nothing. Output is COUNTS and order IDS / numbers only — no names, no
 * amounts. Exit code 2 when anything is found.
 *   node scripts/detectExportGateFailures.js
 * Runbook: docs/runbooks/export-shipment-gates.md
 */

const OPEN = ['Awaiting Advance', 'Advance Received', 'Procurement Pending', 'In Milling',
  'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship'];
const DEPARTED = ['Shipped', 'Arrived'];

// Before migration 390 there is no checked_by stamp. Read it the way that
// migration back-fills it: the latest 'approve' in document_approvals, by
// someone other than the uploader or by an Owner. Same answer, pre-deploy.
async function withApprovalStamp(db, gate) {
  const rows = await db.raw(`
    SELECT DISTINCT ON (da.document_id) da.document_id, da.approver_id
      FROM document_approvals da
      JOIN document_store ds ON ds.id = da.document_id
      LEFT JOIN users u ON u.id = da.approver_id
      LEFT JOIN roles r ON r.id = u.role_id
     WHERE da.action = 'approve' AND da.approver_id IS NOT NULL
       AND ds.linked_type = 'export_order'
       AND (ds.uploaded_by IS NULL OR ds.uploaded_by <> da.approver_id OR r.name = 'Owner')
     ORDER BY da.document_id, da.created_at DESC, da.id DESC`);
  const stamp = new Map((rows.rows || rows).map((r) => [Number(r.document_id), r.approver_id]));
  // A connection whose document_store reads carry the derived checked_by.
  const conn = (table) => {
    const q = db(table);
    if (table !== 'document_store') return q;
    const sel = q.select.bind(q);
    q.select = (...cols) => sel(...cols.flat().filter((c) => c !== 'checked_by'));
    const then = q.then.bind(q);
    q.then = (ok, ko) => then((list) => (Array.isArray(list)
      ? list.map((r) => ({ ...r, checked_by: stamp.get(Number(r.id)) || null }))
      : list)).then(ok, ko);
    return q;
  };
  return (orderId) => gate.evaluateDocumentGate(conn, orderId);
}

async function detect(db) {
  const gate = require('../src/modules/exportOrders/documentGate');
  const { reservationCover } = require('../src/modules/exportOrders/reservationGate');
  const migrated = await db.schema.hasColumn('document_store', 'checked_by');
  const evaluate = migrated ? (orderId) => gate.evaluateDocumentGate(db, orderId) : await withApprovalStamp(db, gate);

  const open = await db('export_orders').whereIn('status', OPEN).select('id', 'order_no', 'status', 'qty_mt').orderBy('id');
  const departed = await db('export_orders').whereIn('status', DEPARTED).select('id', 'order_no', 'status').orderBy('id');

  const res = { open: open.length, departed: departed.length, A: { none: [], short: [], over: [] }, B: [], C: [], D: [], E: [], migrated };

  for (const o of open) {
    const c = await reservationCover(db, o);
    if (!c.withinTolerance) {
      const tag = { id: o.id, order_no: o.order_no, rts: o.status === 'Ready to Ship', pct: c.orderKg > 0 ? Math.round((c.reservedKg / c.orderKg) * 1000) / 10 : 0 };
      if (c.reservedKg <= 0) res.A.none.push(tag);
      else if (c.reservedKg < c.minKg) res.A.short.push(tag);
      else res.A.over.push(tag);
    }
    const g = await evaluate(o.id);
    const missing = Object.values(g).filter((x) => x.required && !x.fulfilled && !x.postShipment);
    if (missing.length) {
      res.B.push({ id: o.id, order_no: o.order_no, rts: o.status === 'Ready to Ship', docs: missing.map((x) => `${x.key}:${x.state}`) });
    }
  }
  for (const o of departed) {
    const g = await evaluate(o.id);
    const missing = Object.values(g).filter((x) => x.required && !x.fulfilled);
    if (missing.length) res.C.push({ id: o.id, order_no: o.order_no, docs: missing.map((x) => x.key) });
  }

  // D — reservations on a lot whose product is none of the order's products.
  const mism = await db.raw(`
    SELECT DISTINCT o.id, o.order_no
      FROM inventory_reservations r
      JOIN export_orders o ON o.id = r.order_id
      JOIN inventory_lots l ON l.id = r.lot_id
     WHERE r.status = 'Active'
       AND o.status = ANY(?)
       AND l.product_id IS NOT NULL
       AND l.product_id IS DISTINCT FROM o.product_id
       AND NOT EXISTS (SELECT 1 FROM export_order_items i WHERE i.order_id = o.id AND i.product_id = l.product_id)
     ORDER BY o.id`, [OPEN]);
  res.D = (mism.rows || mism).map((r) => ({ id: r.id, order_no: r.order_no }));

  // E — shipped with no export dispatch on any lot.
  const noDispatch = await db.raw(`
    SELECT o.id, o.order_no
      FROM export_orders o
     WHERE o.status IN ('Shipped', 'Arrived', 'Closed')
       AND NOT EXISTS (SELECT 1 FROM lot_transactions t
                        WHERE t.reference_module = 'export_order' AND t.reference_id = o.id
                          AND t.transaction_type = 'export_dispatch_out')
       AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_id = o.id AND r.status = 'Consumed')
     ORDER BY o.id`);
  res.E = (noDispatch.rows || noDispatch).map((r) => ({ id: r.id, order_no: r.order_no }));
  return res;
}

const fmt = (list, extra = () => '') => (list.length
  ? `\n      ${list.slice(0, 200).map((r) => `${r.id} ${r.order_no}${r.rts ? '*' : ''}${extra(r)}`).join('\n      ')}${list.length > 200 ? '\n      …' : ''}`
  : '');

function report(res, log = console.log) {
  log(`Open orders (not yet shipped): ${res.open}; shipped / arrived: ${res.departed}   (* = Ready to Ship, refused at Shipped)`);
  log('A. reservation gate (D-18) would refuse Ready to Ship / Shipped:');
  log(`   A1 nothing reserved: ${res.A.none.length}${fmt(res.A.none)}`);
  log(`   A2 short:            ${res.A.short.length}${fmt(res.A.short, (r) => ` (${r.pct}% reserved)`)}`);
  log(`   A3 over:             ${res.A.over.length}${fmt(res.A.over, (r) => ` (${r.pct}% reserved)`)}`);
  if (!res.migrated) log('   (migration 390 not run yet: a file counts as checked when document_approvals holds a second-person approval — what 390 back-fills)');
  log(`B. pre-shipment document gate (D-17) would refuse: ${res.B.length}${fmt(res.B, (r) => ` — ${r.docs.join(', ')}`)}`);
  log(`C. shipped orders the Close document gate would refuse: ${res.C.length}${fmt(res.C, (r) => ` — ${r.docs.join(', ')}`)}`);
  log(`D. open orders holding a lot of another product (review): ${res.D.length}${fmt(res.D)}`);
  log(`E. shipped orders with no export dispatch in the lot ledger (review): ${res.E.length}${fmt(res.E)}`);
}

const found = (res) => res.A.none.length + res.A.short.length + res.A.over.length + res.B.length + res.C.length + res.D.length + res.E.length;

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const res = await detect(db);
    report(res, log);
    return found(res) > 0 ? 2 : 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectExportGateFailures failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, found, OPEN };
