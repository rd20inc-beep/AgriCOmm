/**
 * Redact secret values inside HISTORIC audit_logs.details rows, in place.
 *
 * Rows written before the write-time redaction (utils/redactSecrets) can hold a
 * plaintext password, PIN or API key under details.body. This rewrites ONLY
 * those secret-named keys to "[REDACTED]" — no row is deleted, no other field
 * changes, ids/timestamps stay. Same key matcher as the live code path.
 *
 * Disabled by default (owner decision D-26):
 *   node scripts/redactAuditSecrets.js --dry-run       counts only, writes nothing
 *   REDACT_AUDIT_SECRETS=1 node scripts/redactAuditSecrets.js   performs the UPDATE
 * Without the env flag and without --dry-run it refuses and exits 2.
 *
 * Output is COUNTS ONLY — it never prints a value, a key path's content or a row.
 * Runbook: docs/runbooks/audit-log-secret-redaction.md
 */
const { redactSecrets } = require('../src/utils/redactSecrets');

const BATCH = 500;

function stableJson(v) { return JSON.stringify(v); }

async function scan(db, { write }) {
  let lastId = 0;
  let scanned = 0;
  let affected = 0;
  const byEntity = {};
  for (;;) {
    const rows = await db('audit_logs')
      .where('id', '>', lastId)
      .whereNotNull('details')
      .orderBy('id', 'asc')
      .limit(BATCH)
      .select('id', 'entity_type', 'details');
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const updates = [];
    for (const r of rows) {
      scanned += 1;
      let d = r.details;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { continue; } }
      const red = redactSecrets(d);
      if (stableJson(red) !== stableJson(d)) {
        affected += 1;
        const k = r.entity_type || '(none)';
        byEntity[k] = (byEntity[k] || 0) + 1;
        if (write) updates.push({ id: r.id, details: red });
      }
    }
    if (write && updates.length) {
      await db.transaction(async (trx) => {
        for (const u of updates) {
          await trx('audit_logs').where({ id: u.id }).update({ details: JSON.stringify(u.details) });
        }
      });
    }
  }
  return { scanned, affected, byEntity };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const dryRun = argv.includes('--dry-run');
  const enabled = env.REDACT_AUDIT_SECRETS === '1';
  if (!dryRun && !enabled) {
    log('redactAuditSecrets: disabled. Use --dry-run for counts, or set REDACT_AUDIT_SECRETS=1 to redact.');
    return 2;
  }
  const db = require('../src/config/database');
  try {
    const total = await db('audit_logs').count('id as n').first();
    log(`audit_logs rows: ${total.n}`);
    const res = await scan(db, { write: !dryRun });
    log(`${dryRun ? '[dry-run] rows that WOULD be redacted' : 'rows redacted'}: ${res.affected} (of ${res.scanned} with details)`);
    for (const [k, n] of Object.entries(res.byEntity).sort()) log(`  ${k}: ${n}`);
    if (!dryRun) {
      const after = await scan(db, { write: false });
      log(`rows still holding a secret-named value after redaction: ${after.affected}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    // Message only — a stack/row could echo data.
    console.error('redactAuditSecrets failed:', err.message);
    process.exit(1);
  });
}

module.exports = { scan, main };
