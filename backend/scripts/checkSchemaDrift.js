/**
 * Fail loudly when the connected database's structural schema diverges from the
 * committed baseline (backend/schema.baseline.txt) — the schema a fresh
 * migrations build produces. Two directions:
 *
 *   DRIFT  — objects in the live DB that the baseline doesn't have. This is the
 *            dangerous case: something was ALTERed onto the DB outside the
 *            migration system (exactly the prod drift that round 151 had to
 *            reconcile after the fact). Exit 1.
 *   BEHIND — objects in the baseline the live DB lacks. Normal for a DB that
 *            hasn't run the latest migrations yet; reported as a warning, not a
 *            failure, so this is safe to run pre-migration.
 *
 * Usage:
 *   node scripts/checkSchemaDrift.js          # compare live DB to the baseline
 *   In CI we instead assert the migrations-built fingerprint EQUALS the baseline
 *   (see .github/workflows/ci.yml) so the baseline can never go stale.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const { fingerprint } = require('./schemaFingerprint');

const BASELINE = path.join(__dirname, '..', 'schema.baseline.txt');

async function run() {
  if (!fs.existsSync(BASELINE)) {
    throw new Error(`Baseline not found at ${BASELINE} — generate it with: npm run schema:fingerprint > schema.baseline.txt`);
  }
  const baseline = new Set(
    fs.readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  );
  const live = new Set(await fingerprint());

  const drift = [...live].filter((l) => !baseline.has(l)).sort();
  const behind = [...baseline].filter((l) => !live.has(l)).sort();

  if (behind.length) {
    console.warn(`\n⚠️  ${behind.length} schema object(s) in baseline but not in this DB (migrations not yet applied?):`);
    behind.forEach((l) => console.warn(`   - ${l}`));
  }

  if (drift.length) {
    console.error(`\n❌ SCHEMA DRIFT: ${drift.length} object(s) exist in this DB but no migration creates them.`);
    console.error('   They were added outside the migration system. Add a migration that creates them');
    console.error('   IF NOT EXISTS (see migration 151), or drop them. Offending objects:\n');
    drift.forEach((l) => console.error(`   + ${l}`));
    console.error('');
    return 1;
  }

  console.log(`✅ No schema drift — DB matches the migrations baseline (${baseline.size} objects).`);
  return 0;
}

run()
  .then((code) => db.destroy().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err.message || err);
    db.destroy().finally(() => process.exit(1));
  });
