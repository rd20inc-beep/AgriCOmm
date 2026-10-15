// THE stock valuation (P3-19 / INV-21, owner decision D-14, 2026-10-15).
//
//   value of a lot = landed cost per KG × KG on hand
//
// No fallback prices: a lot with no landed cost is worth 0 here and is
// reported as unpriced — never valued at its purchase rate, its cost_per_unit
// or a default rate per kg. Eight different bases used to be in use (on-hand vs
// available; landed vs rate vs cost_per_unit vs a stored total_value), so the
// same stock showed different values on different screens and none of them
// could be tied to the GL. Every stock-value surface now reads these
// expressions.
//
// On hand, not available: rice reserved for an export order or committed to a
// milling batch is still ours and still in the warehouse. What is committed to
// an open milling batch is carried in 1260 Milling WIP in the GL (D-6), so the
// per-account tie-out below moves it from its stock account to WIP.
//
// Company stock only by default — client-owned (service milling) lots are
// never valued (stockSql.companyStock).

const { onHandKg, ownershipSql } = require('./stockSql');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const WIP_ACCOUNT = '1260';
const STOCK_ACCOUNTS = ['1210', '1220', '1230', '1240'];

/** Landed cost per KG, no fallback (SQL). */
const landedPerKgSql = (a = 'l') => `COALESCE(${a}.landed_cost_per_kg, 0)`;

/** D-14 value of a lot (SQL, unrounded — round the total, not every lot). */
const lotValueSql = (a = 'l') => `(${onHandKg(a)} * ${landedPerKgSql(a)})`;

/** The GL inventory account a lot is carried in (SQL twin of inventoryAccountForLot). */
const lotAccountSql = (a = 'l') => `(CASE
      WHEN ${a}.type = 'finished' THEN (CASE WHEN ${a}.entity = 'export' THEN '1230' ELSE '1220' END)
      WHEN ${a}.type = 'byproduct' THEN '1240'
      ELSE '1210' END)`;

/** D-14 value of one lot row (JS twin of lotValueSql). */
function lotValue(lot) {
  if (!lot) return 0;
  const net = parseFloat(lot.net_weight_kg ?? lot.netWeightKg) || 0;
  const kg = net > 0 ? net : (parseFloat(lot.qty) || 0);
  return kg * (parseFloat(lot.landed_cost_per_kg ?? lot.landedCostPerKg) || 0);
}

// A milling batch whose rice is committed but not yet milled: a company batch
// that is not finished, cancelled or rejected and has no yield on the books (no
// output lots, no Posted completion journal — the same facts costEditLocks
// .batchYielded uses).
// Open = not yet (or no longer) yielded, by the same tests as milling's
// batchYielded: an output lot that is live (a reversed yield leaves its lots
// Closed at 0), or a completion journal not netted by its reversal (P3-03 keeps
// the original Posted and posts a reversal_of delta).
const openBatchSql = (mb = 'mb') => `(${mb}.is_service_milling IS NOT TRUE
      AND ${mb}.status NOT IN ('Completed', 'Cancelled', 'Rejected')
      AND NOT EXISTS (SELECT 1 FROM inventory_lots o
        WHERE o.batch_ref = 'batch-' || ${mb}.id AND o.type IN ('finished', 'byproduct')
          AND (o.status <> 'Closed' OR COALESCE(o.qty, 0) > 0))
      AND NOT EXISTS (SELECT 1 FROM journal_entries je
        WHERE je.ref_type = 'Milling Batch' AND je.ref_no = ${mb}.batch_no AND je.status = 'Posted'
          AND je.reversal_of IS NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entries jr
            WHERE jr.reversal_of = je.id AND jr.status = 'Posted')))`;

/**
 * Rice committed to open milling batches, one row per (batch, lot):
 *   - a source lot (batch_source_lots): the committed qty, carried in the lot's
 *     own account (1210 raw, 1220 / 1230 finished, 1240 by-product);
 *   - truck intake (a batch with no source lots): the batch's raw lot
 *     (batch_ref 'batch-<id>') — all of it is the batch's input.
 * Valued at the lot's landed cost per KG (D-14). SQL text for a subquery with
 * columns batch_id, batch_no, lot_id, lot_no, account, kind, kg, value.
 */
const millingCommitmentsSql = () => `(
    SELECT mb.id AS batch_id, mb.batch_no, l.id AS lot_id, l.lot_no, ${lotAccountSql('l')} AS account,
           'source' AS kind,
           CAST(bsl.qty_kg AS numeric) AS kg,
           CAST(bsl.qty_kg AS numeric) * ${landedPerKgSql('l')} AS value
      FROM batch_source_lots bsl
      JOIN milling_batches mb ON mb.id = bsl.batch_id
      JOIN inventory_lots l ON l.id = bsl.lot_id
     WHERE ${openBatchSql('mb')} AND ${ownershipSql('l', 'company')}
    UNION ALL
    SELECT mb.id, mb.batch_no, l.id, l.lot_no, '1210', 'truck',
           ${onHandKg('l')}, ${lotValueSql('l')}
      FROM milling_batches mb
      JOIN inventory_lots l ON l.batch_ref = 'batch-' || mb.id AND l.type = 'raw' AND l.entity = 'mill'
     WHERE ${openBatchSql('mb')} AND ${ownershipSql('l', 'company')}
       AND NOT EXISTS (SELECT 1 FROM batch_source_lots b2 WHERE b2.batch_id = mb.id)
  )`;

/** Committed rows, optionally for one batch. */
async function millingCommitments(q, { batchId = null } = {}) {
  const sql = `SELECT * FROM ${millingCommitmentsSql()} c${batchId != null ? ' WHERE c.batch_id = ?' : ''} ORDER BY c.batch_id, c.lot_id`;
  const res = await q.raw(sql, batchId != null ? [batchId] : []);
  return (res.rows || []).map((r) => ({
    batchId: r.batch_id, batchNo: r.batch_no, lotId: r.lot_id, lotNo: r.lot_no,
    account: r.account, kind: r.kind, kg: Number(r.kg) || 0, value: r2(r.value),
  }));
}

/** KG committed to open batches per lot id — Map(lotId → kg). */
async function committedKgByLot(q, lotIds = null) {
  const rows = await millingCommitments(q);
  const want = lotIds ? new Set(lotIds.map(Number)) : null;
  const out = new Map();
  for (const r of rows) {
    if (want && !want.has(Number(r.lotId))) continue;
    out.set(r.lotId, (out.get(r.lotId) || 0) + r.kg);
  }
  return out;
}

/**
 * Stock value by GL inventory account (company stock):
 *   [{ account, lots, onHandKg, value, unpricedLots, committedKg, committedValue }]
 * `entity` narrows to 'mill' / 'export'.
 */
async function stockValueByAccount(q, { entity = null } = {}) {
  const params = [];
  let where = `${ownershipSql('l', 'company')} AND ${onHandKg('l')} > 0`;
  if (entity) { where += ' AND l.entity = ?'; params.push(entity); }
  const res = await q.raw(`
    SELECT ${lotAccountSql('l')} AS account,
           COUNT(*)::int AS lots,
           COALESCE(SUM(${onHandKg('l')}), 0) AS on_hand_kg,
           COALESCE(SUM(${lotValueSql('l')}), 0) AS value,
           COUNT(*) FILTER (WHERE COALESCE(l.landed_cost_per_kg, 0) <= 0)::int AS unpriced_lots
      FROM inventory_lots l
     WHERE ${where}
     GROUP BY 1`, params);
  const commits = await millingCommitments(q);
  const committed = {};
  for (const c of commits) {
    if (entity && entity !== 'mill' && c.account !== '1230') continue;
    const k = committed[c.account] || (committed[c.account] = { kg: 0, value: 0 });
    k.kg += c.kg; k.value += c.value;
  }
  const byAcc = Object.fromEntries((res.rows || []).map((r) => [r.account, r]));
  return STOCK_ACCOUNTS.map((account) => {
    const r = byAcc[account] || {};
    const c = committed[account] || { kg: 0, value: 0 };
    return {
      account,
      lots: Number(r.lots) || 0,
      onHandKg: Number(r.on_hand_kg) || 0,
      value: r2(r.value),
      unpricedLots: Number(r.unpriced_lots) || 0,
      committedKg: c.kg,
      committedValue: r2(c.value),
    };
  });
}

/** Posted GL balance (debit − credit) per account code. */
async function glBalances(q, codes) {
  const rows = await q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where('je.status', 'Posted')
    .whereIn('c.code', codes)
    .groupBy('c.code')
    .select('c.code', q.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS bal'));
  return Object.fromEntries(rows.map((r) => [r.code, r2(r.bal)]));
}

/**
 * Net value each open batch has moved into WIP, per source account, from its
 * 'Milling WIP' journals: Map(batchNo → { [account]: value }).
 */
async function wipBookedByBatch(q, batchNos = null) {
  const qb = q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.status': 'Posted', 'je.ref_type': 'Milling WIP' })
    .whereNot('c.code', WIP_ACCOUNT)
    .groupBy('je.ref_no', 'c.code')
    .select('je.ref_no', 'c.code', q.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS moved'));
  if (batchNos) qb.whereIn('je.ref_no', batchNos);
  const out = new Map();
  for (const r of await qb) {
    const m = out.get(r.ref_no) || {};
    m[r.code] = r2((m[r.code] || 0) + Number(r.moved || 0));
    out.set(r.ref_no, m);
  }
  return out;
}

/**
 * Per-GL-account tie-out of stock (D-14 value) to the Posted GL.
 *
 *   stock accounts: expected GL = lots on hand − rice committed to open batches
 *   1260 WIP:       expected GL = rice committed to open batches
 *
 * `wipNotBooked` is committed rice still carried in its stock account because
 * its batch was committed before WIP existed (or its reclass has not run):
 * a + on the stock account and the same − on 1260. `unexplained` is what is
 * left after that — the real gap to investigate.
 */
async function inventoryTieOut(q) {
  const [stock, commits] = await Promise.all([stockValueByAccount(q), millingCommitments(q)]);
  const gl = await glBalances(q, [...STOCK_ACCOUNTS, WIP_ACCOUNT]);
  const booked = await wipBookedByBatch(q, [...new Set(commits.map((c) => c.batchNo))]);
  // Committed value per (batch, account), less what that batch has booked.
  const target = {};
  for (const c of commits) {
    const k = `${c.batchNo}|${c.account}`;
    target[k] = (target[k] || 0) + c.value;
  }
  const notBooked = {};
  for (const [k, v] of Object.entries(target)) {
    const [batchNo, account] = k.split('|');
    const m = booked.get(batchNo) || {};
    notBooked[account] = r2((notBooked[account] || 0) + v - (m[account] || 0));
  }
  const rows = stock.map((s) => {
    const expected = r2(s.value - s.committedValue);
    const glBalance = gl[s.account] || 0;
    const difference = r2(glBalance - expected);
    const wipNotBooked = notBooked[s.account] || 0;
    return { ...s, expectedGl: expected, glBalance, difference, wipNotBooked, unexplained: r2(difference - wipNotBooked) };
  });
  const committedTotal = r2(commits.reduce((s, c) => s + c.value, 0));
  const notBookedTotal = r2(Object.values(notBooked).reduce((s, v) => s + v, 0));
  const wipGl = gl[WIP_ACCOUNT] || 0;
  const wipDiff = r2(wipGl - committedTotal);
  rows.push({
    account: WIP_ACCOUNT, lots: new Set(commits.map((c) => c.lotId)).size,
    onHandKg: commits.reduce((s, c) => s + c.kg, 0), value: committedTotal, unpricedLots: 0,
    committedKg: commits.reduce((s, c) => s + c.kg, 0), committedValue: committedTotal,
    expectedGl: committedTotal, glBalance: wipGl, difference: wipDiff,
    wipNotBooked: r2(-notBookedTotal), unexplained: r2(wipDiff + notBookedTotal),
  });
  return { accounts: rows, openBatches: new Set(commits.map((c) => c.batchId)).size };
}

module.exports = {
  WIP_ACCOUNT, STOCK_ACCOUNTS,
  landedPerKgSql, lotValueSql, lotAccountSql, lotValue,
  openBatchSql, millingCommitmentsSql, millingCommitments, committedKgByLot,
  stockValueByAccount, glBalances, wipBookedByBatch, inventoryTieOut,
};
