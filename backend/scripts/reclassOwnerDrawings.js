/**
 * P2-28 / owner decision D-9 — reclassify past Owner personal expenses from
 * operating expense to Owner's Drawings (3030, migration 350).
 *
 * New "Personal / Owner" expenses post Dr 3030. Ones recorded before posted
 * Dr 6000 Operating Expenses and so understate profit. For each such expense
 * this posts ONE signed-delta journal, dated today:
 *   Dr 3030 Owner's Drawings / Cr 6000 Operating Expenses   (the net the
 *   expense's own Posted journals left on 6000)
 * Nothing already on the books is edited, reversed or deleted. Idempotent: an
 * expense that already has a 'Drawings Reclass' journal is skipped.
 *
 * A personal expense is one with subcategory 'personal' (what the New expense
 * form sends for the "Personal / Owner" kind). Reversed expenses are skipped.
 *
 *   node scripts/reclassOwnerDrawings.js                         dry run (default)
 *   RECLASS_OWNER_DRAWINGS=1 node scripts/reclassOwnerDrawings.js   post
 * Output is counts and expense IDs only. Runbook: docs/runbooks/owner-drawings-reclass.md
 */
require('dotenv').config();

const WRITE = process.env.RECLASS_OWNER_DRAWINGS === '1';
const REF_TYPE = 'Drawings Reclass';

async function scan(db) {
  const rows = await db('business_expenses as e')
    .where('e.subcategory', 'personal')
    .whereNot('e.payment_status', 'Reversed')
    .whereNotExists(db('journal_entries as r').whereRaw('r.ref_no = e.expense_no').where('r.ref_type', REF_TYPE))
    .select('e.id', 'e.expense_no');
  const out = [];
  for (const e of rows) {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': e.expense_no, 'je.ref_type': 'Business Expense', 'je.status': 'Posted', 'c.code': '6000' })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS net')).first();
    const net = Math.round((r.net || 0) * 100) / 100;
    if (net > 0.005) out.push({ id: e.id, expenseNo: e.expense_no, net });
  }
  return out;
}

async function reclass(db, { write = false, userId = null, only = null } = {}) {
  const accounting = require('../src/modules/accounting/accounting.service');
  let found = await scan(db);
  if (only) found = found.filter((f) => only(f.id));
  const result = { found: found.map((f) => f.id), total: found.reduce((s, f) => s + f.net, 0), posted: 0, failed: [] };
  if (!write) return result;
  for (const f of found) {
    try {
      await db.transaction(async (trx) => {
        // Re-check under the transaction: idempotent if two runs overlap.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${REF_TYPE}:${f.expenseNo}`]);
        const done = await trx('journal_entries').where({ ref_no: f.expenseNo, ref_type: REF_TYPE }).first('id');
        if (done) return;
        const [dr, cr] = await Promise.all([
          trx('chart_of_accounts').where({ code: '3030' }).first(),
          trx('chart_of_accounts').where({ code: '6000' }).first(),
        ]);
        if (!dr || !cr) throw new Error('chart of accounts missing 3030 / 6000 (run migration 350)');
        const description = `${f.expenseNo} — owner personal expense reclassified to drawings (D-9)`;
        const j = await accounting.createJournal(trx, {
          date: new Date().toISOString().slice(0, 10), entity: 'general', refType: REF_TYPE, refNo: f.expenseNo,
          description, currency: 'PKR', fxRate: 1, isAuto: true, userId,
          lines: [
            { account_id: dr.id, account: dr.name, debit: f.net, credit: 0, narration: `DR 3030 ${dr.name} — ${description}` },
            { account_id: cr.id, account: cr.name, debit: 0, credit: f.net, narration: `CR 6000 ${cr.name} — ${description}` },
          ],
        });
        await accounting.postJournal(trx, j.id);
      });
      result.posted += 1;
    } catch (e) {
      result.failed.push({ id: f.id, reason: e.reason || 'error' });
    }
  }
  return result;
}

async function main() {
  const db = require('../src/config/database');
  try {
    const r = await reclass(db, { write: WRITE });
    console.log(`${WRITE ? '' : 'DRY RUN — '}personal expenses still on 6000: ${r.found.length}${r.found.length ? ` (expense ids ${r.found.join(', ')})` : ''}`);
    if (r.found.length) console.log(`  total to reclassify (PKR): ${r.total.toFixed(2)}`);
    if (WRITE) {
      console.log(`posted ${r.posted}; failed ${r.failed.length}`);
      for (const f of r.failed) console.log(`  failed expense #${f.id} (${f.reason})`);
    } else {
      console.log('Set RECLASS_OWNER_DRAWINGS=1 to post the reclassification journals.');
    }
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { scan, reclass };
