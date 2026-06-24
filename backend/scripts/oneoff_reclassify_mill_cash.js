/**
 * One-off: relocate mill-origin cash that landed in Office Petty Cash (Head Office)
 * BEFORE the entity-aware cash-routing fix (commit 9e64b28) into the Mill Cash
 * account, so the split is clean going forward.
 *
 * The mill amount = the sum of local-sale ('local_sale') credits that hit Office
 * Petty Cash (those receipts were mill sales). Office Petty Cash keeps whatever
 * else it holds (its genuine Head Office opening float).
 *
 * Pure operational reclassification: it moves the two bank_accounts balances and
 * drops a debit/credit bank_transactions pair for the audit trail. NO GL journal —
 * both accounts roll up to 1000 Cash & Bank, so the aggregate (and the trial
 * balance) is unchanged; this only corrects WHICH cash account physically holds
 * the mill's money. Idempotent: re-running is a no-op (guards on the reference).
 *
 * Run inside the backend container:  node scripts/oneoff_reclassify_mill_cash.js
 */
const db = require('../src/config/database');

const REF = 'RECLASS-MILL-CASH-202506';

async function nextBtNo(trx) {
  const last = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
  const seq = last ? (parseInt(String(last.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
  return `BT-${String(seq).padStart(4, '0')}`;
}

(async () => {
  try {
    const petty = await db('bank_accounts').where({ name: 'Office Petty Cash' }).first();
    const mill = await db('bank_accounts').where({ name: 'Mill Cash' }).first();
    if (!petty || !mill) throw new Error('Office Petty Cash / Mill Cash account not found.');

    const already = await db('bank_transactions').where({ reference: REF }).first();
    if (already) { console.log('Already reclassified (found', REF + ') — no-op.'); await db.destroy(); return; }

    const millCredit = await db('bank_transactions')
      .where({ bank_account_id: petty.id, source: 'local_sale', type: 'credit' })
      .sum('amount as t').first();
    const amount = Math.min(parseFloat(millCredit.t) || 0, parseFloat(petty.current_balance) || 0);
    if (!(amount > 0)) { console.log('No mill-origin cash to move.'); await db.destroy(); return; }

    console.log(`Before: Office Petty Cash ${petty.current_balance} | Mill Cash ${mill.current_balance}`);
    console.log(`Moving Rs ${amount.toLocaleString()} (mill local-sale receipts) → Mill Cash`);

    await db.transaction(async (trx) => {
      await trx('bank_accounts').where({ id: petty.id }).decrement('current_balance', amount);
      await trx('bank_accounts').where({ id: mill.id }).increment('current_balance', amount);
      const note = `Reclassification: mill local-sale cash relocated from Office Petty Cash to Mill Cash (pre-9e64b28 receipts)`;
      await trx('bank_transactions').insert({
        transaction_no: await nextBtNo(trx), bank_account_id: petty.id, type: 'debit',
        amount, currency: 'PKR', status: 'posted', transaction_date: new Date().toISOString().slice(0, 10),
        reference: REF, counterparty: 'Mill Cash', category: 'Cash Reclassification', notes: note, source: 'reclassification',
      });
      await trx('bank_transactions').insert({
        transaction_no: await nextBtNo(trx), bank_account_id: mill.id, type: 'credit',
        amount, currency: 'PKR', status: 'posted', transaction_date: new Date().toISOString().slice(0, 10),
        reference: REF, counterparty: 'Office Petty Cash', category: 'Cash Reclassification', notes: note, source: 'reclassification',
      });
    });

    const p2 = await db('bank_accounts').where({ id: petty.id }).first();
    const m2 = await db('bank_accounts').where({ id: mill.id }).first();
    console.log(`After:  Office Petty Cash ${p2.current_balance} | Mill Cash ${m2.current_balance}`);
    await db.destroy();
  } catch (e) { console.error('ERR', e.message); await db.destroy(); process.exit(1); }
})();
