/**
 * A milling batch's transport cost and the transporter it is owed to — P3-08 /
 * MIL-12 (owner decision D-25b (a): transporters are `haulers`).
 *
 * The cost sheet's 'transport' line can be owed to a transporter. When the
 * COMPANY bears it and a hauler is named, the freight is accrued
 * Dr 1210 / Cr 2010 ('Batch Transport', stamped with the hauler) and a
 * transporter payable (source_table 'batch_transport') carries it in AP. Two
 * gaps used to break that:
 *
 *   - the costs drawer re-sends every line on save with whatever is in its
 *     hauler / payer fields, and an absent hauler was written as NULL — the
 *     transporter ledger lost the hauler. An absent or blank hauler / payer
 *     now KEEPS what is on record; only a value given changes it;
 *   - lowering the freight to 0, switching the payer away from the company,
 *     or moving it to another hauler never voided the payable or reversed the
 *     accrual (only deleting the batch did), so AP and 2010 stayed overstated.
 *
 * syncBatchTransport makes the books follow the line: the target owed is the
 * amount when the company pays a named hauler, else 0. The GL already holds
 * the net 'Batch Transport' credit on 2010 per hauler; the difference per
 * hauler is posted as a signed delta (Dr 1210 / Cr 2010, swapped when it
 * drops) — never reverse + repost. The payable moves in place: a new figure,
 * another hauler, or 'Reversed' (outstanding 0, its figure kept) when nothing
 * is owed any more. A payment already made is never orphaned: moving or
 * lowering below what was paid is refused (409).
 *
 * Returns the net change it posted to 1210 so the caller's post-yield cost
 * adjustment credits 1210 for that much and 2110 for the rest — together they
 * net to Dr 1220 / Cr 2010 (owed to a hauler) or Cr 2110 (anything else).
 */
const accountingService = require('../accounting/accounting.service');
const { nextDocNo } = require('../../utils/docNumber');
const { missingAccounts, ledgerFailure } = require('../../shared/ledgerFailure');

const REF_TYPE = 'Batch Transport';
const PAID_BY = ['company', 'supplier', 'customer', 'service_client', 'included_in_supplier_rate', 'deduct_from_supplier', 'other'];
const num = (v) => parseFloat(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const given = (v) => v !== undefined && v !== null && v !== '';
const refuse = (status, message) => { const e = new Error(message); e.status = status; return e; };

/** Net Cr 2010 the batch's 'Batch Transport' journals hold, per hauler id ('' = unstamped). */
async function accruedByHauler(trx, batchNo) {
  const rows = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': REF_TYPE, 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': '2010' })
    .groupBy('je.party_id')
    .select('je.party_id', trx.raw('COALESCE(SUM(jl.credit - jl.debit), 0) as net'));
  const out = {};
  for (const r of rows || []) {
    const n = r2(r.net);
    if (Math.abs(n) > 0.005) out[r.party_id == null ? '' : String(r.party_id)] = n;
  }
  return out;
}

/**
 * Pure: the signed change per hauler from what is accrued to what is owed.
 * Exported for tests. [{ haulerId ('' = none), delta }], non-zero only.
 */
function accrualDeltas(accrued, target) {
  const keys = new Set([...Object.keys(accrued || {}), ...Object.keys(target || {})]);
  const out = [];
  for (const k of keys) {
    const d = r2(num((target || {})[k]) - num((accrued || {})[k]));
    if (Math.abs(d) > 0.01) out.push({ haulerId: k, delta: d });
  }
  return out;
}

/**
 * Pure: the post-yield cost-adjustment lines for a transport change of
 * `delta` on the cost sheet, `staged` of which moved the transporter accrual
 * through 1210. Signed: amount > 0 is a debit. 1220 takes the whole change,
 * 1210 gives back what the accrual put in, 2110 the rest.
 */
function transportAdjustmentParts(delta, staged) {
  const D = r2(delta); const H = r2(staged);
  return [
    { code: '1220', amount: D },
    { code: '1210', amount: -H },
    { code: '2110', amount: -r2(D - H) },
  ].filter((p) => Math.abs(p.amount) > 0.005);
}

async function postAccrualDelta(trx, { batch, haulerId, delta, userId }) {
  const [raw, ap] = await Promise.all([
    trx('chart_of_accounts').where({ code: '1210' }).first(),
    trx('chart_of_accounts').where({ code: '2010' }).first(),
  ]);
  if (!raw || !ap) throw missingAccounts([!raw ? '1210' : null, !ap ? '2010' : null].filter(Boolean), 'The transport cost');
  const amt = r2(Math.abs(delta)); const up = delta > 0;
  try {
    const j = await accountingService.createJournal(trx, {
      date: new Date().toISOString().slice(0, 10), entity: 'mill',
      refType: REF_TYPE, refNo: batch.batch_no,
      description: `Transport payable ${up ? '' : '(reduced) '}for batch ${batch.batch_no}`,
      currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
      partyType: haulerId ? 'hauler' : null, partyId: haulerId ? parseInt(haulerId, 10) : null,
      lines: [
        { account_id: raw.id, account: raw.name, debit: up ? amt : 0, credit: up ? 0 : amt, narration: `${up ? 'DR' : 'CR'} ${raw.code} ${raw.name} — transport ${batch.batch_no}` },
        { account_id: ap.id, account: ap.name, debit: up ? 0 : amt, credit: up ? amt : 0, narration: `${up ? 'CR' : 'DR'} ${ap.code} ${ap.name} — transport ${batch.batch_no}` },
      ],
    });
    if (j?.id) await accountingService.postJournal(trx, j.id);
  } catch (e) {
    throw ledgerFailure(e, 'The transport cost');
  }
}

/**
 * Bring the batch's transporter payable, accrual and transport_costs record in
 * line with its transport cost line. `body` is the request body (hauler_id,
 * transport_paid_by, vehicle_no, doc_no). Returns { staged, paidBy, haulerId }.
 */
async function syncBatchTransport(trx, { batch, amount, body = {}, userId = null }) {
  const tc = await trx('transport_costs').where({ batch_id: batch.id }).whereNull('lot_id').forUpdate().first();
  const pay = await trx('payables').where({ source_table: 'batch_transport', source_id: batch.id }).forUpdate().first();

  if (given(body.transport_paid_by) && !PAID_BY.includes(body.transport_paid_by)) {
    throw refuse(400, `Unknown transport payer '${body.transport_paid_by}'.`);
  }
  const paidBy = given(body.transport_paid_by) ? body.transport_paid_by : (tc?.paid_by || 'company');
  let haulerId = tc?.hauler_id || pay?.hauler_id || null;
  if (given(body.hauler_id)) {
    haulerId = parseInt(body.hauler_id, 10);
    const h = Number.isInteger(haulerId) ? await trx('haulers').where({ id: haulerId }).first('id') : null;
    if (!h) throw refuse(400, 'That transporter does not exist.');
  }

  const amt = r2(amount);
  const owed = paidBy === 'company' && haulerId && amt > 0 ? amt : 0;
  const paid = r2(num(pay?.paid_amount));
  if (paid > 0.01) {
    if (pay.hauler_id && String(pay.hauler_id) !== String(haulerId || '')) {
      throw refuse(409, `Rs ${paid.toLocaleString('en-US')} has already been paid to this batch's transporter on ${pay.pay_no} — reverse that payment before changing the transporter.`);
    }
    if (owed < paid - 0.01) {
      throw refuse(409, `Rs ${paid.toLocaleString('en-US')} of the transport on ${pay.pay_no} has already been paid — it can't drop below that${owed ? '' : ' or stop being owed'}. Reverse the payment first.`);
    }
  }

  // GL: per hauler, the signed difference between what is accrued and what is owed.
  const accrued = await accruedByHauler(trx, batch.batch_no);
  const target = owed > 0 ? { [String(haulerId)]: owed } : {};
  let staged = 0;
  for (const { haulerId: h, delta } of accrualDeltas(accrued, target)) {
    await postAccrualDelta(trx, { batch, haulerId: h || null, delta, userId });
    staged = r2(staged + delta);
  }

  // AP: the one transporter payable for the batch, moved in place.
  let payableId = pay ? pay.id : null;
  if (owed > 0) {
    const status = paid <= 0.01 ? 'Pending' : (paid < owed - 0.01 ? 'Partial' : 'Paid');
    if (pay) {
      await trx('payables').where({ id: pay.id }).update({
        hauler_id: haulerId, supplier_id: null, original_amount: owed,
        outstanding: Math.max(0, r2(owed - paid)), status,
        linked_ref: batch.batch_no, updated_at: trx.fn.now(),
      });
    } else {
      const payNo = await nextDocNo(trx, { table: 'payables', column: 'pay_no', prefix: 'PAY-', pad: 4 });
      const [np] = await trx('payables').insert({
        pay_no: payNo, entity: 'mill', payable_type: 'vendor', category: 'Transport',
        hauler_id: haulerId, supplier_id: null, linked_ref: batch.batch_no,
        source_table: 'batch_transport', source_id: batch.id,
        original_amount: owed, paid_amount: 0, outstanding: owed, status: 'Pending',
        currency: 'PKR', notes: `Transport (hauler) for batch ${batch.batch_no}`,
      }).returning('*');
      payableId = np.id;
    }
  } else if (pay && pay.status !== 'Reversed') {
    const why = amt <= 0 ? 'transport removed' : (paidBy !== 'company' ? `now paid by ${paidBy.replace(/_/g, ' ')}` : 'no transporter named');
    await trx('payables').where({ id: pay.id }).update({
      status: 'Reversed', outstanding: 0,
      notes: `${pay.notes ? `${pay.notes} — ` : ''}voided: ${why}`.slice(0, 1000),
      updated_at: trx.fn.now(),
    });
  }

  // The freight record (AP → Transporters, the transporter ledger, reports).
  const tcStatus = owed > 0
    ? (paid <= 0.01 ? 'unpaid' : (paid < owed - 0.01 ? 'partially_paid' : 'paid'))
    : (amt > 0 ? 'approved' : 'cancelled');
  if (tc) {
    await trx('transport_costs').where({ id: tc.id }).update({
      hauler_id: haulerId, amount: amt, paid_by: paidBy, status: tcStatus,
      vehicle_no: body.vehicle_no || tc.vehicle_no || null, doc_no: body.doc_no || tc.doc_no || null,
      payable_id: payableId || tc.payable_id || null, updated_at: trx.fn.now(),
    });
  } else if (amt > 0) {
    await trx('transport_costs').insert({
      batch_id: batch.id, hauler_id: haulerId, amount: amt, paid_by: paidBy,
      status: tcStatus, transport_type: 'milling', vehicle_no: body.vehicle_no || null,
      doc_no: body.doc_no || null, expense_date: new Date().toISOString().slice(0, 10),
      entity: 'mill', payable_id: owed > 0 ? payableId : null, created_by: userId || null,
    });
  }

  return { staged, paidBy, haulerId, owed };
}

module.exports = { syncBatchTransport, accrualDeltas, transportAdjustmentParts, accruedByHauler, PAID_BY };
