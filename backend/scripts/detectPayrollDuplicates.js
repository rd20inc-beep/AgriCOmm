/**
 * READ-ONLY payroll integrity check (P2-09 / P2-10 / P2-11 / P2-27).
 * Writes nothing. Prints COUNTS and row IDs only — never names or amounts.
 *
 *   node scripts/detectPayrollDuplicates.js
 *
 * Checks
 *   A  orphan advance payouts — a live 'Salary advance — …' expense that no
 *      advance points at (a double-clicked / retried Pay used to create a
 *      second payout; the advance kept only one). Candidates for
 *      scripts/reversePayrollDuplicatePayouts.js after review.
 *   B  workers with more than one active final settlement   (blocks mig 358)
 *   C  employee-months on more than one live payroll line    (blocks mig 359)
 *   D  settlements that marked MORE advance recovered than they deducted
 *      (the old route cleared every outstanding advance in full)
 *   E  payments reversed by an advance / worker DELETE (phantom-cash candidates:
 *      a delete reversed the full payout even when part had been recovered
 *      from salary — review each against the payroll lines)
 *   F  outstanding advances paid before D-11 (payout_gl 'expensed') — already
 *      in salary cost; informational, no change is made to them
 *   G  scheduled tasks and their last runs
 *
 * Exit code: 0 = nothing blocking; 3 = B or C found (the migrations will stop).
 * Runbook: docs/runbooks/payroll-duplicate-guards.md
 */

async function hasColumn(db, table, col) {
  return db.schema.hasColumn(table, col);
}

async function detect(db) {
  const out = {};

  // A — orphan advance payouts
  const linked = db('mill_worker_advances').whereNotNull('expense_id').select('expense_id');
  const orphans = await db('business_expenses')
    .whereIn('category', ['salaries', 'staff_advance'])
    .where('description', 'like', 'Salary advance — %')
    .whereNot('payment_status', 'Reversed')
    .whereNotIn('id', linked)
    .orderBy('id').pluck('id');
  out.A_orphanAdvancePayouts = orphans;

  // B — duplicate active settlements
  const settleActive = (await hasColumn(db, 'mill_final_settlements', 'status'))
    ? (q) => q.where('status', 'active') : (q) => q;
  const dupSettle = await settleActive(db('mill_final_settlements'))
    .groupBy('worker_id').havingRaw('COUNT(*) > 1')
    .select('worker_id', db.raw('array_agg(id ORDER BY id) AS ids'));
  out.B_duplicateSettlements = dupSettle.map((r) => ({ worker_id: r.worker_id, settlement_ids: r.ids }));

  // C — duplicate live lines per employee-month
  const lineActive = await hasColumn(db, 'mill_payroll_lines', 'active');
  const dupLines = await db('mill_payroll_lines as l').join('mill_payroll_runs as r', 'r.id', 'l.run_id')
    .whereNotNull('l.worker_id')
    .modify((q) => { if (lineActive) q.where('l.active', true); else q.whereNotIn('r.status', ['voided', 'reversed']); })
    .groupBy('l.worker_id', 'r.period').havingRaw('COUNT(*) > 1')
    .select('l.worker_id', 'r.period', db.raw('array_agg(l.id ORDER BY l.id) AS line_ids'));
  out.C_duplicateLines = dupLines.map((r) => ({ worker_id: r.worker_id, period: r.period, line_ids: r.line_ids }));

  // D — settlements that recovered more than they deducted
  const settlements = await settleActive(db('mill_final_settlements')).select('id', 'advances_deducted', 'breakdown');
  const overCleared = [];
  for (const s of settlements) {
    let bd = s.breakdown; if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch { bd = {}; } }
    const cleared = (bd && bd.advancesCleared) || [];
    if (!cleared.length || cleared.some((c) => c.applied != null)) continue; // new-style rows are exact
    let recovered = 0;
    for (const c of cleared) {
      const adv = await db('mill_worker_advances').where('id', c.id).first('amount');
      if (adv) recovered += (parseFloat(adv.amount) || 0) - (parseFloat(c.prior_recovered) || 0);
    }
    if (recovered - (parseFloat(s.advances_deducted) || 0) > 0.5) overCleared.push(s.id);
  }
  out.D_settlementsOverRecovered = overCleared;

  // E — payouts reversed by an advance / worker delete
  const deleted = await db('payments').where('status', 'Reversed')
    .where(function () { this.where('reversal_reason', '~', 'Advance #[0-9]+ deleted').orWhere('reversal_reason', '~', 'Worker #[0-9]+ deleted'); })
    .orderBy('id').pluck('id');
  out.E_paymentsReversedByDelete = deleted;

  // F — legacy expensed advances still outstanding (informational)
  if (await hasColumn(db, 'mill_worker_advances', 'payout_gl')) {
    out.F_legacyExpensedOutstanding = await db('mill_worker_advances')
      .where({ payout_gl: 'expensed', status: 'outstanding' }).orderBy('id').pluck('id');
  }

  // G — scheduled tasks
  out.G_scheduledTasks = await db('scheduled_tasks').orderBy('id')
    .select('id', 'task_type', 'cron_expression', 'is_active', 'last_status', 'last_run', 'next_run');

  return out;
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const r = await detect(db);
    log(`A orphan advance payouts (live expense, no advance): ${r.A_orphanAdvancePayouts.length}${r.A_orphanAdvancePayouts.length ? ` — expense ids ${r.A_orphanAdvancePayouts.join(', ')}` : ''}`);
    log(`B workers with >1 active final settlement: ${r.B_duplicateSettlements.length}`);
    for (const x of r.B_duplicateSettlements) log(`    worker ${x.worker_id}: settlements ${x.settlement_ids.join(', ')}`);
    log(`C employee-months on >1 live payroll line: ${r.C_duplicateLines.length}`);
    for (const x of r.C_duplicateLines) log(`    worker ${x.worker_id} ${x.period}: lines ${x.line_ids.join(', ')}`);
    log(`D settlements that cleared more advance than they deducted: ${r.D_settlementsOverRecovered.length}${r.D_settlementsOverRecovered.length ? ` — ids ${r.D_settlementsOverRecovered.join(', ')}` : ''}`);
    log(`E payments reversed by an advance/worker delete (review for phantom cash): ${r.E_paymentsReversedByDelete.length}${r.E_paymentsReversedByDelete.length ? ` — payment ids ${r.E_paymentsReversedByDelete.join(', ')}` : ''}`);
    if (r.F_legacyExpensedOutstanding) log(`F outstanding advances paid before D-11 (already expensed): ${r.F_legacyExpensedOutstanding.length}`);
    log(`G scheduled tasks: ${r.G_scheduledTasks.length}`);
    for (const t of r.G_scheduledTasks) {
      const iso = (v) => (v ? new Date(v).toISOString() : '-');
      log(`    #${t.id} ${t.task_type} [${t.cron_expression || '-'}] active=${t.is_active} last=${t.last_status || '-'} @ ${iso(t.last_run)} next=${iso(t.next_run)}`);
    }
    return (r.B_duplicateSettlements.length || r.C_duplicateLines.length) ? 3 : 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectPayrollDuplicates failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, main };
