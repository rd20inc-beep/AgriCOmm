/**
 * Month-end FX revaluation (owner decision G-7, 2026-10-09).
 *
 * For a month-end date and a foreign currency (USD), restate in PKR at the
 * month's CLOSING rate (fx_rates — the latest row dated inside that month, on
 * or before the month-end; never the 280 / system fallback):
 *   - open foreign receivables on 1110 Export AR: the balance receivables of
 *     orders whose revenue was recognised by the month-end, open foreign amount
 *     = expected − receipts dated on or before it; each was booked at its own
 *     rate (base_amount_pkr / expected_amount), so the unrealised figure is
 *     open × (closing − booked);
 *   - each foreign bank / cash account's own GL (G-8): native balance at the
 *     month-end × closing rate − the GL's PKR balance at the month-end.
 * The difference posts to 6210 FX Gain/Loss in one journal per entity, dated
 * the month-end (ref_type 'FX Revaluation'), and an automatic reversal of
 * each, dated the 1st of the next month ('FX Revaluation Reversal',
 * reversal_of = the original), so next month starts from book values again
 * and realised FX lands in full when the money moves.
 *
 * Idempotent per month: a second run is refused (409) unless `rerun` — then
 * the old pair is netted by signed delta ('FX Revaluation Correction', each
 * delta on its original's date) and its row is marked superseded before the
 * fresh pair posts. Never reverse-and-repost, never delete.
 */
const db = require('../../config/database');
const accountingService = require('./accounting.service');
const { ValidationError, ConflictError } = require('../../shared/errors');

const FX_CODE = '6210';
const AR_CODE = '1110';
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;
// pg hands a DATE back as local midnight — read its local parts, never
// toISOString (which shifts it a day east of UTC).
const iso = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d || '').slice(0, 10));

/** 'YYYY-MM' or any date in the month → { monthEnd, monthStart, nextFirst, label }. Pure. */
function monthBounds(input) {
  const m = /^(\d{4})-(\d{2})/.exec(String(input || ''));
  if (!m) throw new ValidationError('month_end must be a date (YYYY-MM-DD) or a month (YYYY-MM).');
  const y = Number(m[1]); const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new ValidationError('month_end has an invalid month.');
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const ny = mo === 12 ? y + 1 : y; const nm = mo === 12 ? 1 : mo + 1;
  return {
    monthStart: `${y}-${pad(mo)}-01`,
    monthEnd: `${y}-${pad(mo)}-${pad(last)}`,
    nextFirst: `${ny}-${pad(nm)}-01`,
    label: `${y}-${pad(mo)}`,
  };
}

/** The month's closing rate: latest fx_rates row dated inside the month. */
async function closingRate(knex, currency, { monthStart, monthEnd }) {
  const row = await knex('fx_rates')
    .where({ from_currency: currency, to_currency: 'PKR' })
    .where('effective_date', '>=', monthStart)
    .where('effective_date', '<=', monthEnd)
    .where('rate', '>', 0)
    .orderBy('effective_date', 'desc').orderBy('id', 'desc')
    .first();
  if (!row) {
    throw new ValidationError(`No ${currency}→PKR rate is recorded for ${monthStart.slice(0, 7)} — add the closing rate in Accounting › Rates first (the system default is never used for a revaluation).`);
  }
  return { rate: num(row.rate), rateDate: iso(row.effective_date), rateId: row.id };
}

/** Open foreign AR on 1110 at the month-end, per receivable. */
async function openReceivables(knex, currency, monthEnd, rate) {
  const recvs = await knex('receivables as r')
    .join('export_orders as o', 'o.id', 'r.order_id')
    .where('r.currency', currency)
    .whereRaw("LOWER(r.type) = 'balance'")
    .whereNotIn('o.status', ['Cancelled'])
    .select('r.id', 'r.recv_no', 'r.expected_amount', 'r.base_amount_pkr', 'r.fx_rate', 'o.id as order_id', 'o.order_no', 'o.booked_fx_rate');
  const out = [];
  for (const r of recvs) {
    // Revenue (Dr 1110) recognised on or before the month-end?
    const rev = await knex('journal_entries as je')
      .join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': r.order_no, 'je.ref_type': 'Export Order', 'je.status': 'Posted', 'c.code': AR_CODE })
      .where('je.date', '<=', monthEnd)
      .where('jl.debit', '>', 0)
      .first('je.id');
    if (!rev) continue;
    const paid = await knex('payments')
      .where({ linked_receivable_id: r.id, type: 'receipt' })
      .whereNotIn('status', ['Reversed', 'Rejected', 'Pending Finance Confirmation'])
      .where((w) => w.where('cleared', true).orWhereNull('cleared'))
      .where('payment_date', '<=', monthEnd)
      .sum('amount as s').first();
    const open = r2(num(r.expected_amount) - num(paid && paid.s));
    if (open <= 0.009) continue;
    const exp = num(r.expected_amount);
    const booked = exp > 0 && num(r.base_amount_pkr) > 0 ? num(r.base_amount_pkr) / exp
      : (num(r.fx_rate) > 1 ? num(r.fx_rate) : num(r.booked_fx_rate));
    if (!(booked > 0)) continue;
    out.push({
      receivable_id: r.id, recv_no: r.recv_no, order_no: r.order_no, open_foreign: open,
      booked_rate: r2(booked * 1e4) / 1e4, unrealised_pkr: r2(open * (rate - booked)),
    });
  }
  return out;
}

/** Each foreign account's native balance and GL PKR balance at the month-end. */
async function foreignAccounts(knex, currency, monthEnd, rate) {
  const accts = await knex('bank_accounts').where({ currency }).orderBy('id');
  const out = [];
  for (const a of accts) {
    if (!a.gl_account_id) {
      console.warn(`[fxRevaluation] ${currency} account #${a.id} (${a.name}) has no GL account — not revalued.`);
      continue;
    }
    const after = await knex('bank_transactions')
      .where({ bank_account_id: a.id, status: 'posted' })
      .where('transaction_date', '>', monthEnd)
      .select(knex.raw("COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS n")).first();
    const nativeBal = r2(num(a.current_balance) - num(after && after.n));
    const gl = await knex('journal_lines as jl')
      .join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where({ 'jl.account_id': a.gl_account_id, 'je.status': 'Posted' })
      .where('je.date', '<=', monthEnd)
      .select(knex.raw('COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS n')).first();
    const bookPkr = r2(num(gl && gl.n));
    const target = r2(nativeBal * rate);
    out.push({
      bank_account_id: a.id, name: a.name, entity: a.entity || 'general', gl_account_id: a.gl_account_id,
      native_balance: nativeBal, book_pkr: bookPkr, revalued_pkr: target, unrealised_pkr: r2(target - bookPkr),
    });
  }
  return out;
}

/** Everything a revaluation would post, without posting it. */
async function compute(knex, { monthEnd: input, currency = 'USD' }) {
  const cur = String(currency || 'USD').toUpperCase();
  if (cur === 'PKR') throw new ValidationError('PKR is the reporting currency — nothing to revalue.');
  const bounds = monthBounds(input);
  const { rate, rateDate, rateId } = await closingRate(knex, cur, bounds);
  const ar = await openReceivables(knex, cur, bounds.monthEnd, rate);
  const banks = await foreignAccounts(knex, cur, bounds.monthEnd, rate);
  const arUnrealised = r2(ar.reduce((s, x) => s + x.unrealised_pkr, 0));
  const bankUnrealised = r2(banks.reduce((s, x) => s + x.unrealised_pkr, 0));
  return {
    currency: cur, ...bounds, rate, rateDate, rateId,
    ar, banks,
    arForeign: r2(ar.reduce((s, x) => s + x.open_foreign, 0)),
    arUnrealised, bankUnrealised, total: r2(arUnrealised + bankUnrealised),
  };
}

// One journal per entity: AR on 'export', each account on its own entity.
async function buildJournals(knex, calc) {
  const [fxAcc, arAcc] = await Promise.all([
    knex('chart_of_accounts').where({ code: FX_CODE }).first(),
    knex('chart_of_accounts').where({ code: AR_CODE }).first(),
  ]);
  if (!fxAcc || !arAcc) throw new ValidationError(`Chart of accounts is missing ${FX_CODE} / ${AR_CODE}.`);
  const byEntity = {};
  const add = (entity, acc, delta, what) => {
    if (Math.abs(delta) < 0.01) return;
    (byEntity[entity] = byEntity[entity] || []).push({
      account_id: acc.id, account: acc.name,
      debit: delta > 0 ? delta : 0, credit: delta < 0 ? -delta : 0,
      narration: `${delta > 0 ? 'DR' : 'CR'} ${acc.code} ${acc.name} — ${what}`.slice(0, 240),
    });
  };
  add('export', arAcc, calc.arUnrealised, `revalue open ${calc.currency} AR ${calc.arForeign} @ ${calc.rate}`);
  for (const b of calc.banks) {
    const gl = await knex('chart_of_accounts').where({ id: b.gl_account_id }).first();
    if (gl) add(['general', 'mill', 'export'].includes(b.entity) ? b.entity : 'general', gl, b.unrealised_pkr, `revalue ${calc.currency} ${b.native_balance} @ ${calc.rate}`);
  }
  return Object.entries(byEntity).map(([entity, lines]) => {
    const net = r2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
    lines.push({
      account_id: fxAcc.id, account: fxAcc.name,
      debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0,
      narration: `${net > 0 ? 'CR' : 'DR'} ${fxAcc.code} ${fxAcc.name} — unrealised ${calc.currency} ${net > 0 ? 'gain' : 'loss'} ${calc.label}`,
    });
    return { entity, lines };
  });
}

async function postMirror(trx, j, { date, refType, description, userId }) {
  const lines = await trx('journal_lines').where({ journal_id: j.id }).orderBy('id');
  const delta = await accountingService.createJournal(trx, {
    date, entity: j.entity, refType, refNo: j.ref_no, description,
    currency: 'PKR', fxRate: 1, isAuto: true, userId,
    origCurrency: j.orig_currency || null, origFxRate: j.orig_fx_rate || null,
    lines: lines.map((l) => ({
      account_id: l.account_id, account: l.account, debit: num(l.credit), credit: num(l.debit),
      narration: `Reversal — ${l.narration || j.ref_no}`.slice(0, 240),
    })),
  });
  await trx('journal_entries').where({ id: delta.id }).update({ reversal_of: j.id });
  await accountingService.postJournal(trx, delta.id);
  return delta;
}

/**
 * Post (or preview) a month's revaluation. Returns the computation plus the
 * row and the journal numbers. Throws ValidationError (no rate, bad month,
 * closed period) / ConflictError (already posted, rerun not asked).
 */
async function revalue({ monthEnd, currency = 'USD', rerun = false, preview = false, userId = null }) {
  if (preview) return { preview: true, ...(await compute(db, { monthEnd, currency })) };
  return db.transaction(async (trx) => {
    const cur = String(currency || 'USD').toUpperCase();
    const bounds = monthBounds(monthEnd);
    const refNo = `FXREV-${cur}-${bounds.label}`;
    // Serialise two runs of the same month.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [refNo]);
    const existing = await trx('fx_revaluations')
      .where({ currency: cur, month_end: bounds.monthEnd, status: 'posted' }).forUpdate().first();
    if (existing && !rerun) {
      throw new ConflictError(`${cur} for ${bounds.label} was already revalued (net ${num(existing.total_unrealised_pkr).toLocaleString()} PKR at ${num(existing.rate)}). Re-run it to replace that entry.`);
    }
    // Refuse a month with no closing rate before anything is netted.
    await closingRate(trx, cur, bounds);

    // Re-run: net the old month-end journals and their reversals by delta.
    const corrections = [];
    if (existing) {
      const ids = [...(existing.journal_ids || []), ...(existing.reversal_journal_ids || [])];
      const olds = ids.length ? await trx('journal_entries').whereIn('id', ids).where({ status: 'Posted' }).orderBy('id') : [];
      for (const j of olds) {
        const d = await postMirror(trx, j, {
          date: iso(j.date), refType: 'FX Revaluation Correction',
          description: `Re-run of ${bounds.label} revaluation — nets ${j.journal_no}`, userId,
        });
        corrections.push(d.journal_no);
      }
    }
    // Computed AFTER the old pair is netted: the accounts' month-end book
    // value must not still carry the revaluation being replaced.
    const calc = await compute(trx, { monthEnd, currency: cur });

    // Only one 'posted' row per month: retire the old one before the new row.
    if (existing) {
      await trx('fx_revaluations').where({ id: existing.id }).update({ status: 'superseded', superseded_at: trx.fn.now() });
    }

    const journalIds = []; const reversalIds = []; const journalNos = [];
    for (const { entity, lines } of await buildJournals(trx, calc)) {
      const j = await accountingService.createJournal(trx, {
        date: calc.monthEnd, entity, refType: 'FX Revaluation', refNo,
        description: `Month-end ${calc.currency} revaluation ${calc.label} @ ${calc.rate} (${calc.rateDate}) — auto-reverses ${calc.nextFirst}`,
        currency: 'PKR', fxRate: 1, isAuto: true, userId,
        origCurrency: calc.currency, origFxRate: calc.rate, lines,
      });
      await accountingService.postJournal(trx, j.id);
      const rev = await postMirror(trx, { ...j, ref_no: refNo, orig_currency: calc.currency, orig_fx_rate: calc.rate }, {
        date: calc.nextFirst, refType: 'FX Revaluation Reversal',
        description: `Automatic reversal of ${j.journal_no} (${calc.label} revaluation)`, userId,
      });
      journalIds.push(j.id); reversalIds.push(rev.id); journalNos.push(j.journal_no, rev.journal_no);
    }

    const [row] = await trx('fx_revaluations').insert({
      currency: calc.currency, month_end: calc.monthEnd, rate: calc.rate, rate_date: calc.rateDate, rate_id: calc.rateId,
      status: 'posted', ar_foreign: calc.arForeign, ar_unrealised_pkr: calc.arUnrealised,
      bank_unrealised_pkr: calc.bankUnrealised, total_unrealised_pkr: calc.total,
      detail: JSON.stringify({ ar: calc.ar, banks: calc.banks, corrections }),
      journal_ids: JSON.stringify(journalIds), reversal_journal_ids: JSON.stringify(reversalIds),
      created_by: userId,
    }).returning('*');
    if (existing) await trx('fx_revaluations').where({ id: existing.id }).update({ superseded_by: row.id });
    return { ...calc, revaluation: row, journals: journalNos, corrections, replaced: existing ? existing.id : null };
  });
}

async function list({ currency } = {}) {
  const q = db('fx_revaluations as f').leftJoin('users as u', 'u.id', 'f.created_by')
    .select('f.*', 'u.full_name as created_by_name').orderBy('f.month_end', 'desc').orderBy('f.id', 'desc').limit(60);
  if (currency) q.where('f.currency', String(currency).toUpperCase());
  return q;
}

module.exports = { revalue, compute, list, monthBounds };
