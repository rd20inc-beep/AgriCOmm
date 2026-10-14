/**
 * Write off sub-rupee residues on confirmed local sales (P2-24) — an
 * Owner-approved adjustment, never an edit of the sale's total or a receipt.
 *
 *   node scripts/correctLocalSaleResidues.js                         dry-run (ids + count)
 *   APPLY_LOCAL_SALE_RESIDUES=1 OWNER_APPROVED_BY=<owner user id> node scripts/correctLocalSaleResidues.js
 *
 * A residue is a Completed sale line with 0 < due_amount < Re 1: the form
 * charged whole rupees, the server booked paisa, so the buyer was never asked
 * for it and cannot pay it (no coin below Re 1). Writing needs the env flag AND
 * the id of an active Owner (write-offs are Owner-only, decided 2026-10-05).
 *
 * Per line, in one transaction:
 *   - a Posted journal, the signed delta of the over-booked revenue: Dr the
 *     revenue account the sale's own 'Local Sale' journal credited / Cr 1120
 *     Local AR, by the residue, party-stamped to the customer, ref_type
 *     'Local Sale Rounding', ref_no = sale_no;
 *   - the line's due_amount → 0, payment_status → 'Paid', a note naming the
 *     approval; its receivable's outstanding → 0, status 'Paid', same note.
 *     total_amount and paid_amount are NOT changed: the invoice stays what it
 *     was, the residue is written off beside it.
 * A line whose revenue journal cannot be found is skipped and reported.
 *
 * Output is COUNTS and IDS only.
 */
const db = require('../src/config/database');
const accounting = require('../src/modules/accounting/accounting.service');

const APPLY = process.env.APPLY_LOCAL_SALE_RESIDUES === '1';
const OWNER = parseInt(process.env.OWNER_APPROVED_BY, 10) || null;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function main() {
  if (APPLY) {
    const owner = OWNER ? await db('users as u').join('roles as r', 'r.id', 'u.role_id')
      .where({ 'u.id': OWNER, 'r.name': 'Owner', 'u.is_active': true }).first('u.id') : null;
    if (!owner) {
      console.error('Refusing: APPLY_LOCAL_SALE_RESIDUES=1 needs OWNER_APPROVED_BY=<id of an active Owner>.');
      process.exitCode = 2;
      return;
    }
  }
  const lines = await db('local_sales').where('status', 'Completed')
    .where('due_amount', '>', 0).where('due_amount', '<', 1).orderBy('id');
  let done = 0;
  const skipped = [];
  for (const sale of lines) {
    const rev = await db('journal_entries as je').join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .where({ 'je.ref_no': sale.sale_no, 'je.ref_type': 'Local Sale', 'je.status': 'Posted' })
      .where('jl.credit', '>', 0).first('jl.account_id', 'jl.account');
    const ar = await db('chart_of_accounts').where({ code: '1120' }).first();
    if (!rev || !ar) { skipped.push(sale.id); continue; }
    if (!APPLY) { done += 1; continue; }
    const amt = round2(sale.due_amount);
    const note = `Rounding residue Rs ${amt} written off (P2-24, approved by owner #${OWNER})`;
    await db.transaction(async (trx) => {
      const j = await accounting.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: sale.entity || 'mill',
        refType: 'Local Sale Rounding', refNo: sale.sale_no,
        description: `Local sale ${sale.sale_no} — sub-rupee residue written off`,
        currency: 'PKR', fxRate: 1, isAuto: false, userId: OWNER,
        partyType: sale.customer_id ? 'customer' : null, partyId: sale.customer_id || null,
        lines: [
          { account_id: rev.account_id, account: rev.account, debit: amt, credit: 0, narration: `DR revenue — rounding ${sale.sale_no}` },
          { account_id: ar.id, account: ar.name, debit: 0, credit: amt, narration: `CR ${ar.code} ${ar.name} — rounding ${sale.sale_no}` },
        ],
      });
      await accounting.postJournal(trx, j.id);
      await trx('local_sales').where({ id: sale.id }).update({
        due_amount: 0, payment_status: 'Paid', notes: [sale.notes, note].filter(Boolean).join(' · '), updated_at: trx.fn.now(),
      });
      const r = await trx('receivables').where({ local_sale_id: sale.id }).forUpdate().first();
      if (r) {
        await trx('receivables').where({ id: r.id }).update({
          outstanding: 0, status: 'Paid', notes: [r.notes, note].filter(Boolean).join(' · '), updated_at: trx.fn.now(),
        });
      }
    });
    done += 1;
  }
  console.log(`${APPLY ? 'WROTE OFF' : 'DRY-RUN would write off'}: ${done} residue line(s); skipped (no revenue journal): ${skipped.length} ${JSON.stringify(skipped)}`);
}

main()
  .then(() => db.destroy())
  .catch((e) => { console.error('residue correction failed:', e.message); return db.destroy().then(() => process.exit(1)); });
