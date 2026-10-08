// Pure logic behind the Finance drawers — what each one shows and which
// actions it offers. No React, so the tests read it directly.
import { fmtMoney } from '../../../shared/utils/format';
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';

const isOpenRow = (r) => String(r.status || '').toLowerCase() !== 'paid' && (parseFloat(r.outstanding) || 0) > 0;

export const fmtAmt = (v, currency) => fmtMoney(parseFloat(v) || 0, currency || 'PKR', { decimals: 2 });

/**
 * Totals per currency, never added across currencies: { PKR: 1200, USD: 50 }.
 * `rows` carry `currency` and the amount at `key`.
 */
export function totalsByCurrency(rows = [], key = 'outstanding', fallback = 'PKR') {
  const out = {};
  for (const r of rows) {
    const c = String(r?.currency || fallback).toUpperCase();
    out[c] = Math.round(((out[c] || 0) + (parseFloat(r?.[key]) || 0)) * 100) / 100;
  }
  return out;
}

export const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50';

export const btnSecondary = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50';

export const btnDanger = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50';

/** Uncleared cheques that name this account (Due Dates' list, filtered). */
export function chequesForAccount(upcoming, accountId) {
  const all = [...(upcoming?.receiving || []), ...(upcoming?.giving || [])];
  return all.filter((x) => x.kind === 'cheque' && x.paymentId && String(x.bankAccountId) === String(accountId));
}

/** The open items of a party, by side, with their per-currency totals. */
export function partyOpenItems(type, rows = []) {
  const items = rows.filter(isOpenRow).map((r) => ({
    docKind: type === 'customer' ? (r.kind === 'local_sale' ? 'local_sale' : 'receivable') : 'payable',
    row: r,
  }));
  return { items, totals: totalsByCurrency(items.map((i) => ({ currency: i.row.currency || (type === 'customer' ? 'USD' : 'PKR'), outstanding: i.row.outstanding }))) };
}

/**
 * The documents + Receive / + Pay can settle, for this user: open, with
 * something owed, a real row behind it, and a variant whose route this user
 * passes. Oldest due first. `q` filters by party or document number.
 */
export function pickableDocuments(mode, rows = [], hasPermission, q = '') {
  const docKindOf = (r) => (mode === 'receive' ? (r.kind === 'local_sale' ? 'local_sale' : 'receivable') : 'payable');
  const needle = String(q || '').trim().toLowerCase();
  return rows
    .map((r) => ({ docKind: docKindOf(r), row: r }))
    .filter((d) => isSettleable(d))
    .filter((d) => canRecordVariant(contextForDocument(d)?.variant, hasPermission))
    .filter((d) => !needle || [d.row.recvNo, d.row.payNo, d.row.customerName, d.row.supplierName, d.row.haulerName, d.row.linkedRef, d.row.saleGroupNo]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
    .sort((a, b) => new Date(a.row.dueDate || 8.64e15) - new Date(b.row.dueDate || 8.64e15));
}

export const transactionKey = (txKind, id) => ['finance-transaction', txKind, String(id)];

// Which actions this user gets on this movement — the route guards, mirrored:
// reverse and clear are finance.confirm_payment (finance.routes.js), and so is
// attaching a document (the upload route). The server-side facts (can it be
// reversed at all, is it an uncleared cheque) come with the detail.
export function transactionActions(data, hasPermission) {
  const p = data?.payment;
  const canWrite = typeof hasPermission === 'function' && hasPermission('finance', 'confirm_payment');
  return {
    reverse: !!p && canWrite && !!data.reversal?.allowed,
    reverseBlockedReason: p && !data.reversal?.allowed ? data.reversal?.reason : null,
    clear: !!p && canWrite && !!data.clearable,
    attach: !!p && canWrite && !p.attachment_url && !['Reversed', 'Rejected'].includes(p.status),
  };
}

/** Header figures for a document: total / settled / outstanding, in its currency. */
export function documentFigures(docKind, r) {
  if (!r) return null;
  switch (docKind) {
    case 'receivable':
    case 'local_sale':
      return { currency: docKind === 'local_sale' || r.kind === 'local_sale' ? 'PKR' : (r.currency || 'USD'), total: r.expectedAmount, settled: r.receivedAmount, outstanding: r.outstanding, settledLabel: 'Received', status: r.status };
    case 'payable':
      return { currency: r.currency || 'PKR', total: r.originalAmount, settled: r.paidAmount, outstanding: r.outstanding, settledLabel: 'Paid', status: r.status };
    case 'expense': {
      const total = parseFloat(r.amount_pkr ?? r.amount) || 0;
      const paid = parseFloat(r.paid_pkr ?? r.paid_amount) || 0;
      return { currency: 'PKR', total, settled: paid, outstanding: r.outstanding_pkr ?? Math.max(0, total - paid), settledLabel: 'Paid', status: r.payment_status };
    }
    case 'purchase': {
      const total = parseFloat(r.amountPkr) || 0;
      const paid = parseFloat(r.paidAmount) || 0;
      return { currency: 'PKR', total, settled: paid, outstanding: Math.max(0, total - paid), settledLabel: 'Paid', status: r.paymentStatus };
    }
    default: return null;
  }
}

/**
 * Which drawer a header-search hit opens:
 *   party       → Party drawer
 *   document    → Document drawer (receivable / local sale / payable / expense)
 *   transaction → Transaction drawer (payment or bank row)
 */
export function searchTarget(hit) {
  if (!hit) return null;
  if (hit._type === 'party') return { kind: 'party', party: { type: hit.type, id: hit.id, name: hit.name } };
  if (hit._type === 'document') return { kind: 'document', doc: { docKind: hit.kind, id: hit.id } };
  if (hit._type === 'transaction') return { kind: 'transaction', txKind: hit.kind, id: hit.id };
  return null;
}

/**
 * What a header action does. Each opens its drawer in place (no page change):
 * + Receive / + Pay → the payment picker (pick the document, then the Payment
 * form); + Transfer → the contra drawer; + Expense → New expense.
 */
export function headerActionDrawer(key) {
  switch (key) {
    case 'receive': return { kind: 'picker', mode: 'receive' };
    case 'pay': return { kind: 'picker', mode: 'pay' };
    case 'transfer': return { kind: 'transfer', fromAccountId: null };
    case 'expense': return { kind: 'expense' };
    default: return null;
  }
}
