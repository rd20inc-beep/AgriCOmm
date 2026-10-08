const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors');
const { nextDocNo } = require('../../utils/docNumber');
const { assertMillAccount } = require('../../shared/millPayer');
const { glAccountFor, remapControlLines } = require('../../shared/accountGl');

// Money moved between the company's OWN accounts. One table, fund_transfers,
// carries both kinds:
//
// 1. Head Office ⇄ Mill (direction ho_to_mill / mill_to_ho) — two-phase.
//   create()  : the SENDER's money leaves immediately (balance down + bank_txn +
//               the sender entity's inter-company journal). status = 'pending'.
//   accept()  : the RECEIVER confirms; their account is credited (balance up +
//               bank_txn + the receiver entity's journal). status = 'completed'.
//   Each entity's journal balances on its own and is linked by 1130
//   Inter-Company Receivable — Mill, with cash on each account's own GL
//   (G-8: every cash / bank account has one, under 1000). So between send and
//   accept the funds sit "in transit" (the sender's 1130 advance), and the
//   receiver only sees the cash once it accepts.
//
// 2. Contra transfer (direction 'internal', migration 319) — both accounts
//   belong to the SAME entity (Cash → Bank, Bank → Cash, Bank A → Bank B, USD
//   bank → PKR cash ...). It settles at once: one transaction locks both
//   accounts, debits the source and credits the destination, each in its OWN
//   currency, and the transfer is 'completed' (no accept step).
//   Each account has its own GL account (G-8), so the transfer posts ONE journal
//   Dr destination-account GL / Cr source-account GL, in PKR (amount_pkr),
//   ref_type 'Fund Transfer', ref_no = transfer_no — reverse() mirrors it by
//   signed delta like any other transfer journal. (Two accounts still sharing
//   one GL — an unmapped pair on the 1000 fallback — post nothing: Dr X / Cr X
//   is noise.) The operational record is the fund_transfers row plus its two
//   bank_transactions rows (source 'fund_transfer', reference =
//   transfer_no, fund_transfer_id = the transfer). Nothing is written to
//   `payments`, so Money In / Money Out, payment history and the printable
//   cash flow never see it — it is not a receipt or a payment.
//   A cross-currency contra (USD → PKR) moves each account by its own amount
//   and posts NO FX gain/loss: fx_unbooked = true flags it for review (the
//   journal moves the PKR received; month-end revaluation restates the USD
//   account). Optional bank charges are a real expense: an extra debit row on
//   the SOURCE account (category 'Bank Charges') and a journal Dr 6200 / Cr the
//   source account's GL, in PKR.
//
//   createContra() picks the kind from the two accounts: same entity →
//   internal; Head Office ⇄ Mill → the two-phase flow above (awaits the
//   receiving side's acceptance).
//
// reverse() : undo any state with equal-and-opposite bank moves and signed-delta
//             journals. status = 'reversed' (the row is kept).
// replace() : an EDIT — reverse the original and create the corrected transfer
//             in one transaction, linked replaces_id / replaced_by_id. Amounts
//             are never updated in place.

const ENTITY_LABEL = { general: 'Head Office', mill: 'Mill', export: 'Export' };
const DIRECTIONS = {
  ho_to_mill: { from: 'general', to: 'mill' },
  mill_to_ho: { from: 'mill', to: 'general' },
};
const CROSS_ENTITY_DIRECTION = { 'general>mill': 'ho_to_mill', 'mill>general': 'mill_to_ho' };

const CATEGORY = {
  fund: 'Fund Transfer',
  fundReversal: 'Fund Transfer Reversal',
  contra: 'Contra Transfer',
  contraReversal: 'Contra Transfer Reversal',
  charges: 'Bank Charges',
  chargesReversal: 'Bank Charges Reversal',
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const curOf = (acc) => String((acc && acc.currency) || 'PKR').toUpperCase();
const entityOf = (acc) => String((acc && acc.entity) || 'general').toLowerCase();
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const todayIso = () => new Date().toISOString().slice(0, 10);

// FT- and BT- numbers are MAX(suffix)+1 (utils/docNumber), not "the last row
// by id + 1", which repeats a number after a delete or under two concurrent
// transfers and then fails on the unique index. Same FT-NNNN / BT-NNNN shape.
function generateTransferNo(trx) {
  return nextDocNo(trx, { table: 'fund_transfers', column: 'transfer_no', prefix: 'FT-', pad: 4 });
}
function nextBtNo(trx) {
  return nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
}

// ── Amount / currency rules for a contra (pure, unit-tested) ─────────────────
// fx_rate is always quoted the market way: PKR per 1 unit of the foreign
// currency (USD→PKR @ 280), whichever side the foreign currency is on:
//   foreign → PKR : to_amount = amount × rate
//   PKR → foreign : to_amount = amount ÷ rate
//   same currency : to_amount = amount (a rate is optional — only used to value
//                   a non-PKR transfer / its bank charges in PKR)
// Two different foreign currencies (USD → EUR) are refused: there is no single
// PKR rate to quote.
// A converted amount the user typed is accepted when it is within
//   0.01 + 1 ppm of the expected figure (destination units)
// — a cent for rounding, plus room for a rate that was back-computed from the
// converted amount and rounded to 6 decimals.
function fxTolerance(expected) {
  return 0.01 + Math.abs(Number(expected) || 0) * 1e-6;
}

function computeContraAmounts({ fromCurrency, toCurrency, amount, toAmount, fxRate }) {
  const src = String(fromCurrency || 'PKR').toUpperCase();
  const dst = String(toCurrency || 'PKR').toUpperCase();
  const amt = Number(amount);
  if (!(amt > 0)) throw new ValidationError('Amount must be greater than zero.');
  const rate = fxRate == null || fxRate === '' ? null : Number(fxRate);
  if (rate != null && !(rate > 0)) throw new ValidationError('Exchange rate must be greater than zero.');

  if (src === dst) {
    const amountPkr = src === 'PKR' ? round2(amt) : (rate ? round2(amt * rate) : null);
    return { toAmount: round2(amt), toCurrency: dst, fxRate: src === 'PKR' ? null : rate, amountPkr, fxUnbooked: false, foreign: src === 'PKR' ? null : src };
  }
  if (src !== 'PKR' && dst !== 'PKR') {
    throw new ValidationError(`Transfers between two foreign currencies (${src} → ${dst}) are not supported — go through a PKR account.`);
  }
  if (!rate) throw new ValidationError(`An exchange rate is required to move ${src} into a ${dst} account.`);
  const foreign = src === 'PKR' ? dst : src;
  const expected = src === 'PKR' ? amt / rate : amt * rate;
  let to = round2(expected);
  if (toAmount != null && toAmount !== '') {
    const given = Number(toAmount);
    if (!(given > 0)) throw new ValidationError('Converted amount must be greater than zero.');
    if (Math.abs(given - expected) > fxTolerance(expected)) {
      throw new ValidationError(`Converted amount ${given} ${dst} does not match ${amt} ${src} at ${rate} (expected ${round2(expected)} ${dst}).`);
    }
    to = round2(given);
  }
  const amountPkr = src === 'PKR' ? round2(amt) : to;
  return { toAmount: to, toCurrency: dst, fxRate: rate, amountPkr, fxUnbooked: true, foreign };
}

function conflict(message, existing) {
  const e = new ConflictError(message);
  if (existing) e.existing = existing;
  return e;
}

// Post ONE entity's half of a Head Office ⇄ Mill transfer. cashIn ⇒ DR cash /
// CR inter-company; otherwise CR cash / DR inter-company (the sender advanced funds).
// `account` is the bank account that moved — its own GL carries the cash line.
async function postEntityBook(trx, { transferNo, entity, cashIn, amount, date, userId, description, account }) {
  const [cash, ic] = await Promise.all([
    glAccountFor(trx, account || null),
    trx('chart_of_accounts').where({ code: '1130' }).first(),
  ]);
  if (!cash || !ic) throw new ValidationError('GL accounts 1000 / 1130 are missing — cannot post the fund transfer.');
  const line = (acc, dr, cr) => ({ account_id: acc.id, account: acc.name, debit: dr, credit: cr, narration: `${dr > 0 ? 'DR' : 'CR'} ${acc.code} ${acc.name} — ${transferNo}` });
  const lines = cashIn ? [line(cash, amount, 0), line(ic, 0, amount)] : [line(ic, amount, 0), line(cash, 0, amount)];
  const j = await accountingService.createJournal(trx, {
    date, entity, refType: 'Fund Transfer', refNo: transferNo,
    description, currency: 'PKR', fxRate: 1, isAuto: true, userId, lines,
  });
  if (j?.id) await accountingService.postJournal(trx, j.id);
}

// Bank charges on a transfer: Dr 6200 Bank Charges / Cr the source account's
// GL, in PKR. ref_type 'Fund Transfer' + ref_no transfer_no so reverse() finds it with
// the transfer's other journals and mirrors it by signed delta. A foreign
// source keeps its native figure as orig_currency / orig_fx_rate.
async function postBankChargesJournal(trx, { transferNo, entity, amountPkr, origCurrency, origFxRate, date, userId, description, account }) {
  const [fee, cash] = await Promise.all([
    trx('chart_of_accounts').where({ code: '6200' }).first(),
    glAccountFor(trx, account || null),
  ]);
  if (!fee || !cash) throw new ValidationError('GL accounts 6200 / 1000 are missing — cannot post the bank charges.');
  const j = await accountingService.createJournal(trx, {
    date, entity, refType: 'Fund Transfer', refNo: transferNo, description,
    currency: 'PKR', fxRate: 1, isAuto: true, userId,
    origCurrency: origCurrency && origCurrency !== 'PKR' ? origCurrency : null,
    origFxRate: origCurrency && origCurrency !== 'PKR' ? origFxRate : null,
    lines: [
      { account_id: fee.id, account: fee.name, debit: amountPkr, credit: 0, narration: `DR ${fee.code} ${fee.name} — ${transferNo}` },
      { account_id: cash.id, account: cash.name, debit: 0, credit: amountPkr, narration: `CR ${cash.code} ${cash.name} — ${transferNo}` },
    ],
  });
  if (j?.id) await accountingService.postJournal(trx, j.id);
  return j;
}

// The contra itself: Dr the destination account's GL / Cr the source
// account's GL, in PKR (amount_pkr: the PKR moved, or the foreign amount at the
// transfer rate). Nothing when both accounts share one GL (both unmapped).
async function postContraJournal(trx, { transferNo, entity, fromAcc, toAcc, amountPkr, origCurrency, origFxRate, date, userId, description }) {
  const [src, dst] = await Promise.all([glAccountFor(trx, fromAcc), glAccountFor(trx, toAcc)]);
  if (!src || !dst) throw new ValidationError('GL account 1000 Cash & Bank is missing — cannot post the contra transfer.');
  if (String(src.id) === String(dst.id)) return null;
  const pkr = round2(amountPkr);
  if (!(pkr > 0)) throw new ValidationError(`An exchange rate is needed to book this ${curOf(fromAcc)} transfer in PKR.`);
  const j = await accountingService.createJournal(trx, {
    date, entity, refType: 'Fund Transfer', refNo: transferNo, description,
    currency: 'PKR', fxRate: 1, isAuto: true, userId,
    origCurrency: origCurrency && origCurrency !== 'PKR' ? origCurrency : null,
    origFxRate: origCurrency && origCurrency !== 'PKR' ? origFxRate : null,
    lines: [
      { account_id: dst.id, account: dst.name, debit: pkr, credit: 0, narration: `DR ${dst.code} ${dst.name} — ${transferNo}` },
      { account_id: src.id, account: src.name, debit: 0, credit: pkr, narration: `CR ${src.code} ${src.name} — ${transferNo}` },
    ],
  });
  if (j?.id) await accountingService.postJournal(trx, j.id);
  return j;
}

async function writeBankTxn(trx, {
  account, type, amount, date, transferNo, counterpartyName, noteLine, userId,
  category = CATEGORY.fund, currency, fundTransferId = null,
}) {
  await trx('bank_transactions').insert({
    transaction_no: await nextBtNo(trx), bank_account_id: account.id, type,
    amount, currency: currency || curOf(account), status: 'posted', transaction_date: date,
    reference: transferNo, counterparty: counterpartyName, category,
    notes: noteLine, source: 'fund_transfer', fund_transfer_id: fundTransferId,
    created_by: userId || null,
  });
}

// Move the bank charges out of the source account: a 'Bank Charges' debit row
// (linked to the transfer) + the 6200 journal. `charges` is in the SOURCE
// account's currency; chargesPkr is its PKR value.
async function takeBankCharges(trx, { fromAcc, charges, chargesPkr, rate, transfer, date, userId }) {
  if (!(charges > 0)) return;
  await trx('bank_accounts').where({ id: fromAcc.id }).decrement('current_balance', charges);
  const desc = `Bank charges on ${transfer.transfer_no} (${fromAcc.name})`;
  await writeBankTxn(trx, {
    account: fromAcc, type: 'debit', amount: charges, date, transferNo: transfer.transfer_no,
    counterpartyName: 'Bank charges', noteLine: desc, userId, category: CATEGORY.charges,
    fundTransferId: transfer.id,
  });
  await postBankChargesJournal(trx, {
    transferNo: transfer.transfer_no, entity: entityOf(fromAcc), amountPkr: chargesPkr,
    origCurrency: curOf(fromAcc), origFxRate: rate, date, userId, description: desc, account: fromAcc,
  });
}

// Lock both accounts, always in id order (two transfers in opposite directions
// must not deadlock).
async function lockAccounts(trx, ids) {
  const rows = await trx('bank_accounts').whereIn('id', ids).orderBy('id', 'asc').forUpdate();
  const byId = {};
  for (const r of rows || []) byId[String(r.id)] = r;
  return ids.map((id) => byId[String(id)] || null);
}

// ── Head Office ⇄ Mill: the sender half (shared by create + createContra) ─────
async function createCrossEntityInTrx(trx, { direction, fromAcc, toAcc, amt, date, method, reference, notes, userId, extra = {} }) {
  if (curOf(fromAcc) !== 'PKR' || curOf(toAcc) !== 'PKR') {
    throw new ValidationError('Head Office ⇄ Mill transfers currently support PKR accounts only.');
  }
  const { from: fromEntity, to: toEntity } = DIRECTIONS[direction];
  const transferNo = await generateTransferNo(trx);
  const desc = `Fund transfer ${transferNo}: ${ENTITY_LABEL[fromEntity]} → ${ENTITY_LABEL[toEntity]} (${fromAcc.name} → ${toAcc.name})`;
  const noteLine = [desc, reference ? `Ref: ${reference}` : null, notes].filter(Boolean).join(' · ');

  const [row] = await trx('fund_transfers').insert({
    transfer_no: transferNo, direction, from_entity: fromEntity, to_entity: toEntity,
    from_account_id: fromAcc.id, to_account_id: toAcc.id, amount: amt, currency: 'PKR',
    to_amount: amt, to_currency: 'PKR', amount_pkr: amt,
    transfer_date: date, method: method || 'cash', reference: reference || null, notes: notes || null,
    status: 'pending', je_ref_no: transferNo, created_by: userId || null,
    ...extra,
  }).returning('*');

  // SENDER side only — money leaves now; the receiver accepts to take it in.
  await trx('bank_accounts').where({ id: fromAcc.id }).decrement('current_balance', amt);
  await writeBankTxn(trx, { account: fromAcc, type: 'debit', amount: amt, date, transferNo, counterpartyName: toAcc.name, noteLine, userId, fundTransferId: row.id });
  await postEntityBook(trx, { transferNo, entity: fromEntity, cashIn: false, amount: amt, date, userId, description: desc, account: fromAcc });
  return row;
}

async function create(payload, userId) {
  const { direction, from_account_id, to_account_id, amount, transfer_date, method, reference, notes } = payload || {};
  const amt = parseFloat(amount);
  if (!DIRECTIONS[direction]) throw new ValidationError("direction must be 'ho_to_mill' or 'mill_to_ho'.");
  if (!(amt > 0)) throw new ValidationError('amount must be a positive number.');
  if (!from_account_id || !to_account_id) throw new ValidationError('from and to accounts are required.');
  if (Number(from_account_id) === Number(to_account_id)) throw new ValidationError('from and to accounts must be different.');

  const date = transfer_date || todayIso();

  return db.transaction(async (trx) => {
    const [fromAcc, toAcc] = await Promise.all([
      trx('bank_accounts').where({ id: from_account_id }).first(),
      trx('bank_accounts').where({ id: to_account_id }).first(),
    ]);
    if (!fromAcc || !toAcc) throw new NotFoundError('Bank account not found.');
    return createCrossEntityInTrx(trx, { direction, fromAcc, toAcc, amt, date, method, reference, notes, userId });
  });
}

// ── Contra transfer ──────────────────────────────────────────────────────────
// payload: from_account_id, to_account_id, amount, currency (must equal the
// source account's), to_amount / to_currency (destination), fx_rate,
// rate_date, bank_charges (source currency), transfer_date, method, reference
// (required), notes, attachment_url / attachment_name, client_ref (uuid).
// opts.millOnly: the caller came in on milling.edit only — both accounts must
// be the mill's own. opts.replacesId: set by replace().
async function createContraInTrx(trx, payload, userId, { millOnly = false, replacesId = null, defaultRate = null } = {}) {
  const p = payload || {};
  const fromId = Number(p.from_account_id);
  const toId = Number(p.to_account_id);
  const amt = round2(parseFloat(p.amount));
  const charges = round2(parseFloat(p.bank_charges) || 0);
  const reference = p.reference != null ? String(p.reference).trim() : '';
  const date = isoDate(p.transfer_date) || todayIso();

  if (!fromId || !toId) throw new ValidationError('Choose both the From and the To account.');
  if (fromId === toId) throw new ValidationError('From and To must be different accounts.');
  if (!(amt > 0)) throw new ValidationError('Amount must be greater than zero.');
  if (charges < 0) throw new ValidationError('Bank charges cannot be negative.');
  if (!reference) throw new ValidationError('Reference / transaction number is required.');

  if (p.client_ref) {
    const existing = await trx('fund_transfers').where({ client_ref: p.client_ref }).first();
    if (existing) throw conflict(`This transfer was already recorded as ${existing.transfer_no}.`, existing);
  }

  const [fromAcc, toAcc] = await lockAccounts(trx, [fromId, toId]);
  if (!fromAcc || !toAcc) throw new NotFoundError('Bank account not found.');
  if (fromAcc.is_active === false || toAcc.is_active === false) throw new ValidationError('Both accounts must be active.');
  if (millOnly) {
    await assertMillAccount(trx, fromAcc.id);
    await assertMillAccount(trx, toAcc.id);
  }

  const srcCur = curOf(fromAcc);
  const dstCur = curOf(toAcc);
  if (p.currency && String(p.currency).toUpperCase() !== srcCur) {
    throw new ValidationError(`${fromAcc.name} holds ${srcCur} — the amount must be in ${srcCur}, not ${String(p.currency).toUpperCase()}.`);
  }
  if (p.to_currency && String(p.to_currency).toUpperCase() !== dstCur) {
    throw new ValidationError(`${toAcc.name} holds ${dstCur} — the converted amount must be in ${dstCur}, not ${String(p.to_currency).toUpperCase()}.`);
  }

  const available = round2(parseFloat(fromAcc.current_balance) || 0);
  if (available + 0.005 < amt + charges) {
    throw conflict(`Insufficient balance in ${fromAcc.name}: ${available.toFixed(2)} ${srcCur} available, ${round2(amt + charges).toFixed(2)} ${srcCur} needed${charges > 0 ? ' (amount + bank charges)' : ''}.`);
  }

  const fromEntity = entityOf(fromAcc);
  const toEntity = entityOf(toAcc);
  const common = {
    attachment_url: p.attachment_url || null,
    attachment_name: p.attachment_name || null,
    client_ref: p.client_ref || null,
    replaces_id: replacesId,
    updated_by: replacesId ? (userId || null) : null,
  };

  // ── Head Office ⇄ Mill: hand over to the two-phase flow ──
  if (fromEntity !== toEntity) {
    const direction = CROSS_ENTITY_DIRECTION[`${fromEntity}>${toEntity}`];
    if (!direction) {
      throw new ValidationError(`Moving money from ${ENTITY_LABEL[fromEntity] || fromEntity} to ${ENTITY_LABEL[toEntity] || toEntity} is not supported — only accounts of the same entity, or Head Office ⇄ Mill.`);
    }
    const row = await createCrossEntityInTrx(trx, {
      direction, fromAcc, toAcc, amt, date, method: p.method, reference, notes: p.notes, userId,
      extra: { ...common, bank_charges: charges },
    });
    await takeBankCharges(trx, { fromAcc, charges, chargesPkr: charges, rate: null, transfer: row, date, userId });
    return row;
  }

  // ── Same entity: internal contra, settles now ──
  let rate = p.fx_rate == null || p.fx_rate === '' ? null : Number(p.fx_rate);
  let rateSource = rate ? 'manual' : null;
  // A foreign account moving within its own currency needs a PKR rate only to
  // value it (amount_pkr) and its bank charges — default it from fx_rates.
  if (!rate && srcCur === dstCur && srcCur !== 'PKR' && defaultRate) {
    const r = await defaultRate(srcCur, date);
    if (r && r.rate > 0) { rate = r.rate; rateSource = r.source || 'fx_rates'; }
  }
  const calc = computeContraAmounts({ fromCurrency: srcCur, toCurrency: dstCur, amount: amt, toAmount: p.to_amount, fxRate: rate });
  const rateDate = isoDate(p.rate_date) || date;
  if (rateSource === 'manual' && defaultRate && calc.foreign) {
    const sys = await defaultRate(calc.foreign, rateDate).catch(() => null);
    if (sys && Math.abs(Number(sys.rate) - Number(calc.fxRate)) < 1e-9) rateSource = 'system rate';
  }
  const rateBasis = calc.foreign && calc.fxRate
    ? `${calc.foreign}→PKR @ ${Number(calc.fxRate)} on ${rateDate}${rateSource ? ` (${rateSource})` : ''}`
    : null;

  const transferNo = await generateTransferNo(trx);
  const fmtAmt = (n, c) => `${c} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const desc = `Contra ${transferNo}: ${fromAcc.name} → ${toAcc.name}`;
  const noteLine = [desc, `Ref: ${reference}`, p.notes].filter(Boolean).join(' · ');

  const [row] = await trx('fund_transfers').insert({
    transfer_no: transferNo, direction: 'internal', from_entity: fromEntity, to_entity: toEntity,
    from_account_id: fromAcc.id, to_account_id: toAcc.id,
    amount: amt, currency: srcCur, to_amount: calc.toAmount, to_currency: calc.toCurrency,
    fx_rate: calc.fxRate, rate_basis: rateBasis, rate_date: calc.foreign ? rateDate : null,
    amount_pkr: calc.amountPkr, bank_charges: charges, fx_unbooked: calc.fxUnbooked,
    transfer_date: date, method: p.method || 'bank_transfer', reference, notes: p.notes || null,
    status: 'completed', accepted_at: trx.fn.now(), accepted_by: userId || null,
    je_ref_no: null, created_by: userId || null,
    ...common,
  }).returning('*');

  await trx('bank_accounts').where({ id: fromAcc.id }).decrement('current_balance', amt);
  await writeBankTxn(trx, {
    account: fromAcc, type: 'debit', amount: amt, date, transferNo, counterpartyName: toAcc.name,
    noteLine: calc.foreign && srcCur !== dstCur ? `${noteLine} · ${fmtAmt(calc.toAmount, dstCur)} received` : noteLine,
    userId, category: CATEGORY.contra, currency: srcCur, fundTransferId: row.id,
  });
  await trx('bank_accounts').where({ id: toAcc.id }).increment('current_balance', calc.toAmount);
  await writeBankTxn(trx, {
    account: toAcc, type: 'credit', amount: calc.toAmount, date, transferNo, counterpartyName: fromAcc.name,
    noteLine: calc.foreign && srcCur !== dstCur ? `${noteLine} · from ${fmtAmt(amt, srcCur)}` : noteLine,
    userId, category: CATEGORY.contra, currency: dstCur, fundTransferId: row.id,
  });

  const journal = await postContraJournal(trx, {
    transferNo, entity: fromEntity, fromAcc, toAcc, amountPkr: calc.amountPkr,
    origCurrency: calc.foreign, origFxRate: calc.fxRate, date, userId, description: desc,
  });
  let out = row;
  if (journal) {
    [out] = await trx('fund_transfers').where({ id: row.id }).update({ je_ref_no: transferNo }).returning('*');
  }

  if (charges > 0) {
    let chargeRate = srcCur === 'PKR' ? 1 : calc.fxRate;
    if (!chargeRate && defaultRate) {
      const r = await defaultRate(srcCur, date);
      chargeRate = r && r.rate > 0 ? r.rate : null;
    }
    if (!chargeRate) throw new ValidationError(`An exchange rate is needed to book ${srcCur} bank charges in PKR.`);
    await takeBankCharges(trx, { fromAcc, charges, chargesPkr: round2(charges * chargeRate), rate: srcCur === 'PKR' ? null : chargeRate, transfer: row, date, userId });
  }
  return out;
}

function systemRate(currency, date) {
  return require('./fxRate.service').getRateForDate(currency, date);
}

async function createContra(payload, userId, opts = {}) {
  try {
    return await db.transaction((trx) => createContraInTrx(trx, payload, userId, { defaultRate: systemRate, ...opts }));
  } catch (e) {
    // Two identical submissions racing past the client_ref check: the unique
    // index stops the second — answer it like the sequential case.
    if (e && e.code === '23505' && /client_ref/.test(String(e.constraint || e.detail || e.message)) && payload?.client_ref) {
      const existing = await db('fund_transfers').where({ client_ref: payload.client_ref }).first();
      throw conflict(`This transfer was already recorded as ${existing ? existing.transfer_no : 'another transfer'}.`, existing);
    }
    throw e;
  }
}

// The receiver confirms receipt: credit their account + post their journal.
async function accept(id, userId) {
  return db.transaction(async (trx) => {
    // Locked: two accepts of the same transfer must not both see 'pending'
    // and both credit the receiver.
    const t = await trx('fund_transfers').where({ id }).forUpdate().first();
    if (!t) throw new NotFoundError('Fund transfer not found.');
    if (t.status !== 'pending') throw new ValidationError(`Transfer ${t.transfer_no} is already ${t.status}.`);
    const toAcc = await trx('bank_accounts').where({ id: t.to_account_id }).first();
    if (!toAcc) throw new NotFoundError('Destination account not found.');
    const fromAcc = await trx('bank_accounts').where({ id: t.from_account_id }).first();
    const amt = parseFloat(t.amount) || 0;
    const desc = `Fund transfer ${t.transfer_no} received by ${ENTITY_LABEL[t.to_entity]}`;
    const noteLine = `${desc}${t.reference ? ` · Ref: ${t.reference}` : ''}`;

    await trx('bank_accounts').where({ id: toAcc.id }).increment('current_balance', amt);
    await writeBankTxn(trx, { account: toAcc, type: 'credit', amount: amt, date: todayIso(), transferNo: t.transfer_no, counterpartyName: fromAcc ? fromAcc.name : ENTITY_LABEL[t.from_entity], noteLine, userId, fundTransferId: t.id });
    await postEntityBook(trx, { transferNo: t.transfer_no, entity: t.to_entity, cashIn: true, amount: amt, date: todayIso(), userId, description: desc, account: toAcc });

    const [row] = await trx('fund_transfers').where({ id }).update({
      status: 'completed', accepted_at: trx.fn.now(), accepted_by: userId || null, updated_at: trx.fn.now(),
    }).returning('*');
    return row;
  });
}

// Reverse a transfer (pending or completed, either kind). Nothing is deleted:
// the transfer row stays, marked 'reversed', and every move it made is undone
// by an equal-and-opposite one, so the history reads send -> (accept) -> reverse.
//   GL   : each POSTED journal it made (the sender's at create, the receiver's
//          at accept, the bank-charges journal) gets a signed-delta journal with
//          debit and credit swapped, same entity, ref_type 'Fund Transfer
//          Reversal', ref_no = transfer_no. The originals stay Posted: the TB
//          is Posted-only, so original + delta nets to zero. (Never
//          reverse+repost, and never also flip the original to 'Reversed':
//          that would move the books by -2x.) An internal contra's own journal
//          (Dr destination GL / Cr source GL) is mirrored the same way.
//   Bank : the sender gets the money back (balance up + a 'credit' row, in its
//          own currency) plus any bank charges (a separate 'Bank Charges
//          Reversal' credit); if the receiver had been credited (completed),
//          its to_amount comes back out (balance down + a 'debit' row). Rows
//          are BT-numbered, source 'fund_transfer', reference = transfer_no,
//          fund_transfer_id = the transfer.
// A pending transfer has already moved the sender's money and posted the
// sender's journal (see create), so it is reversed the same way, just without
// a receiver side. Reversing twice is refused (409).
async function reverseInTrx(trx, id, userId, { reason } = {}) {
  const t = await trx('fund_transfers').where({ id }).forUpdate().first();
  if (!t) throw new NotFoundError('Fund transfer not found.');
  if (t.status === 'reversed') {
    throw conflict(`Transfer ${t.transfer_no} is already reversed.`);
  }
  const internal = t.direction === 'internal';
  const amt = parseFloat(t.amount) || 0;
  const toAmt = t.to_amount != null ? (parseFloat(t.to_amount) || 0) : amt;
  const charges = parseFloat(t.bank_charges) || 0;
  const date = todayIso();
  const why = reason ? ` - ${String(reason).slice(0, 200)}` : '';
  const desc = `Reversal of ${internal ? 'contra' : 'fund'} transfer ${t.transfer_no}${why}`;
  const revCategory = internal ? CATEGORY.contraReversal : CATEGORY.fundReversal;

  const fromAcc = t.from_account_id ? await trx('bank_accounts').where({ id: t.from_account_id }).first() : null;
  const toAcc = t.to_account_id ? await trx('bank_accounts').where({ id: t.to_account_id }).first() : null;

  // Bank: the sender's money always left at create, so give it back.
  if (fromAcc) {
    await trx('bank_accounts').where({ id: fromAcc.id }).increment('current_balance', amt);
    await writeBankTxn(trx, {
      account: fromAcc, type: 'credit', amount: amt, date, transferNo: t.transfer_no,
      counterpartyName: toAcc ? toAcc.name : ENTITY_LABEL[t.to_entity], noteLine: desc, userId,
      category: revCategory, currency: t.currency || curOf(fromAcc), fundTransferId: t.id,
    });
    if (charges > 0) {
      await trx('bank_accounts').where({ id: fromAcc.id }).increment('current_balance', charges);
      await writeBankTxn(trx, {
        account: fromAcc, type: 'credit', amount: charges, date, transferNo: t.transfer_no,
        counterpartyName: 'Bank charges', noteLine: `${desc} (bank charges)`, userId,
        category: CATEGORY.chargesReversal, currency: t.currency || curOf(fromAcc), fundTransferId: t.id,
      });
    }
  }
  // The receiver was only credited once it accepted (an internal contra is
  // completed at create), so take it back only then.
  if (t.status === 'completed' && toAcc) {
    await trx('bank_accounts').where({ id: toAcc.id }).decrement('current_balance', toAmt);
    await writeBankTxn(trx, {
      account: toAcc, type: 'debit', amount: toAmt, date, transferNo: t.transfer_no,
      counterpartyName: fromAcc ? fromAcc.name : ENTITY_LABEL[t.from_entity], noteLine: desc, userId,
      category: revCategory, currency: t.to_currency || curOf(toAcc), fundTransferId: t.id,
    });
  }

  // GL: a signed delta for every journal this transfer POSTED.
  const posted = await trx('journal_entries')
    .where({ ref_type: 'Fund Transfer', ref_no: t.transfer_no, status: 'Posted' })
    .orderBy('id', 'asc')
    .select('id', 'journal_no', 'entity', 'orig_currency', 'orig_fx_rate');
  const reversalJournalIds = [];
  for (const j of posted) {
    let lines = await trx('journal_lines').where({ journal_id: j.id }).orderBy('id', 'asc')
      .select('account_id', 'account', 'debit', 'credit');
    if (!lines.length) continue;
    // A journal posted on the 1000 control account before per-account GL:
    // money out (credit) was the source account's, money in the destination's.
    lines = await remapControlLines(trx, lines, (l) => ((parseFloat(l.credit) || 0) > 0 ? t.from_account_id : t.to_account_id));
    const delta = await accountingService.createJournal(trx, {
      date, entity: j.entity, refType: 'Fund Transfer Reversal', refNo: t.transfer_no,
      description: `${desc} (reverses ${j.journal_no || `journal #${j.id}`})`,
      currency: 'PKR', fxRate: 1, isAuto: true, userId,
      origCurrency: j.orig_currency || null, origFxRate: j.orig_fx_rate || null,
      lines: lines.map((l) => ({
        account_id: l.account_id, account: l.account,
        debit: parseFloat(l.credit) || 0, credit: parseFloat(l.debit) || 0,
        narration: `Reversal - ${t.transfer_no}`,
      })),
    });
    if (delta?.id) await accountingService.postJournal(trx, delta.id);
    reversalJournalIds.push(delta?.id || null);
  }

  const [row] = await trx('fund_transfers').where({ id }).update({
    status: 'reversed',
    notes: [t.notes, `Reversed ${date}${userId ? ` by user #${userId}` : ''}${why}`].filter(Boolean).join(' · '),
    reversed_by: userId || null,
    reversed_at: trx.fn.now(),
    reversal_reason: reason ? String(reason).slice(0, 2000) : null,
    updated_by: userId || null,
    updated_at: trx.fn.now(),
  }).returning('*');
  return { transfer: row, reversed: true, transfer_no: t.transfer_no, reversal_journal_ids: reversalJournalIds };
}

async function reverse(id, userId, opts = {}) {
  return db.transaction((trx) => reverseInTrx(trx, id, userId, opts));
}

// EDIT = reverse + replace, atomically. The original is reversed (both sides,
// signed-delta journals where it had any) and the corrected transfer is
// created from `payload`; replaces_id / replaced_by_id link the pair and both
// stay in history. Amounts are never changed in place.
async function replace(id, payload, userId, { reason } = {}) {
  if (!reason || !String(reason).trim()) throw new ValidationError('A reason is required to edit a transfer.');
  try {
    return await db.transaction(async (trx) => {
      const t = await trx('fund_transfers').where({ id }).forUpdate().first();
      if (!t) throw new NotFoundError('Fund transfer not found.');
      if (t.status === 'reversed') throw conflict(`Transfer ${t.transfer_no} is already reversed — it cannot be edited.`);
      const why = `Edited: ${String(reason).trim()}`;
      const reversal = await reverseInTrx(trx, id, userId, { reason: why });
      const replacement = await createContraInTrx(trx, payload, userId, { replacesId: t.id, defaultRate: systemRate });
      const [original] = await trx('fund_transfers').where({ id }).update({
        replaced_by_id: replacement.id, updated_by: userId || null, updated_at: trx.fn.now(),
      }).returning('*');
      return { original, transfer: replacement, reversal_journal_ids: reversal.reversal_journal_ids };
    });
  } catch (e) {
    if (e && e.code === '23505' && /client_ref/.test(String(e.constraint || e.detail || e.message)) && payload?.client_ref) {
      const existing = await db('fund_transfers').where({ client_ref: payload.client_ref }).first();
      throw conflict(`This edit was already recorded as ${existing ? existing.transfer_no : 'another transfer'}.`, existing);
    }
    throw e;
  }
}

function baseQuery() {
  return db('fund_transfers as ft')
    .leftJoin('bank_accounts as fa', 'fa.id', 'ft.from_account_id')
    .leftJoin('bank_accounts as ta', 'ta.id', 'ft.to_account_id')
    .leftJoin('users as u', 'u.id', 'ft.created_by')
    .leftJoin('users as au', 'au.id', 'ft.accepted_by')
    .leftJoin('users as ru', 'ru.id', 'ft.reversed_by')
    .leftJoin('users as uu', 'uu.id', 'ft.updated_by')
    .leftJoin('fund_transfers as rp', 'rp.id', 'ft.replaces_id')
    .leftJoin('fund_transfers as rb', 'rb.id', 'ft.replaced_by_id')
    .select(
      'ft.*',
      'fa.name as from_account_name', 'fa.currency as from_account_currency', 'fa.entity as from_account_entity', 'fa.type as from_account_type',
      'ta.name as to_account_name', 'ta.currency as to_account_currency', 'ta.entity as to_account_entity', 'ta.type as to_account_type',
      'u.full_name as created_by_name', 'au.full_name as accepted_by_name',
      'ru.full_name as reversed_by_name', 'uu.full_name as updated_by_name',
      'rp.transfer_no as replaces_transfer_no', 'rb.transfer_no as replaced_by_transfer_no',
    );
}

async function list({ entity, to_entity, from_entity, direction, status, from, to, limit = 100 } = {}) {
  let q = baseQuery().orderBy('ft.transfer_date', 'desc').orderBy('ft.id', 'desc');
  if (entity) q = q.where(function () { this.where('ft.from_entity', entity).orWhere('ft.to_entity', entity); });
  if (to_entity) q = q.where('ft.to_entity', to_entity);
  if (from_entity) q = q.where('ft.from_entity', from_entity);
  if (direction) q = q.where('ft.direction', direction);
  if (status) q = q.where('ft.status', status);
  if (from) q = q.where('ft.transfer_date', '>=', from);
  if (to) q = q.where('ft.transfer_date', '<=', to);
  return q.limit(Math.min(parseInt(limit, 10) || 100, 500));
}

// One transfer with both sides' bank rows and its journals — the detail drawer.
async function getById(id) {
  const t = await baseQuery().where('ft.id', id).first();
  if (!t) throw new NotFoundError('Fund transfer not found.');
  const [bankTransactions, journals] = await Promise.all([
    db('bank_transactions as bt')
      .leftJoin('bank_accounts as ba', 'ba.id', 'bt.bank_account_id')
      .where('bt.fund_transfer_id', t.id)
      .orderBy('bt.id', 'asc')
      .select('bt.id', 'bt.transaction_no', 'bt.bank_account_id', 'ba.name as account_name', 'bt.type', 'bt.amount',
        'bt.currency', 'bt.category', 'bt.transaction_date', 'bt.status', 'bt.created_at'),
    db('journal_entries')
      .whereIn('ref_type', ['Fund Transfer', 'Fund Transfer Reversal'])
      .where('ref_no', t.transfer_no)
      .orderBy('id', 'asc')
      .select('id', 'journal_no', 'ref_type', 'entity', 'date', 'description', 'total_debit', 'status'),
  ]);
  return { ...t, bank_transactions: bankTransactions, journals };
}

module.exports = {
  create, accept, reverse, list, getById,
  createContra, replace,
  // exported for tests / reuse
  computeContraAmounts, fxTolerance, createContraInTrx, reverseInTrx,
  ENTITY_LABEL, CATEGORY,
};
