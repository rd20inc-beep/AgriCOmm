/**
 * Detect inventory lots whose status uses the retired spelling 'OnHold'
 * (P3-15 / DAT-23). READ-ONLY.
 *
 *   node scripts/detectLotStatusOnHold.js
 *
 * Prints counts and lot ids only, plus whether inventory_lots_status_chk still
 * admits 'OnHold' (migration 380 tightens it only when no row uses it).
 * Runbook: docs/runbooks/lot-status-on-hold.md
 */
const CONSTRAINT = 'inventory_lots_status_chk';

async function detect(db) {
  const rows = await db('inventory_lots').where({ status: 'OnHold' }).orderBy('id').select('id');
  const def = await db.raw(
    'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ?', [CONSTRAINT],
  );
  const constraintDef = def.rows.length ? def.rows[0].def : null;
  return {
    onHoldIds: rows.map((r) => r.id),
    constraintPresent: !!constraintDef,
    constraintAdmitsOnHold: !!constraintDef && constraintDef.includes("'OnHold'"),
  };
}

function report(r, log = console.log) {
  log(`lots with status 'OnHold': ${r.onHoldIds.length}${r.onHoldIds.length ? ` (ids: ${r.onHoldIds.join(', ')})` : ''}`);
  let state = "single 'On Hold' spelling";
  if (!r.constraintPresent) state = 'absent';
  else if (r.constraintAdmitsOnHold) state = "still admits 'OnHold'";
  log(`${CONSTRAINT}: ${state}`);
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
    console.error('detectLotStatusOnHold failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, CONSTRAINT };
