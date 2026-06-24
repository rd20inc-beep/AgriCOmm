const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const { NotFoundError, ValidationError } = require('../../shared/errors');

// Head Office ⇄ Mill fund transfers — a two-phase send → accept flow.
//   create()  : the SENDER's money leaves immediately (balance down + bank_txn +
//               the sender entity's inter-company journal). status = 'pending'.
//   accept()  : the RECEIVER confirms; their account is credited (balance up +
//               bank_txn + the receiver entity's journal). status = 'completed'.
// Each entity's journal balances on its own and is linked by 1130 Inter-Company
// Receivable — Mill, with cash on 1000. So between send and accept the funds sit
// "in transit" (the sender's 1130 advance), and the receiver only sees the cash
// once it accepts.

const ENTITY_LABEL = { general: 'Head Office', mill: 'Mill', export: 'Export' };
const DIRECTIONS = {
  ho_to_mill: { from: 'general', to: 'mill' },
  mill_to_ho: { from: 'mill', to: 'general' },
};

async function generateTransferNo(trx) {
  const last = await trx('fund_transfers').where('transfer_no', 'like', 'FT-%').orderBy('id', 'desc').first('transfer_no');
  const n = last ? (parseInt(String(last.transfer_no).replace('FT-', ''), 10) || 0) + 1 : 1;
  return `FT-${String(n).padStart(4, '0')}`;
}
async function nextBtNo(trx) {
  const last = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
  const seq = last ? (parseInt(String(last.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
  return `BT-${String(seq).padStart(4, '0')}`;
}

// Post ONE entity's half of the transfer. cashIn ⇒ DR cash / CR inter-company;
// otherwise CR cash / DR inter-company (the sender advanced funds).
async function postEntityBook(trx, { transferNo, entity, cashIn, amount, date, userId, description }) {
  const [cash, ic] = await Promise.all([
    trx('chart_of_accounts').where({ code: '1000' }).first(),
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

async function writeBankTxn(trx, { account, type, amount, date, transferNo, counterpartyName, noteLine, userId }) {
  await trx('bank_transactions').insert({
    transaction_no: await nextBtNo(trx), bank_account_id: account.id, type,
    amount, currency: 'PKR', status: 'posted', transaction_date: date,
    reference: transferNo, counterparty: counterpartyName, category: 'Fund Transfer',
    notes: noteLine, source: 'fund_transfer', created_by: userId || null,
  });
}

async function create(payload, userId) {
  const { direction, from_account_id, to_account_id, amount, transfer_date, method, reference, notes } = payload || {};
  const amt = parseFloat(amount);
  if (!DIRECTIONS[direction]) throw new ValidationError("direction must be 'ho_to_mill' or 'mill_to_ho'.");
  if (!(amt > 0)) throw new ValidationError('amount must be a positive number.');
  if (!from_account_id || !to_account_id) throw new ValidationError('from and to accounts are required.');
  if (Number(from_account_id) === Number(to_account_id)) throw new ValidationError('from and to accounts must be different.');

  const { from: fromEntity, to: toEntity } = DIRECTIONS[direction];
  const date = transfer_date || new Date().toISOString().slice(0, 10);

  return db.transaction(async (trx) => {
    const [fromAcc, toAcc] = await Promise.all([
      trx('bank_accounts').where({ id: from_account_id }).first(),
      trx('bank_accounts').where({ id: to_account_id }).first(),
    ]);
    if (!fromAcc || !toAcc) throw new NotFoundError('Bank account not found.');
    if ((fromAcc.currency || 'PKR') !== 'PKR' || (toAcc.currency || 'PKR') !== 'PKR') {
      throw new ValidationError('Fund transfers currently support PKR accounts only.');
    }

    const transferNo = await generateTransferNo(trx);
    const desc = `Fund transfer ${transferNo}: ${ENTITY_LABEL[fromEntity]} → ${ENTITY_LABEL[toEntity]} (${fromAcc.name} → ${toAcc.name})`;
    const noteLine = [desc, reference ? `Ref: ${reference}` : null, notes].filter(Boolean).join(' · ');

    // SENDER side only — money leaves now; the receiver accepts to take it in.
    await trx('bank_accounts').where({ id: fromAcc.id }).decrement('current_balance', amt);
    await writeBankTxn(trx, { account: fromAcc, type: 'debit', amount: amt, date, transferNo, counterpartyName: toAcc.name, noteLine, userId });
    await postEntityBook(trx, { transferNo, entity: fromEntity, cashIn: false, amount: amt, date, userId, description: desc });

    const [row] = await trx('fund_transfers').insert({
      transfer_no: transferNo, direction, from_entity: fromEntity, to_entity: toEntity,
      from_account_id: fromAcc.id, to_account_id: toAcc.id, amount: amt, currency: 'PKR',
      transfer_date: date, method: method || 'cash', reference: reference || null, notes: notes || null,
      status: 'pending', je_ref_no: transferNo, created_by: userId || null,
    }).returning('*');
    return row;
  });
}

// The receiver confirms receipt: credit their account + post their journal.
async function accept(id, userId) {
  return db.transaction(async (trx) => {
    const t = await trx('fund_transfers').where({ id }).first();
    if (!t) throw new NotFoundError('Fund transfer not found.');
    if (t.status !== 'pending') throw new ValidationError(`Transfer ${t.transfer_no} is already ${t.status}.`);
    const toAcc = await trx('bank_accounts').where({ id: t.to_account_id }).first();
    if (!toAcc) throw new NotFoundError('Destination account not found.');
    const fromAcc = await trx('bank_accounts').where({ id: t.from_account_id }).first();
    const amt = parseFloat(t.amount) || 0;
    const desc = `Fund transfer ${t.transfer_no} received by ${ENTITY_LABEL[t.to_entity]}`;
    const noteLine = `${desc}${t.reference ? ` · Ref: ${t.reference}` : ''}`;

    await trx('bank_accounts').where({ id: toAcc.id }).increment('current_balance', amt);
    await writeBankTxn(trx, { account: toAcc, type: 'credit', amount: amt, date: new Date().toISOString().slice(0, 10), transferNo: t.transfer_no, counterpartyName: fromAcc ? fromAcc.name : ENTITY_LABEL[t.from_entity], noteLine, userId });
    await postEntityBook(trx, { transferNo: t.transfer_no, entity: t.to_entity, cashIn: true, amount: amt, date: new Date().toISOString().slice(0, 10), userId, description: desc });

    const [row] = await trx('fund_transfers').where({ id }).update({
      status: 'completed', accepted_at: trx.fn.now(), accepted_by: userId || null, updated_at: trx.fn.now(),
    }).returning('*');
    return row;
  });
}

// Unwind a transfer (pending or completed): restore whatever balances/journals
// were posted, drop its bank_transactions + GL journals. TB stays balanced.
async function remove(id, userId) {
  return db.transaction(async (trx) => {
    const t = await trx('fund_transfers').where({ id }).first();
    if (!t) throw new NotFoundError('Fund transfer not found.');
    const amt = parseFloat(t.amount) || 0;
    // Sender side was always posted at create → restore.
    if (t.from_account_id) await trx('bank_accounts').where({ id: t.from_account_id }).increment('current_balance', amt);
    // Receiver side only posted once accepted → restore only then.
    if (t.status === 'completed' && t.to_account_id) await trx('bank_accounts').where({ id: t.to_account_id }).decrement('current_balance', amt);
    await trx('bank_transactions').where({ source: 'fund_transfer', reference: t.transfer_no }).del();
    const journals = await trx('journal_entries').where({ ref_no: t.transfer_no, ref_type: 'Fund Transfer' }).select('id');
    const jids = journals.map((j) => j.id);
    if (jids.length) {
      await trx('journal_lines').whereIn('journal_id', jids).del();
      await trx('journal_entries').whereIn('id', jids).del();
    }
    await trx('fund_transfers').where({ id }).del();
    return { deleted: true, transfer_no: t.transfer_no };
  });
}

async function list({ entity, to_entity, from_entity, status, from, to, limit = 100 } = {}) {
  let q = db('fund_transfers as ft')
    .leftJoin('bank_accounts as fa', 'fa.id', 'ft.from_account_id')
    .leftJoin('bank_accounts as ta', 'ta.id', 'ft.to_account_id')
    .leftJoin('users as u', 'u.id', 'ft.created_by')
    .leftJoin('users as au', 'au.id', 'ft.accepted_by')
    .select('ft.*', 'fa.name as from_account_name', 'ta.name as to_account_name', 'u.full_name as created_by_name', 'au.full_name as accepted_by_name')
    .orderBy('ft.transfer_date', 'desc').orderBy('ft.id', 'desc');
  if (entity) q = q.where(function () { this.where('ft.from_entity', entity).orWhere('ft.to_entity', entity); });
  if (to_entity) q = q.where('ft.to_entity', to_entity);
  if (from_entity) q = q.where('ft.from_entity', from_entity);
  if (status) q = q.where('ft.status', status);
  if (from) q = q.where('ft.transfer_date', '>=', from);
  if (to) q = q.where('ft.transfer_date', '<=', to);
  return q.limit(Math.min(parseInt(limit, 10) || 100, 500));
}

module.exports = { create, accept, remove, list, ENTITY_LABEL };
