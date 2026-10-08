/**
 * Local-sale receipt → General Ledger.
 *
 * A confirmed local sale posts Dr 1120 Local AR / Cr 4020 (local_sale_recorded).
 * The money that later settles it has to clear that receivable: Dr the receiving
 * account's own GL (under 1000 Cash & Bank, G-8) / Cr 1120 Local AR — the same codes, entity and party stamp the Finance
 * receipt path (recordPayment) uses for a receipt against a local-sale
 * receivable. Without it every local receipt moved the bank balance and the
 * sub-ledger but never reached the GL, so 1120 only ever grew and 1000 never saw
 * the cash.
 *
 * The journal's ref_no is the payment_no. That is the link the rest of the
 * system already relies on (the Danger Zone deletes a payment's journals by
 * ref_no = payment_no) and the one the customer statement uses to avoid showing
 * the same receipt twice — once from the journal and once from the payments row.
 */
const accountingService = require('../accounting/accounting.service');
const { glAccountFor } = require('../../shared/accountGl');

const CASH_CODE = '1000';
const LOCAL_AR_CODE = '1120';

function isoDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString().slice(0, 10) : dt.toISOString().slice(0, 10);
}

// Pure: the balanced journal for one receipt. Exported for tests.
function buildLocalReceiptJournal({ cashAcc, arAcc, amount, paymentNo, sale, date, userId }) {
  const amt = Number((parseFloat(amount) || 0).toFixed(2));
  const customerId = sale && sale.customer_id ? sale.customer_id : null;
  return {
    date: isoDate(date),
    entity: 'mill',
    refType: 'Local Sale Receipt',
    refNo: paymentNo,
    description: `Receipt ${paymentNo} for local sale ${sale?.sale_no || ''}${sale?.buyer_name ? ` — ${sale.buyer_name}` : ''}`.slice(0, 240),
    currency: 'PKR',
    fxRate: 1,
    isAuto: true,
    userId: userId || null,
    // Walk-in sales (no customer) post unstamped — there is no party ledger to
    // land in, and the statement keeps showing them from the payments row.
    partyType: customerId ? 'customer' : null,
    partyId: customerId,
    lines: [
      { account_id: cashAcc.id, account: cashAcc.name, debit: amt, credit: 0, narration: `DR ${cashAcc.code} ${cashAcc.name} — ${paymentNo}` },
      { account_id: arAcc.id, account: arAcc.name, debit: 0, credit: amt, narration: `CR ${arAcc.code} ${arAcc.name} — ${paymentNo}` },
    ],
  };
}

// Post the receipt journal inside the caller's transaction. Idempotent per
// payment: a receipt that already has a journal (e.g. a Finance-path cheque,
// which journals when it is recorded) is left alone.
// `bankAccountId`: the account the money landed in — its own GL is debited.
async function postLocalReceiptJournal(trx, { paymentNo, amount, sale, date, userId, bankAccountId = null }) {
  if (!paymentNo || !((parseFloat(amount) || 0) > 0)) return null;
  const existing = await trx('journal_entries').where({ ref_no: paymentNo }).first('id');
  if (existing) return null;
  const [cashAcc, arAcc] = await Promise.all([
    glAccountFor(trx, bankAccountId),
    trx('chart_of_accounts').where({ code: LOCAL_AR_CODE }).first(),
  ]);
  if (!cashAcc || !arAcc) {
    console.warn(`local sale receipt: chart_of_accounts missing ${CASH_CODE}/${LOCAL_AR_CODE} — journal skipped for ${paymentNo}`);
    return null;
  }
  const j = await accountingService.createJournal(trx, buildLocalReceiptJournal({ cashAcc, arAcc, amount, paymentNo, sale, date, userId }));
  if (j?.id) await accountingService.postJournal(trx, j.id);
  return j;
}

module.exports = { buildLocalReceiptJournal, postLocalReceiptJournal, CASH_CODE, LOCAL_AR_CODE };
