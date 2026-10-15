/**
 * Local-sale returns and credit notes — P3-11 / INV-55, owner decision D-22 (a).
 *
 * A return is a NEW document (local_sale_returns, LSR-NNNN) linked to one
 * confirmed sale line; the sale itself is never edited or deleted (D-23). In
 * one transaction a return:
 *
 *   stock    puts the rice back on the ORIGINAL lot at the ORIGINAL cost —
 *            postMovement('return') at the per-kg cost the sale's COGS
 *            journal relieved (a packaging line goes back to mill_stock);
 *   COGS     reverses that journal by a signed delta, pro rata:
 *            Dr <the stock account it credited> / Cr 5000 (same entity);
 *   revenue  reverses the sale's revenue journal by a signed delta, pro rata:
 *            Dr <its revenue account> / Cr <its AR account>, stamped with the
 *            buyer like the sale;
 *   money    takes the return off what the buyer still owes on the sale first
 *            (receivable + the sale's due). Whatever is left had already been
 *            paid, so it is either
 *              refund — money out of a bank / cash account (payment engine:
 *                       its own payment row, bank row and Dr 1120 / Cr bank), or
 *              credit — held for the customer in 1310 Customer Advances
 *                       (Dr 1120 / Cr 1310, credit_status 'Open'); a walk-in
 *                       with no customer record can only be refunded.
 *
 * Amounts are the sale's own, pro rata by quantity; the return that brings the
 * line to zero takes whatever is left, so rounding never strands a paisa.
 *
 * Refused (nothing written): a sale that is not Completed, more than is left
 * to return, an uncleared cheque still on the sale, a sale with no posted
 * revenue, a lot line with no posted COGS, and a lot whose cost per kg has
 * changed since the sale (putting rice back at the old cost would revalue
 * everything already on the lot — that needs a decision, not a guess).
 */
const uc = require('../../services/unitConversion');
const inventoryService = require('../inventory/inventory.service');
const accountingService = require('../accounting/accounting.service');
const { nextDocNo } = require('../../utils/docNumber');
const { recordMoneyMovement } = require('../finance/paymentEngine');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const { inventoryAccountForLot } = require('./inventoryAccount');

const REF_TYPE = 'Local Sale Return';
const SALE_REF_TYPE = 'Local Sale';
const COGS_REF_TYPE = 'Local Sale COGS';
const COGS_CODE = '5000';
const AR_CODE = '1120';
const REVENUE_CODE = '4020';
const CREDIT_CODE = '1310';
const SETTLEMENTS = ['refund', 'credit'];
const REFUND_METHODS = ['cash', 'bank_transfer', 'online', 'mobile', 'tt', 'wire', 'lc'];
const QTY_EPS = 0.001;
const COST_EPS = 0.01;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };

/** Pure: pro-rata share of `total` for `qty` of `saleQty`; the last return takes the rest. */
function proRata(total, alreadyReturned, qty, saleQty, isLast) {
  if (isLast) return uc.round2(num(total) - num(alreadyReturned));
  if (!(saleQty > 0)) return 0;
  return uc.round2(num(total) * qty / saleQty);
}

/**
 * Pure: split a return's value into what comes off the open receivable and
 * what had already been paid (refund / credit). Exported for tests.
 */
function splitReturnValue(value, outstanding) {
  const v = uc.round2(num(value));
  const applied = uc.round2(Math.max(0, Math.min(v, num(outstanding))));
  return { applied, excess: uc.round2(v - applied) };
}

/**
 * Net amounts of the Posted journals with this ref, per account:
 * [{ account_id, code, name, net }] where net = Σ debit − Σ credit.
 */
async function netByAccount(trx, refType, refNo) {
  const rows = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': refType, 'je.ref_no': refNo, 'je.status': 'Posted' })
    .groupBy('c.id', 'c.code', 'c.name')
    .select('c.id as account_id', 'c.code', 'c.name', trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'));
  return (rows || []).map((r) => ({ ...r, net: uc.round2(num(r.net)) }));
}

async function entityOf(trx, refType, refNo, fallback) {
  const j = await trx('journal_entries').where({ ref_type: refType, ref_no: refNo, status: 'Posted' }).first('entity');
  return (j && j.entity) || fallback;
}

async function account(trx, code) {
  const a = await trx('chart_of_accounts').where({ code }).first();
  if (!a) throw missingAccounts([code], 'The return');
  return a;
}

async function postJournal(trx, { entity, refNo, description, lines, partyType, partyId, userId, date }) {
  try {
    const je = await accountingService.createJournal(trx, {
      date: date || today(), entity, refType: REF_TYPE, refNo,
      description: String(description).slice(0, 240),
      currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
      partyType: partyType || null, partyId: partyId || null,
      lines,
    });
    if (je && je.id) await accountingService.postJournal(trx, je.id);
    return je || null;
  } catch (e) {
    throw ledgerFailure(e, 'The return');
  }
}

const line = (acc, debit, credit, narration) => ({
  account_id: acc.account_id || acc.id, account: acc.name,
  debit: uc.round2(debit), credit: uc.round2(credit),
  narration: `${debit > 0 ? 'DR' : 'CR'} ${acc.code} ${acc.name} — ${narration}`.slice(0, 240),
});

/** Returns already recorded against a sale line, summed. */
async function returnedSoFar(trx, saleId) {
  const r = await trx('local_sale_returns').where({ local_sale_id: saleId })
    .sum({ qty: 'quantity_kg', value: 'return_value', cogs: 'cogs_reversed' }).first();
  return { qty: num(r && r.qty), value: num(r && r.value), cogs: num(r && r.cogs) };
}

/**
 * Record one return against one confirmed sale line, inside `trx`. Throws
 * (statusCode set) so the caller's transaction rolls back on any refusal.
 *
 * input: { quantity, reason, settlement ('refund' | 'credit'), returnDate,
 *          refund: { bankAccountId, method, reference } }
 */
async function createSaleReturn(trx, saleId, input, { userId = null, ownerId = null } = {}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) throw httpError('Give a reason for the return.');
  const qty = uc.round2(num(input.quantity) * 1000) / 1000;
  if (!(qty > 0)) throw httpError('Enter the quantity being returned.');

  const sale = await trx('local_sales').where({ id: saleId }).forUpdate().first();
  if (!sale) throw httpError('Local sale not found.', 404);
  if (sale.status !== 'Completed') {
    throw httpError(`${sale.sale_no} is ${String(sale.status || 'not confirmed').toLowerCase()} — only a confirmed sale can be returned.`, 409);
  }
  if (!sale.lot_id && !sale.mill_item_id) {
    throw httpError(`${sale.sale_no} is not linked to a lot or a store item, so there is nowhere to return the goods to.`, 409);
  }

  // An uncleared cheque has not settled anything yet; returning against the
  // sale now would credit money that may never arrive. Clear or bounce it first.
  const uncleared = await trx('payments')
    .where({ local_sale_id: sale.id, cleared: false })
    .whereNotIn('status', ['Reversed', 'Rejected', 'Bounced', 'Superseded'])
    .first('payment_no');
  if (uncleared) {
    throw httpError(`${sale.sale_no} has an uncleared cheque (${uncleared.payment_no}). Clear or bounce it before recording a return.`, 409);
  }

  const isLot = !!sale.lot_id;
  const saleQty = isLot ? num(sale.quantity_kg) : (num(sale.quantity_bags) || num(sale.quantity_kg));
  const prior = await returnedSoFar(trx, sale.id);
  const remaining = uc.round2((saleQty - prior.qty) * 1000) / 1000;
  if (qty > remaining + QTY_EPS) {
    throw httpError(`Only ${remaining} ${isLot ? 'kg' : 'units'} of ${sale.sale_no} is left to return.`);
  }
  const isLast = Math.abs(qty - remaining) <= QTY_EPS;
  const total = num(sale.total_amount);
  const value = proRata(total, prior.value, qty, saleQty, isLast);

  // The revenue the sale actually posted, and on which accounts.
  const revenue = await netByAccount(trx, SALE_REF_TYPE, sale.sale_no);
  const arLine = revenue.find((r) => r.net > 0.005);
  const revLine = revenue.find((r) => r.net < -0.005);
  if (value > 0.005 && (!arLine || !revLine)) {
    throw httpError(`${sale.sale_no} has no posted revenue on the books, so there is nothing to reverse. Ask Finance to check the sale's journal.`, 409);
  }

  // The cost the sale relieved, pro rata (lot lines only — a packaging line
  // posted no COGS). The per-kg cost is what the stock comes back at.
  let cogs = 0; let costPerKg = null; let invAcc = null; let cogsAcc = null; let cogsEntity = null; let lot = null;
  if (isLot) {
    lot = await trx('inventory_lots').where({ id: sale.lot_id }).forUpdate().first();
    if (!lot) throw httpError(`The lot ${sale.sale_no} was sold from no longer exists.`, 409);
    if (lot.voided_at) throw httpError(`Lot ${lot.lot_no} has been voided — the goods cannot go back to it.`, 409);
    const cogsNet = await netByAccount(trx, COGS_REF_TYPE, sale.sale_no);
    cogsAcc = cogsNet.find((r) => r.code === COGS_CODE && r.net > 0.005) || null;
    invAcc = cogsNet.find((r) => r.code !== COGS_CODE && r.net < -0.005) || null;
    const postedCogs = cogsAcc ? cogsAcc.net : 0;
    if (!(postedCogs > 0.005) || !invAcc) {
      throw httpError(`${sale.sale_no} posted no cost of goods sold, so the rice cannot be put back at its cost. Correct it with a stock adjustment instead.`, 409);
    }
    cogs = proRata(postedCogs, prior.cogs, qty, saleQty, isLast);
    costPerKg = uc.round2(postedCogs / saleQty * 10000) / 10000;
    const lotCost = num(lot.cost_per_unit);
    if (num(lot.qty) > QTY_EPS && Math.abs(lotCost - costPerKg) > COST_EPS) {
      throw httpError(`Lot ${lot.lot_no} is now carried at Rs ${lotCost}/kg but ${sale.sale_no} was sold at Rs ${costPerKg}/kg. Returning it would revalue the rice still on the lot — ask Finance to resolve the cost first.`, 409);
    }
    cogsEntity = await entityOf(trx, COGS_REF_TYPE, sale.sale_no, lot.entity || 'mill');
  }

  // What the buyer still owes comes off first; the rest was paid.
  const receivable = await trx('receivables').where({ local_sale_id: sale.id }).forUpdate().first();
  const { applied, excess } = splitReturnValue(value, receivable ? num(receivable.outstanding) : 0);
  let settlement = 'none';
  if (excess > 0.005) {
    settlement = input.settlement;
    if (!SETTLEMENTS.includes(settlement)) {
      throw httpError(`Rs ${excess.toLocaleString('en-US')} of this return was already paid. Choose whether to refund it or keep it as the customer's credit.`);
    }
    if (settlement === 'credit' && !sale.customer_id) {
      throw httpError('A walk-in sale has no customer account to hold a credit — refund the money instead, or link the sale to a customer first.');
    }
  }

  const returnNo = await nextDocNo(trx, { table: 'local_sale_returns', column: 'return_no', prefix: 'LSR-' });
  const returnDate = input.returnDate || today();
  const party = sale.customer_id ? { partyType: 'customer', partyId: sale.customer_id } : {};
  const label = `${returnNo} (return on ${sale.sale_no})`;

  const [ret] = await trx('local_sale_returns').insert({
    return_no: returnNo,
    local_sale_id: sale.id,
    lot_id: sale.lot_id || null,
    mill_item_id: sale.lot_id ? null : sale.mill_item_id,
    customer_id: sale.customer_id || null,
    return_date: returnDate,
    quantity_kg: qty,
    return_value: value,
    cogs_reversed: cogs,
    cost_per_kg: costPerKg,
    inventory_account_code: invAcc ? invAcc.code : (lot ? inventoryAccountForLot(lot) : null),
    applied_to_receivable: applied,
    refund_amount: settlement === 'refund' ? excess : 0,
    credit_amount: settlement === 'credit' ? excess : 0,
    settlement,
    credit_status: settlement === 'credit' ? 'Open' : null,
    reason,
    authorized_by_owner_id: ownerId || null,
    created_by: userId || null,
  }).returning('*');

  // ── Stock back where it came from ──
  if (isLot) {
    await inventoryService.postMovement(trx, {
      movementType: 'return', lotId: lot.id, qty,
      toWarehouseId: lot.warehouse_id, destEntity: lot.entity, linkedRef: returnNo,
      notes: `Return ${returnNo} of local sale ${sale.sale_no}: ${reason}`.slice(0, 500),
      costPerUnit: costPerKg, currency: 'PKR', userId,
    });
    // postMovement grows received_net_weight_kg on every inbound movement, but
    // that column is the lot's original INTAKE — a customer return is not
    // intake, so take it back off. sold_weight_kg comes down by the same kg.
    await trx('inventory_lots').where({ id: lot.id }).update({
      received_net_weight_kg: lot.received_net_weight_kg == null ? null : num(lot.received_net_weight_kg),
      sold_weight_kg: Math.max(0, uc.round2(num(lot.sold_weight_kg) - qty)),
      ...(lot.status === 'Sold' ? { status: 'Available' } : {}),
      updated_at: trx.fn.now(),
    });
  } else {
    const ms = await trx('mill_stock').where({ item_id: sale.mill_item_id, warehouse_id: null }).forUpdate().first();
    if (ms) {
      await trx('mill_stock').where({ id: ms.id })
        .update({ quantity_available: trx.raw('quantity_available + ?', [qty]), updated_at: trx.fn.now() });
    } else {
      await trx('mill_stock').insert({ item_id: sale.mill_item_id, warehouse_id: null, quantity_available: qty, quantity_reserved: 0 });
    }
    await trx('mill_stock_movements').insert({
      item_id: sale.mill_item_id, warehouse_id: null, movement_type: 'return', quantity: qty,
      reference_type: 'local_sale_return', reference_id: ret.id,
      reason: `Return ${returnNo} of local sale ${sale.sale_no}`, performed_by: userId || null,
    });
  }

  // ── GL: signed deltas of what the sale posted ──
  if (value > 0.005) {
    await postJournal(trx, {
      entity: await entityOf(trx, SALE_REF_TYPE, sale.sale_no, 'mill'), refNo: returnNo, userId, date: returnDate, ...party,
      description: `Return ${returnNo} — revenue reversed on ${sale.sale_no} (${sale.item_name || ''})`,
      lines: [line(revLine, value, 0, label), line(arLine, 0, value, label)],
    });
  }
  if (cogs > 0.005) {
    await postJournal(trx, {
      entity: cogsEntity, refNo: returnNo, userId, date: returnDate,
      description: `Return ${returnNo} — cost of goods sold reversed on ${sale.sale_no}`,
      lines: [line(invAcc, cogs, 0, label), line(cogsAcc, 0, cogs, label)],
    });
  }

  // ── What the buyer owed comes down; the sale's due follows it ──
  if (applied > 0.005 && receivable) {
    const expected = Math.max(0, uc.round2(num(receivable.expected_amount) - applied));
    const outstanding = Math.max(0, uc.round2(num(receivable.outstanding) - applied));
    await trx('receivables').where({ id: receivable.id }).update({
      expected_amount: expected,
      outstanding,
      status: outstanding <= 0.01 ? 'Paid' : (num(receivable.received_amount) > 0.01 ? 'Partial' : receivable.status),
      notes: `${receivable.notes ? `${receivable.notes} · ` : ''}Rs ${applied} credited by return ${returnNo}`.slice(0, 1000),
      updated_at: trx.fn.now(),
    });
  }
  if (applied > 0.005) {
    const due = Math.max(0, uc.round2(num(sale.due_amount) - applied));
    const paid = num(sale.paid_amount);
    await trx('local_sales').where({ id: sale.id }).update({
      due_amount: due,
      payment_status: due <= 0.01 ? 'Paid' : (paid > 0.01 ? 'Partial' : (sale.payment_mode === 'credit' ? 'Credit' : 'Pending')),
      updated_at: trx.fn.now(),
    });
  }

  // ── The part already paid: refund it or hold it as credit ──
  let refundPaymentNo = null;
  if (settlement === 'refund') {
    const refund = input.refund || {};
    const method = REFUND_METHODS.includes(refund.method) ? refund.method : 'cash';
    let moved;
    try {
      moved = await recordMoneyMovement(trx, {
        type: 'payment',
        amount: excess,
        currency: 'PKR',
        method,
        bankAccountId: refund.bankAccountId || null,
        accountEntity: 'mill',
        paymentDate: returnDate,
        bankReference: refund.reference || null,
        notes: `Refund for return ${returnNo} on local sale ${sale.sale_no}`,
        userId,
        checkOutstanding: false,
        journal: {
          refType: REF_TYPE, refNo: returnNo, counterCode: AR_CODE, entity: 'mill',
          partyType: party.partyType || null, partyId: party.partyId || null,
          description: `Refund for return ${returnNo} on ${sale.sale_no}`,
        },
        bt: { source: 'local_sale_refund', notes: `Refund ${returnNo} (${sale.sale_no})` },
      });
    } catch (e) {
      throw ledgerFailure(e, 'The return');
    }
    if (!moved || !moved.journal) throw httpError('The refund could not be posted to the ledger.', 400);
    refundPaymentNo = moved.payment.payment_no;
    await trx('local_sale_returns').where({ id: ret.id }).update({ refund_payment_id: moved.payment.id });
    ret.refund_payment_id = moved.payment.id;
  } else if (settlement === 'credit') {
    const [ar, credit] = [await account(trx, AR_CODE), await account(trx, CREDIT_CODE)];
    await postJournal(trx, {
      entity: 'mill', refNo: returnNo, userId, date: returnDate, ...party,
      description: `Return ${returnNo} — Rs ${excess} held as customer credit (${sale.sale_no})`,
      lines: [line(ar, excess, 0, `${label} credit`), line(credit, 0, excess, `${label} credit`)],
    });
  }

  return { ...ret, sale_no: sale.sale_no, refund_payment_no: refundPaymentNo };
}

/** Returns recorded against a sale line, newest first, with the refund number. */
async function listSaleReturns(q, saleId) {
  return q('local_sale_returns as r')
    .leftJoin('payments as p', 'p.id', 'r.refund_payment_id')
    .leftJoin('users as u', 'u.id', 'r.created_by')
    .where('r.local_sale_id', saleId)
    .orderBy('r.id', 'desc')
    .select('r.*', 'p.payment_no as refund_payment_no', 'u.full_name as created_by_name');
}

module.exports = {
  createSaleReturn, listSaleReturns, proRata, splitReturnValue,
  REF_TYPE, AR_CODE, REVENUE_CODE, CREDIT_CODE,
};
