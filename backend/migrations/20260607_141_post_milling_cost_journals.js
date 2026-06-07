/**
 * Backfill party-stamped GL journals for the milling_costs payables.
 *
 * These payables (source_table='milling_costs', pay_no PAY-Mxxxx) were created
 * by the one-time seed in migration 041 from existing milling_costs rows, but —
 * unlike the purchase-lot flow, which autoPosts a 'purchase_invoice' journal —
 * they were never posted to the GL. So they showed up in the payables directory
 * but were invisible in the supplier statement (a read-side fallback was added
 * to synthesize them; this migration makes them real GL entries instead).
 *
 * Each payable is posted exactly as a credit purchase, mirroring the
 * 'purchase_invoice' posting rule:  DR 1210 Raw Paddy Stock (asset) /
 * CR 2010 Supplier Payable (liability), party-stamped to the supplier. Using an
 * asset debit keeps this balance-sheet-only — it does NOT touch P&L, so it can't
 * double-count COGS recognized elsewhere. Verified before writing: 0 of these
 * payables are already represented in the GL, and their suppliers have no
 * overlapping purchase-lot payables, so there's no double-posting.
 *
 * Self-contained (no app-service require, which would open a second pool and
 * hang the migrate process), idempotent (skips any payable already journaled by
 * ref), and reversible (down deletes the journals it created).
 */

const REF_TYPE = 'Mill Cost (backfill)';
const DR_CODE = '1210'; // Raw Paddy Stock (Asset)
const CR_CODE = '2010'; // Supplier Payable (Liability)

exports.up = async function (knex) {
  const dr = await knex('chart_of_accounts').where({ code: DR_CODE }).first();
  const cr = await knex('chart_of_accounts').where({ code: CR_CODE }).first();
  if (!dr || !cr) return; // chart not present in this environment

  const payables = await knex('payables')
    .where({ source_table: 'milling_costs' })
    .whereNotNull('supplier_id');

  for (const p of payables) {
    const amount = Math.round((parseFloat(p.original_amount) || 0) * 100) / 100;
    if (amount <= 0) continue;

    // Skip if this payable is already in the GL by ref (its own pay_no or its
    // batch linked_ref). Biases toward NOT posting when uncertain — the
    // read-side fallback still surfaces anything left unposted, so a miss is
    // harmless while a double-post would not be.
    const refs = [p.pay_no, p.linked_ref].filter(Boolean);
    if (refs.length) {
      const existing = await knex('journal_entries').whereIn('ref_no', refs).first();
      if (existing) continue;
    }

    const date = (p.due_date || p.created_at)
      ? new Date(p.due_date || p.created_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Never post into a closed period.
    const period = await knex('accounting_periods')
      .where('period_start', '<=', date).andWhere('period_end', '>=', date).first();
    if (period && period.status !== 'Open') continue;

    // journal_no JE-YYYYMM-XXXX (sequential; prior inserts are visible in-tx)
    const ym = date.slice(0, 7).replace('-', '');
    const lastJE = await knex('journal_entries')
      .where('journal_no', 'like', `JE-${ym}-%`).orderBy('id', 'desc').first();
    let seq = 1;
    if (lastJE && lastJE.journal_no) {
      const n = parseInt(String(lastJE.journal_no).split('-')[2], 10);
      if (!Number.isNaN(n)) seq = n + 1;
    }
    const journalNo = `JE-${ym}-${String(seq).padStart(4, '0')}`;

    const desc = `${p.category || 'Mill cost'} owed to supplier — ${p.pay_no}`
      + (p.linked_ref ? ` (batch ${p.linked_ref})` : '');

    const [je] = await knex('journal_entries').insert({
      journal_no: journalNo,
      date,
      entity: 'mill',
      ref_type: REF_TYPE,
      ref_no: p.pay_no,
      description: desc.slice(0, 240),
      status: 'Posted',
      currency: p.currency || 'PKR',
      fx_rate: 1,
      is_auto: true,
      period_id: period ? period.id : null,
      total_debit: amount,
      total_credit: amount,
      created_by: p.created_by || null,
      party_type: 'supplier',
      party_id: p.supplier_id,
    }).returning('id');
    const jeId = typeof je === 'object' ? je.id : je;

    await knex('journal_lines').insert([
      { journal_id: jeId, account_id: dr.id, account: dr.name, debit: amount, credit: 0,
        narration: `DR ${dr.code} ${dr.name} — ${desc}`.slice(0, 240) },
      { journal_id: jeId, account_id: cr.id, account: cr.name, debit: 0, credit: amount,
        narration: `CR ${cr.code} ${cr.name} — ${desc}`.slice(0, 240) },
    ]);
  }
};

exports.down = async function (knex) {
  const ids = (await knex('journal_entries').where({ ref_type: REF_TYPE }).select('id')).map((j) => j.id);
  if (ids.length) {
    await knex('journal_lines').whereIn('journal_id', ids).del();
    await knex('journal_entries').whereIn('id', ids).del();
  }
};
