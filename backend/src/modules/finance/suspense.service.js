const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const { NotFoundError, ValidationError } = require('../../shared/errors');

// Suspense Account (#8) — record unidentified money into the 1290 Suspense
// control account (backed by a real bank/cash movement), then RESOLVE it later
// by reclassifying to the true account(s) via balancing journals. The original
// entry + journal are never deleted: resolution posts a reclass journal;
// reversal flips the journals to 'Reversed' (repo GL semantics — no reverse+repost).
//
//   receipt  (money in) : DR Bank / CR Suspense   → suspense carries a credit
//   payment  (money out): DR Suspense / CR Bank   → suspense carries a debit
//   resolve receipt line: DR Suspense / CR <target account>
//   resolve payment line: DR <target account> / CR Suspense

const SUSPENSE_CODE = '1290';
const EPSILON = 0.01;
const round2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

async function generateEntryNo(trx) {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const like = `SUS-${ym}-%`;
  const last = await trx('suspense_entries').where('entry_no', 'like', like).orderBy('id', 'desc').first('entry_no');
  const seq = last ? (parseInt(String(last.entry_no).split('-')[2], 10) || 0) + 1 : 1;
  return `SUS-${ym}-${String(seq).padStart(4, '0')}`;
}
async function nextBtNo(trx) {
  const last = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
  const seq = last ? (parseInt(String(last.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
  return `BT-${String(seq).padStart(4, '0')}`;
}
async function suspenseAccount(trx) {
  const acc = await trx('chart_of_accounts').where({ code: SUSPENSE_CODE }).first();
  if (!acc) throw new ValidationError(`Suspense account ${SUSPENSE_CODE} is missing from the chart of accounts.`);
  return acc;
}
const glLine = (acc, dr, cr, ref) => ({
  account_id: acc.id, account: acc.name,
  debit: round2(dr), credit: round2(cr),
  narration: `${dr > 0 ? 'DR' : 'CR'} ${acc.code} ${acc.name}${ref ? ` — ${ref}` : ''}`,
});

// ── Create an unidentified receipt/payment sitting in suspense ──
async function create(payload, userId) {
  const { direction, amount, bank_account_id, date, payment_method, reference_no, party_details, reason, entity, attachment_url } = payload || {};
  const amt = round2(amount);
  if (!['receipt', 'payment'].includes(direction)) throw new ValidationError("direction must be 'receipt' or 'payment'.");
  if (!(amt > 0)) throw new ValidationError('amount must be a positive number.');
  if (!bank_account_id) throw new ValidationError('A bank or cash account is required — the money physically sits there until resolved.');
  const when = date || new Date().toISOString().slice(0, 10);

  return db.transaction(async (trx) => {
    const bank = await trx('bank_accounts').where({ id: bank_account_id }).first();
    if (!bank) throw new NotFoundError('Bank/cash account not found.');
    if ((bank.currency || 'PKR') !== 'PKR') throw new ValidationError('Suspense entries are supported for PKR accounts only.');
    const suspense = await suspenseAccount(trx);
    // Bank leg posts to the shared 1000 Cash & Bank control account (same as
    // recordPayment) — bank_accounts has no per-account GL link.
    const cashCoa = await trx('chart_of_accounts').where({ code: '1000' }).first();
    if (!cashCoa) throw new ValidationError('Cash/Bank GL account (1000) is missing — cannot post the suspense entry.');

    const entryNo = await generateEntryNo(trx);
    const isReceipt = direction === 'receipt';

    // Move the real money + record the bank transaction.
    await trx('bank_accounts').where({ id: bank.id }).increment('current_balance', isReceipt ? amt : -amt);
    const [btn] = await trx('bank_transactions').insert({
      transaction_no: await nextBtNo(trx), bank_account_id: bank.id,
      type: isReceipt ? 'credit' : 'debit', amount: amt, currency: 'PKR', status: 'posted',
      transaction_date: when, reference: reference_no || entryNo, counterparty: party_details || null,
      category: 'Suspense', notes: reason || `Suspense ${direction} ${entryNo}`,
      source: 'suspense', created_by: userId || null,
    }).returning('id');

    // Post the GL: receipt ⇒ DR Bank / CR Suspense; payment ⇒ DR Suspense / CR Bank.
    const lines = isReceipt
      ? [glLine(cashCoa, amt, 0, entryNo), glLine(suspense, 0, amt, entryNo)]
      : [glLine(suspense, amt, 0, entryNo), glLine(cashCoa, 0, amt, entryNo)];
    const journal = await accountingService.createJournal(trx, {
      date: when, entity: entity || bank.entity || null, refType: 'Suspense', refNo: entryNo,
      description: `Suspense ${direction} — ${party_details || 'unidentified'}${reason ? ` (${reason})` : ''}`,
      currency: 'PKR', fxRate: 1, isAuto: false, userId, lines,
    });
    await accountingService.postJournal(trx, journal.id);

    const [entry] = await trx('suspense_entries').insert({
      entry_no: entryNo, date: when, entity: entity || bank.entity || null, direction, amount: amt, currency: 'PKR',
      payment_method: payment_method || null, bank_account_id: bank.id, bank_transaction_id: (btn && (btn.id || btn)) || null,
      origin_journal_id: journal.id, reference_no: reference_no || null, party_details: party_details || null,
      reason: reason || null, status: 'Open', resolved_amount: 0, attachment_url: attachment_url || null,
      entered_by: userId || null,
    }).returning('*');
    return entry;
  });
}

// ── Resolve (reclassify) part or all of a suspense entry to real account(s) ──
async function resolve(entryId, payload, userId) {
  const allocations = Array.isArray(payload?.allocations) ? payload.allocations : [];
  if (!allocations.length) throw new ValidationError('At least one allocation is required.');

  return db.transaction(async (trx) => {
    const entry = await trx('suspense_entries').where({ id: entryId }).forUpdate().first();
    if (!entry) throw new NotFoundError('Suspense entry not found.');
    if (['Reversed'].includes(entry.status)) throw new ValidationError(`This entry is ${entry.status} and cannot be resolved.`);

    const suspense = await suspenseAccount(trx);
    const isReceipt = entry.direction === 'receipt';
    const alreadyResolved = round2(entry.resolved_amount);
    const newTotal = allocations.reduce((s, a) => s + round2(a.amount), 0);
    if (!(newTotal > 0)) throw new ValidationError('Allocation amounts must be positive.');
    if (round2(alreadyResolved + newTotal) - round2(entry.amount) > EPSILON) {
      throw new ValidationError(`Allocations exceed the unresolved amount (${round2(entry.amount - alreadyResolved).toFixed(2)} remaining).`);
    }

    for (const a of allocations) {
      const amt = round2(a.amount);
      if (!(amt > 0)) throw new ValidationError('Allocation amounts must be positive.');
      if (!a.account_id) throw new ValidationError('Each allocation needs a target account.');
      const acc = await trx('chart_of_accounts').where({ id: a.account_id }).first();
      if (!acc) throw new ValidationError(`Target account ${a.account_id} not found.`);

      // receipt: DR Suspense / CR target ; payment: DR target / CR Suspense.
      const lines = isReceipt
        ? [glLine(suspense, amt, 0, entry.entry_no), glLine(acc, 0, amt, entry.entry_no)]
        : [glLine(acc, amt, 0, entry.entry_no), glLine(suspense, 0, amt, entry.entry_no)];
      const partyType = ['customer', 'supplier'].includes(a.target_type) ? a.target_type : null;
      const partyId = partyType && /^\d+$/.test(String(a.target_id || '')) ? parseInt(a.target_id, 10) : null;
      const j = await accountingService.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: entry.entity || null,
        refType: 'Suspense Reclass', refNo: entry.entry_no,
        description: `Suspense ${entry.entry_no} reclassified to ${acc.code} ${acc.name}${a.target_ref ? ` — ${a.target_ref}` : ''}`,
        currency: 'PKR', fxRate: 1, isAuto: false, userId, lines,
        partyType, partyId,
      });
      await accountingService.postJournal(trx, j.id);

      await trx('suspense_resolutions').insert({
        suspense_entry_id: entry.id, amount: amt, account_id: acc.id,
        target_type: a.target_type || null, target_id: a.target_id != null ? String(a.target_id) : null,
        target_ref: a.target_ref || null, reclass_journal_id: j.id, narration: a.narration || null,
        created_by: userId || null,
      });
    }

    const resolvedAmount = round2(alreadyResolved + newTotal);
    const fully = round2(entry.amount) - resolvedAmount <= EPSILON;
    await trx('suspense_entries').where({ id: entry.id }).update({
      resolved_amount: resolvedAmount,
      status: fully ? 'Resolved' : 'Partially Resolved',
      resolved_by: fully ? (userId || null) : entry.resolved_by,
      resolved_at: fully ? trx.fn.now() : entry.resolved_at,
      updated_at: trx.fn.now(),
    });
    return trx('suspense_entries').where({ id: entry.id }).first();
  });
}

// ── Reverse a suspense entry: undo the bank move + flip all its journals ──
async function reverse(entryId, reason, userId) {
  return db.transaction(async (trx) => {
    const entry = await trx('suspense_entries').where({ id: entryId }).forUpdate().first();
    if (!entry) throw new NotFoundError('Suspense entry not found.');
    if (entry.status === 'Reversed') throw new ValidationError('This entry is already reversed.');

    // Flip the reclass journals, then the origin journal (Posted → Reversed).
    const resolutions = await trx('suspense_resolutions').where({ suspense_entry_id: entry.id });
    for (const r of resolutions) {
      if (r.reclass_journal_id) {
        await accountingService.reverseJournal(trx, { journalId: r.reclass_journal_id, reason: reason || `Suspense ${entry.entry_no} reversed`, userId });
      }
    }
    if (entry.origin_journal_id) {
      await accountingService.reverseJournal(trx, { journalId: entry.origin_journal_id, reason: reason || `Suspense ${entry.entry_no} reversed`, userId });
    }

    // Undo the real bank movement (receipt added, so now remove — and vice versa).
    if (entry.bank_account_id) {
      const amt = round2(entry.amount);
      const isReceipt = entry.direction === 'receipt';
      await trx('bank_accounts').where({ id: entry.bank_account_id }).increment('current_balance', isReceipt ? -amt : amt);
      await trx('bank_transactions').insert({
        transaction_no: await nextBtNo(trx), bank_account_id: entry.bank_account_id,
        type: isReceipt ? 'debit' : 'credit', amount: amt, currency: 'PKR', status: 'posted',
        transaction_date: new Date().toISOString().slice(0, 10), reference: entry.entry_no,
        counterparty: entry.party_details || null, category: 'Suspense',
        notes: `Reversal of suspense ${entry.entry_no}${reason ? ` — ${reason}` : ''}`,
        source: 'suspense', created_by: userId || null,
      });
    }

    await trx('suspense_entries').where({ id: entry.id }).update({
      status: 'Reversed', resolved_by: userId || null, resolved_at: trx.fn.now(),
      notes: reason ? `${entry.notes ? entry.notes + ' | ' : ''}Reversed: ${reason}` : entry.notes,
      updated_at: trx.fn.now(),
    });
    return trx('suspense_entries').where({ id: entry.id }).first();
  });
}

// ── Flag an entry Under Review (no accounting effect) ──
async function setUnderReview(entryId, userId) {
  const entry = await db('suspense_entries').where({ id: entryId }).first();
  if (!entry) throw new NotFoundError('Suspense entry not found.');
  if (!['Open', 'Partially Resolved'].includes(entry.status)) throw new ValidationError(`Cannot flag a '${entry.status}' entry under review.`);
  await db('suspense_entries').where({ id: entryId }).update({ status: 'Under Review', updated_at: db.fn.now() });
  return db('suspense_entries').where({ id: entryId }).first();
}

async function list(query = {}) {
  const q = db('suspense_entries as s')
    .leftJoin('bank_accounts as b', 's.bank_account_id', 'b.id')
    .leftJoin('users as u', 's.entered_by', 'u.id')
    .select('s.*', 'b.name as bank_account_name', 'u.full_name as entered_by_name')
    .orderBy('s.created_at', 'desc');
  if (query.status) q.where('s.status', query.status);
  if (query.direction) q.where('s.direction', query.direction);
  if (query.bank_account_id) q.where('s.bank_account_id', query.bank_account_id);
  const rows = await q;
  return rows.map((r) => ({ ...r, outstanding: round2(r.amount - r.resolved_amount) }));
}

async function get(entryId) {
  const entry = await db('suspense_entries as s')
    .leftJoin('bank_accounts as b', 's.bank_account_id', 'b.id')
    .leftJoin('users as u', 's.entered_by', 'u.id')
    .leftJoin('users as ru', 's.resolved_by', 'ru.id')
    .select('s.*', 'b.name as bank_account_name', 'u.full_name as entered_by_name', 'ru.full_name as resolved_by_name')
    .where('s.id', entryId).first();
  if (!entry) throw new NotFoundError('Suspense entry not found.');
  const resolutions = await db('suspense_resolutions as r')
    .leftJoin('chart_of_accounts as a', 'r.account_id', 'a.id')
    .leftJoin('journal_entries as j', 'r.reclass_journal_id', 'j.id')
    .select('r.*', 'a.code as account_code', 'a.name as account_name', 'j.journal_no', 'j.status as journal_status')
    .where('r.suspense_entry_id', entryId).orderBy('r.id', 'asc');
  return { ...entry, outstanding: round2(entry.amount - entry.resolved_amount), resolutions };
}

// Dashboard summary — open/under-review count + net suspense balance by direction.
async function summary() {
  const rows = await db('suspense_entries')
    .whereNotIn('status', ['Resolved', 'Reversed'])
    .select('direction')
    .sum({ outstanding: db.raw('amount - resolved_amount') })
    .count({ n: '*' })
    .groupBy('direction');
  const out = { openCount: 0, receiptOutstanding: 0, paymentOutstanding: 0 };
  for (const r of rows) {
    out.openCount += Number(r.n) || 0;
    if (r.direction === 'receipt') out.receiptOutstanding = round2(r.outstanding);
    else out.paymentOutstanding = round2(r.outstanding);
  }
  out.netOutstanding = round2(out.receiptOutstanding + out.paymentOutstanding);
  return out;
}

module.exports = { create, resolve, reverse, setUnderReview, list, get, summary };
