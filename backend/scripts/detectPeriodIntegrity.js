/**
 * READ-ONLY detection for accounting periods (P4-13, owner decision D-1:
 * Pakistani fiscal year 1 July – 30 June, monthly periods; the Finance Manager
 * closes a month, only the Owner reopens it).
 *
 *   A. month periods whose dates are not their calendar month (migration 012
 *      seeded them a day early on a host east of UTC; migration 411 realigns
 *      the OPEN ones — any listed here are Closed / Locked and left alone)
 *   B. overlapping periods, and two periods starting on the same day
 *   C. months of the current and the next fiscal year with no period
 *   D. posted journals and posted bank / cash movements dated in a month with
 *      no period, by month
 *   E. posted journals and posted bank / cash movements dated in a period that
 *      is NOT Open (Closed / Locked) — what a close froze, per period. No
 *      migration closes anything (every period starts Open), so on a fresh
 *      deploy this is empty; once months are closed it lists what they hold.
 *   F. journals whose stamped period_id is not the period their date falls in
 *      (older rows, or the shifted seed). Informational: every period check
 *      now resolves the period from the DATE; posted journals are never
 *      rewritten.
 *
 * Writes nothing. Output is COUNTS and row IDS only — no names, no amounts.
 *   node scripts/detectPeriodIntegrity.js
 * Runbook: docs/runbooks/accounting-periods.md
 */
const { fiscalYearOf, monthsOfFiscalYear } = require('../src/shared/fiscalYear');

const MONTH_NAME = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);
const day = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10));

const OVERLAP_SQL = `
  SELECT a.id AS a, b.id AS b FROM accounting_periods a
    JOIN accounting_periods b ON a.id < b.id
     AND a.period_start <= b.period_end AND b.period_start <= a.period_end
   ORDER BY a.id, b.id`;

const DUP_START_SQL = `
  SELECT period_start::text AS start, array_agg(id ORDER BY id) AS ids
    FROM accounting_periods GROUP BY period_start HAVING count(*) > 1`;

const UNCOVERED_SQL = (table, dateCol, statusCond) => `
  SELECT to_char(t.${dateCol}::date, 'YYYY-MM') AS month, count(*)::int AS n
    FROM ${table} t
   WHERE ${statusCond}
     AND NOT EXISTS (SELECT 1 FROM accounting_periods p
                      WHERE t.${dateCol}::date BETWEEN p.period_start AND p.period_end)
   GROUP BY 1 ORDER BY 1`;

const IN_CLOSED_SQL = (table, dateCol, statusCond) => `
  SELECT p.id, p.name, p.status, count(t.id)::int AS n
    FROM accounting_periods p
    JOIN ${table} t ON t.${dateCol}::date BETWEEN p.period_start AND p.period_end
   WHERE p.status <> 'Open' AND ${statusCond}
   GROUP BY p.id, p.name, p.status ORDER BY p.period_start`;

const STALE_STAMP_SQL = `
  SELECT je.id FROM journal_entries je
    LEFT JOIN accounting_periods p ON je.date BETWEEN p.period_start AND p.period_end
   WHERE je.period_id IS DISTINCT FROM p.id
   ORDER BY je.id`;

async function detect(db, { today = new Date() } = {}) {
  const periods = await db('accounting_periods').select('id', 'name', 'period_start', 'period_end', 'status');

  const misaligned = [];
  for (const p of periods) {
    const m = String(p.name || '').match(MONTH_NAME);
    if (!m) continue;
    const mi = MONTHS.indexOf(m[1]);
    const y = parseInt(m[2], 10);
    const start = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(y, mi + 1, 0)).toISOString().slice(0, 10);
    if (day(p.period_start) !== start || day(p.period_end) !== end) misaligned.push({ id: p.id, status: p.status });
  }

  const fy = fiscalYearOf(today);
  const missingMonths = [];
  for (const startYear of [fy.startYear, fy.startYear + 1]) {
    for (const month of monthsOfFiscalYear(startYear)) {
      const covered = periods.some((p) => day(p.period_start) <= month.start && day(p.period_end) >= month.start);
      if (!covered) missingMonths.push(month.name);
    }
  }

  const POSTED_JE = "t.status = 'Posted'";
  const POSTED_BT = "COALESCE(t.status, 'posted') = 'posted'";
  return {
    total: periods.length,
    misaligned,
    overlaps: rowsOf(await db.raw(OVERLAP_SQL)),
    duplicateStarts: rowsOf(await db.raw(DUP_START_SQL)),
    missingMonths,
    uncoveredJournals: rowsOf(await db.raw(UNCOVERED_SQL('journal_entries', 'date', POSTED_JE))),
    uncoveredBank: rowsOf(await db.raw(UNCOVERED_SQL('bank_transactions', 'transaction_date', POSTED_BT))),
    journalsInClosed: rowsOf(await db.raw(IN_CLOSED_SQL('journal_entries', 'date', POSTED_JE))),
    bankInClosed: rowsOf(await db.raw(IN_CLOSED_SQL('bank_transactions', 'transaction_date', POSTED_BT))),
    staleStamps: rowsOf(await db.raw(STALE_STAMP_SQL)).map((r) => r.id),
  };
}

const ids = (list) => (list.length ? ` ids: ${list.slice(0, 200).join(', ')}${list.length > 200 ? ' …' : ''}` : '');

function report(res, log = console.log) {
  log(`Accounting periods: ${res.total}`);
  log(`A. month periods off their calendar month: ${res.misaligned.length}${ids(res.misaligned.map((p) => `${p.id}(${p.status})`))}`);
  log(`B. overlapping pairs: ${res.overlaps.length}${ids(res.overlaps.map((o) => `${o.a}/${o.b}`))}`);
  log(`   same start date: ${res.duplicateStarts.length}${ids(res.duplicateStarts.map((r) => `${r.start}:[${r.ids}]`))}`);
  log(`C. months of the current / next fiscal year with no period: ${res.missingMonths.length}${res.missingMonths.length ? ` (${res.missingMonths.join(', ')})` : ''}`);
  log(`D. posted journals in a month with no period: ${res.uncoveredJournals.reduce((s, r) => s + r.n, 0)}${res.uncoveredJournals.length ? ` (${res.uncoveredJournals.map((r) => `${r.month}: ${r.n}`).join(', ')})` : ''}`);
  log(`   posted bank / cash movements in a month with no period: ${res.uncoveredBank.reduce((s, r) => s + r.n, 0)}${res.uncoveredBank.length ? ` (${res.uncoveredBank.map((r) => `${r.month}: ${r.n}`).join(', ')})` : ''}`);
  log(`E. posted journals dated in a Closed / Locked period: ${res.journalsInClosed.reduce((s, r) => s + r.n, 0)}`);
  for (const r of res.journalsInClosed) log(`   period ${r.id} ${r.name} (${r.status}): ${r.n}`);
  log(`   posted bank / cash movements dated in a Closed / Locked period: ${res.bankInClosed.reduce((s, r) => s + r.n, 0)}`);
  for (const r of res.bankInClosed) log(`   period ${r.id} ${r.name} (${r.status}): ${r.n}`);
  log(`F. journals stamped with a period other than their date's (informational): ${res.staleStamps.length}${ids(res.staleStamps)}`);
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
    console.error('detectPeriodIntegrity failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report };
