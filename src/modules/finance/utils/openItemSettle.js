// W02/W03 — Pay / Receive straight from a party statement's open items.
//
// The statement's open items carry the document's reference (receivable
// recv_no; payable linked_ref or pay_no) but not its id, so the row is found in
// the sub-ledger list the finance pages already hold. Only an unambiguous match
// that the Payment form can settle is offered — a reference shared by two bills
// (one lot, two payables) gets no button rather than the wrong bill.
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';

const same = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * The { docKind, row } to hand the Payment form for one open item, or null.
 *   mode: 'customer' | 'supplier'
 */
export function docForOpenItem(item, { mode, receivables = [], payables = [], partyId = null } = {}) {
  if (!item?.ref) return null;
  const isCustomer = mode === 'customer';
  const list = isCustomer ? receivables : payables;
  const idKey = isCustomer ? 'customerId' : 'supplierId';
  const matches = (list || []).filter((r) => (partyId == null || same(r[idKey], partyId))
    && (isCustomer ? same(r.recvNo, item.ref) : (same(r.payNo, item.ref) || same(r.linkedRef, item.ref))));
  if (matches.length !== 1) return null;
  const doc = { docKind: isCustomer ? 'receivable' : 'payable', row: matches[0] };
  return isSettleable(doc) ? doc : null;
}

/** The same, and only when this user may record that variant (the route guard). */
export function settleActionForOpenItem(item, opts = {}, hasPermission) {
  const doc = docForOpenItem(item, opts);
  if (!doc) return null;
  return canRecordVariant(contextForDocument(doc)?.variant, hasPermission) ? doc : null;
}
