/**
 * Document cash tie-out drift with adjustment ENTRIES (P2-17). Never overwrites
 * a balance, never deletes or edits a row.
 *
 *   node scripts/correctBankTieOut.js                      dry-run: what it WOULD post (counts / ids)
 *   APPLY_BANK_TIE_OUT=1 ACCOUNT_IDS=4,7 node scripts/correctBankTieOut.js   posts, for those accounts only
 *
 * Writing needs BOTH the env flag and an explicit ACCOUNT_IDS list: each
 * account is a decision the accountant takes after checking the bank
 * statement (docs/runbooks/bank-tie-out.md), not a blanket fix.
 *
 * Per account, inside one transaction:
 *   1. Sub-ledger: balance − Σ posted rows = d ≠ 0 means the balance already
 *      holds d with no bank row behind it (an opening balance keyed before
 *      rows were written, a legacy path). One posted row of |d| (credit when
 *      d > 0) is inserted, source 'tie_out_explained', WITHOUT moving the
 *      balance — the money is already in it; the row only explains it.
 *   2. GL (PKR accounts only): balance − own GL = g ≠ 0 → one Posted journal
 *      between the account's GL and 1290 Suspense (Dr GL / Cr Suspense when
 *      g > 0, else the reverse), ref_type 'Tie-out Adjustment'. Suspense is
 *      the holding account — the accountant reclassifies it to the real cause
 *      through the Suspense screen. No other counter-account is assumed.
 *
 * Output is COUNTS and IDS only.
 */
const db = require('../src/config/database');
const accounting = require('../src/modules/accounting/accounting.service');
const { bankTieOut } = require('../src/modules/finance/bankTieOut');
const { nextBtNo } = require('../src/shared/bankBalance');

const APPLY = process.env.APPLY_BANK_TIE_OUT === '1';
const ONLY = String(process.env.ACCOUNT_IDS || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function main() {
  if (APPLY && !ONLY.length) {
    console.error('Refusing: APPLY_BANK_TIE_OUT=1 needs ACCOUNT_IDS=<id,id> (one decision per account).');
    process.exitCode = 2;
    return;
  }
  const t = await bankTieOut(db);
  const targets = t.accounts.filter((a) => !a.ok && (!ONLY.length || ONLY.includes(Number(a.account_id))));
  let rows = 0; let journals = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const a of targets) {
    const d = round2(a.ledger_drift);
    const needRow = Math.abs(d) > t.tolerance;
    // After step 1 the balance is unchanged, so the GL gap is the same figure.
    const g = a.comparable ? round2(a.gl_drift) : 0;
    const needJournal = a.comparable && Math.abs(g) > t.tolerance;
    console.log(`account ${a.account_id}: ${needRow ? 'explain-row' : '-'} ${needJournal ? 'gl-to-suspense' : '-'}`);
    if (!APPLY) { rows += needRow ? 1 : 0; journals += needJournal ? 1 : 0; continue; }

    await db.transaction(async (trx) => {
      const acct = await trx('bank_accounts').where({ id: a.account_id }).forUpdate().first();
      if (needRow) {
        // Insert-only on purpose: the balance already holds this money.
        await trx('bank_transactions').insert({
          transaction_no: await nextBtNo(trx), bank_account_id: acct.id,
          type: d > 0 ? 'credit' : 'debit', amount: Math.abs(d), currency: acct.currency || 'PKR',
          status: 'posted', transaction_date: today, reference: 'TIE-OUT', category: 'Tie-out',
          source: 'tie_out_explained', running_balance: acct.current_balance,
          notes: 'Tie-out: balance held this amount with no bank row (P2-17 correction)',
        });
        rows += 1;
      }
      if (needJournal) {
        const gl = await trx('chart_of_accounts').where({ id: acct.gl_account_id }).first();
        const sus = await trx('chart_of_accounts').where({ code: '1290' }).first();
        if (!gl || !sus) throw new Error(`account ${acct.id}: GL account or 1290 Suspense missing`);
        const amt = Math.abs(g);
        const line = (c, dr, cr) => ({ account_id: c.id, account: c.name, debit: dr, credit: cr, narration: `${dr > 0 ? 'DR' : 'CR'} ${c.code} ${c.name} — tie-out` });
        const j = await accounting.createJournal(trx, {
          date: today, entity: acct.entity || 'general', refType: 'Tie-out Adjustment', refNo: `TIE-${acct.id}-${today}`,
          description: `Cash tie-out adjustment — account #${acct.id} (to Suspense for review)`,
          currency: 'PKR', fxRate: 1, isAuto: false,
          lines: g > 0 ? [line(gl, amt, 0), line(sus, 0, amt)] : [line(sus, amt, 0), line(gl, 0, amt)],
        });
        await accounting.postJournal(trx, j.id);
        journals += 1;
      }
    });
  }
  console.log(`${APPLY ? 'POSTED' : 'DRY-RUN would post'}: ${rows} explain row(s), ${journals} suspense journal(s) across ${targets.length} account(s).`);
}

main()
  .then(() => db.destroy())
  .catch((e) => { console.error('tie-out correction failed:', e.message); return db.destroy().then(() => process.exit(1)); });
