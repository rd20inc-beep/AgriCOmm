/**
 * Make the hauler unique indexes cover EVERY active hauler (P3-08 / DAT-20) —
 * the "VALIDATE" step of migration 393, which left the later rows of existing
 * duplicates out of uq_haulers_active_name / uq_haulers_active_phone.
 *
 * Only once scripts/detectTransportParty.js reports no duplicate groups (they
 * were resolved by a person: deactivated or renamed). DRY RUN by default —
 * set VALIDATE_HAULER_UNIQUE=1 to rebuild the indexes. Refuses while any
 * duplicate remains. Prints counts only.
 *
 * Runbook: docs/runbooks/transport-party-model.md
 */
const { INDEXES } = require('../migrations/20261017_393_hauler_unique');
const { duplicateGroups, indexExclusions } = require('./detectTransportParty');

async function main(_argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.VALIDATE_HAULER_UNIQUE === '1';
  const db = require('../src/config/database');
  try {
    let remaining = 0;
    for (const idx of INDEXES) {
      const extra = idx.where === 'is_active' ? '' : `AND ${idx.where.replace(/^is_active AND /, '')}`;
      const groups = await duplicateGroups(db, idx.expr, extra);
      log(`${idx.name}: ${groups.length} duplicate group(s)`);
      remaining += groups.length;
    }
    const before = await indexExclusions(db);
    for (const i of before) log(`  ${i.name}: ${i.excludes ? 'has exclusions' : 'already covers every active hauler'}`);
    if (remaining) {
      log('Refused: resolve the duplicates first (deactivate or rename), then re-run.');
      return 1;
    }
    if (!before.some((i) => i.excludes)) { log('Nothing to do.'); return 0; }
    if (!write) { log('Nothing written. Set VALIDATE_HAULER_UNIQUE=1 to rebuild the indexes with no exclusions.'); return 0; }
    await db.transaction(async (trx) => {
      for (const idx of INDEXES) {
        await trx.raw(`DROP INDEX IF EXISTS ${idx.name}`);
        await trx.raw(`CREATE UNIQUE INDEX ${idx.name} ON haulers ((${idx.expr})) WHERE ${idx.where}`);
      }
    });
    for (const i of await indexExclusions(db)) log(`  ${i.name}: ${i.excludes ? 'STILL has exclusions' : 'covers every active hauler'}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('validateHaulerUnique failed:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
