/**
 * Collection rate (owner decision C6, 2026-10-09) — received ÷ amounts DUE,
 * per currency (dollars and rupees are never added together).
 *
 *   - Only receivables whose due date has PASSED count (due date < today).
 *     Received money against something not yet due is left out of both sides.
 *   - The due date of an export order's BALANCE is the sailing date + the
 *     order's balance term: COALESCE(bl_date, atd) + balance_term_days (the
 *     order's own, else system setting export_balance_term_days, default 30).
 *     A balance whose order has not sailed is not due yet, whatever placeholder
 *     due_date the row carries. Every other receivable uses its due_date.
 *   - Written-off receivables are left out (settled by write-off, not owed).
 *   - Target: system setting collection_target_pct (default 95), overridable
 *     per currency with collection_target_pct_<CUR> (e.g. _USD).
 *   - Overdue = the outstanding on the due rows — the warning the tiles show.
 */

const DEFAULT_TARGET_PCT = 95;
const DEFAULT_BALANCE_TERM_DAYS = 30;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

async function settingNumber(conn, key, fallback) {
  const row = await conn('system_settings').where({ key }).first();
  const n = parseFloat(row && row.value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function balanceTermDaysSetting(conn) {
  return settingNumber(conn, 'export_balance_term_days', DEFAULT_BALANCE_TERM_DAYS);
}

/** { default, USD?, PKR?, ... } target percentages. */
async function collectionTargets(conn) {
  const rows = await conn('system_settings').where('key', 'like', 'collection_target_pct%').select('key', 'value');
  const out = { default: DEFAULT_TARGET_PCT };
  for (const r of rows) {
    const n = parseFloat(r.value);
    if (!Number.isFinite(n) || n < 0) continue;
    if (r.key === 'collection_target_pct') out.default = n;
    else {
      const m = r.key.match(/^collection_target_pct_([A-Za-z]{3})$/);
      if (m) out[m[1].toUpperCase()] = n;
    }
  }
  return out;
}

const targetFor = (targets, cur) => (targets && targets[cur] != null ? targets[cur] : (targets && targets.default) ?? DEFAULT_TARGET_PCT);

/**
 * Pure fold (unit-tested). rows: { currency, expected, received, outstanding,
 * effective_due ('YYYY-MM-DD' | null) }; asOf 'YYYY-MM-DD'.
 */
function foldCollection(rows = [], { asOf, targets = { default: DEFAULT_TARGET_PCT } } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const by = {};
  const notYetDue = {};
  for (const r of rows) {
    const cur = String(r.currency || 'PKR').toUpperCase();
    const due = r.effective_due ? String(r.effective_due).slice(0, 10) : null;
    if (!due || due >= today) {
      notYetDue[cur] = r2((notYetDue[cur] || 0) + num(r.outstanding));
      continue;
    }
    const b = by[cur] || (by[cur] = { dueAmount: 0, receivedAmount: 0, overdueAmount: 0, overdueCount: 0, dueCount: 0 });
    const expected = num(r.expected);
    b.dueAmount += expected;
    b.receivedAmount += Math.min(num(r.received), expected > 0 ? expected : num(r.received));
    b.dueCount += 1;
    if (num(r.outstanding) > 0.004) { b.overdueAmount += num(r.outstanding); b.overdueCount += 1; }
  }
  const byCurrency = {};
  for (const [cur, b] of Object.entries(by)) {
    if (!(b.dueAmount > 0)) continue;
    const targetPct = targetFor(targets, cur);
    const ratePct = parseFloat(((b.receivedAmount / b.dueAmount) * 100).toFixed(1));
    byCurrency[cur] = {
      ratePct,
      targetPct,
      onTarget: ratePct >= targetPct,
      dueAmount: r2(b.dueAmount),
      receivedAmount: r2(b.receivedAmount),
      overdueAmount: r2(b.overdueAmount),
      overdueCount: b.overdueCount,
      dueCount: b.dueCount,
    };
  }
  return {
    basis: 'received_over_due',
    asOf: today,
    targetPct: targetFor(targets, 'default'),
    targets,
    byCurrency,
    notYetDue,
  };
}

/**
 * Every receivable with its effective due date, folded. Point in time (today).
 */
async function collectionRate(conn, { asOf } = {}) {
  const [termDays, targets] = await Promise.all([balanceTermDaysSetting(conn), collectionTargets(conn)]);
  const rows = rowsOf(await conn.raw(`
    SELECT COALESCE(r.currency, 'PKR') AS currency,
           r.expected_amount AS expected, r.received_amount AS received, r.outstanding,
           (CASE
              WHEN r.type = 'Balance' AND r.order_id IS NOT NULL THEN
                CASE WHEN COALESCE(o.bl_date, o.atd) IS NULL THEN NULL
                     ELSE COALESCE(o.bl_date, o.atd) + COALESCE(o.balance_term_days, ?)::int END
              ELSE r.due_date
            END)::text AS effective_due
      FROM receivables r
      LEFT JOIN export_orders o ON o.id = r.order_id
     WHERE r.status <> 'Written Off'
       AND (o.id IS NULL OR o.status NOT IN ('Cancelled', 'Draft'))`, [termDays]));
  return foldCollection(rows, { asOf, targets });
}

module.exports = {
  collectionRate,
  foldCollection,
  collectionTargets,
  balanceTermDaysSetting,
  DEFAULT_TARGET_PCT,
  DEFAULT_BALANCE_TERM_DAYS,
};
