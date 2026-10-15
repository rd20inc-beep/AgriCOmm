/**
 * Restate purchase lots' payment_status / due_amount against their SUPPLIER
 * bills (P3-10 / INV-11). DRY-RUN BY DEFAULT.
 *
 *   node scripts/restateLotPaymentStatus.js                      dry-run: counts + lot ids
 *   RESTATE_LOT_PAYMENT_STATUS=1 node scripts/restateLotPaymentStatus.js
 *                                                                writes, in ONE transaction
 *
 * Before P3-10 a lot was measured against its landed cost (freight and broker
 * commission included) while only supplier payments reached it, so lots whose
 * supplier was paid in full stayed 'Partial' with a false due_amount. Both
 * are derived values: this recomputes them with lotPayment.paymentState —
 * paid_amount, payables, payments and the GL are not touched.
 *
 * Output is counts and lot ids only (no names, no amounts).
 * Runbook: docs/runbooks/lot-quantity-invariant.md (§ Lot payment status)
 */
const { lotPaymentTotal, paymentState } = require('../src/modules/inventory/lotPayment');

const num = (v) => parseFloat(v) || 0;

async function detect(db) {
  const lots = await db('inventory_lots')
    .where((q) => q.where('purchase_amount', '>', 0).orWhere('landed_cost_total', '>', 0).orWhere('paid_amount', '>', 0))
    .select('id', 'lot_no', 'supplier_id', 'landed_cost_total', 'paid_amount', 'due_amount', 'payment_status');
  const changes = [];
  for (const lot of lots) {
    const want = paymentState(await lotPaymentTotal(db, lot), num(lot.paid_amount));
    if (want.payment_status !== lot.payment_status || Math.abs(want.due_amount - num(lot.due_amount)) > 0.01) {
      changes.push({ id: lot.id, from: lot.payment_status, to: want.payment_status, ...want });
    }
  }
  return { scanned: lots.length, changes };
}

function report(res, log = console.log) {
  log(`lots scanned: ${res.scanned}; to restate: ${res.changes.length}`);
  const byMove = {};
  for (const c of res.changes) {
    const k = `${c.from} → ${c.to}`;
    (byMove[k] = byMove[k] || []).push(c.id);
  }
  for (const [k, list] of Object.entries(byMove)) {
    log(`   ${k}: ${list.length} ids: ${list.slice(0, 200).join(', ')}${list.length > 200 ? ' …' : ''}`);
  }
}

async function restate(db, { write, log = console.log }) {
  const res = await detect(db);
  if (!write) { log('[dry-run]'); report(res, log); return { ...res, written: 0 }; }
  await db.transaction(async (trx) => {
    for (const c of res.changes) {
      await trx('inventory_lots').where({ id: c.id })
        .update({ payment_status: c.payment_status, due_amount: c.due_amount, updated_at: trx.fn.now() });
    }
  });
  report(res, log);
  log(`restated: ${res.changes.length}`);
  return { ...res, written: res.changes.length };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.RESTATE_LOT_PAYMENT_STATUS === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await restate(db, { write, log });
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('restateLotPaymentStatus failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, restate, main };
