// Home ▸ Needs Attention — an actionable queue built from endpoints that
// already exist. Every item is one line with its amount in its own currency
// (never converted, never summed with another currency) and one primary
// action. An item's action carries the permission its route guard asks for;
// items this user cannot act on are left out and only counted, except the
// read-only warnings, which everyone with Finance sees.
//
//   source                                   item                       action (guard)
//   GET /export-orders/pending-receipts      receipt awaiting confirm   Confirm / Reject (finance.confirm_payment)
//   GET /finance/receivables                 overdue / due soon / part  Receive (the Payment form variant's guard)
//   GET /finance/upcoming (cheques)          cheque due or overdue      Clear (finance.confirm_payment)
//   GET /finance/fund-transfers              transfer awaiting you      Accept (receiving side: finance.confirm_payment | milling.edit)
//   GET /reporting/payroll-pending           run prepared / approved    Approve (payroll.approve) / Pay (payroll.pay)
//   GET /purchase-requirements?approved      approved purchase request  Mark purchased (any of finance.confirm_payment,
//                                                                        milling.edit, mill_store.create_purchase)
//   GET /finance/suspense                    open suspense entry        Resolve (finance.post_journal)
//   GET /finance/bank-accounts               overdrawn account          Open account (finance.view)
//   GET /finance/fx-rates                    USD rate older than 30 d   Add rate (finance.confirm_payment)
//   GET /finance/overview-summary            data warnings              (read-only)
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';
import { canAcceptTransfer } from './transferPermissions';

const DAY = 24 * 60 * 60 * 1000;
const num = (v) => parseFloat(v) || 0;
const lower = (v) => String(v || '').toLowerCase();
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (date, today) => (date ? Math.round((startOfDay(date) - startOfDay(today)) / DAY) : null);
const anyOf = (hasPermission, pairs) => pairs.some(([m, a]) => hasPermission(m, a));

export const STALE_FX_DAYS = 30;
const DUE_SOON_DAYS = 7;
const SEVERITY_ORDER = { danger: 0, warning: 1, info: 2 };

/**
 * sources: {
 *   pendingReceipts, receivables, upcoming, fundTransfers, payroll, purchaseRequests,
 *   suspense, accounts, fx, summary
 * }
 * Returns { items, hiddenCount } — items sorted by severity, then due date.
 */
export function buildNeedsAttention(sources = {}, hasPermission = () => false, today = new Date()) {
  const items = [];
  let hidden = 0;
  const add = (item, allowed) => { if (allowed) items.push(item); else hidden += 1; };

  // 1. Export receipts recorded and waiting for Finance (maker ≠ checker).
  for (const p of sources.pendingReceipts || []) {
    add({
      key: `receipt-${p.id}`, kind: 'confirmReceipt', severity: 'warning',
      title: `${p.receiptType ? `${String(p.receiptType).charAt(0).toUpperCase()}${String(p.receiptType).slice(1)} receipt` : 'Receipt'} · ${p.orderNo || ''}`.trim(),
      sub: `Recorded by ${p.recordedByName || '—'} — awaiting confirmation`,
      amount: num(p.amount), currency: (p.currency || 'USD').toUpperCase(),
      action: { type: 'confirmReceipt', label: 'Confirm', needsRate: (p.currency || 'USD').toUpperCase() !== 'PKR' },
      payload: p,
    }, hasPermission('finance', 'confirm_payment'));
  }

  // 2. Receivables: overdue, advances / balances due within a week, partials.
  for (const r of sources.receivables || []) {
    const doc = { docKind: r.kind === 'local_sale' ? 'local_sale' : 'receivable', row: r };
    if (!isSettleable(doc)) continue;
    const due = daysUntil(r.dueDate, today);
    const st = lower(r.status);
    const overdue = st === 'overdue' || (due != null && due < 0);
    const dueSoon = !overdue && due != null && due <= DUE_SOON_DAYS && ['advance', 'balance'].includes(lower(r.type));
    const partial = !overdue && !dueSoon && st === 'partial';
    if (!overdue && !dueSoon && !partial) continue;
    const ctx = contextForDocument(doc);
    add({
      key: `recv-${doc.docKind}-${r.id}`, kind: 'receive',
      severity: overdue ? 'danger' : 'warning',
      title: `${overdue ? 'Overdue' : dueSoon ? `${r.type} due` : 'Part paid'} · ${r.recvNo || r.saleGroupNo || ''}`,
      sub: [r.customerName, r.dueDate ? `${overdue ? 'was due' : 'due'} ${String(r.dueDate).slice(0, 10)}` : null].filter(Boolean).join(' · '),
      amount: num(r.outstanding), currency: (ctx.currency || 'PKR').toUpperCase(), due: r.dueDate || null,
      action: { type: 'receive', label: 'Receive' },
      payload: doc,
    }, canRecordVariant(ctx.variant, hasPermission));
  }

  // 3. Cheques due or overdue (not money until cleared).
  const cheques = [...(sources.upcoming?.receiving || []), ...(sources.upcoming?.giving || [])]
    .filter((x) => x.kind === 'cheque' && x.paymentId);
  for (const c of cheques) {
    const due = daysUntil(c.dueDate, today);
    if (due == null || due > 3) continue;
    add({
      key: `cheque-${c.paymentId}`, kind: 'clearCheque', severity: due < 0 ? 'danger' : 'warning',
      title: `Cheque ${due < 0 ? 'overdue' : 'due'} · ${c.paymentNo || c.reference || ''}`.trim(),
      sub: `${c.partyType === 'customer' ? 'From' : 'To'} ${c.party || '—'} · clears ${String(c.dueDate).slice(0, 10)}`,
      amount: num(c.amount), currency: (c.currency || 'PKR').toUpperCase(), due: c.dueDate,
      action: { type: 'clearCheque', label: 'Clear' },
      payload: c,
    }, hasPermission('finance', 'confirm_payment'));
  }

  // 4. Head Office ⇄ Mill transfers waiting for this side to accept.
  for (const t of sources.fundTransfers || []) {
    if (lower(t.status) !== 'pending') continue;
    add({
      key: `transfer-${t.id}`, kind: 'acceptTransfer', severity: 'warning',
      title: `Transfer awaiting acceptance · ${t.transferNo || ''}`.trim(),
      sub: `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}`,
      amount: num(t.toAmount || t.amount), currency: (t.toCurrency || t.currency || 'PKR').toUpperCase(),
      action: { type: 'acceptTransfer', label: 'Accept' },
      payload: t,
    }, canAcceptTransfer(t, hasPermission));
  }

  // 5. Payroll runs prepared (→ Approve) or approved (→ Pay).
  for (const r of sources.payroll?.runs || []) {
    const st = lower(r.status);
    if (st !== 'prepared' && st !== 'approved') continue;
    const approve = st === 'prepared';
    add({
      key: `payroll-${r.id}`, kind: approve ? 'approvePayroll' : 'payPayroll', severity: 'warning',
      title: `Payroll ${r.period} ${approve ? 'prepared' : 'approved'}`,
      sub: `${r.employeeCount || 0} employee(s) · prepared by ${r.preparedBy || '—'}`,
      amount: num(r.net), currency: 'PKR',
      action: { type: approve ? 'approvePayroll' : 'payPayroll', label: approve ? 'Approve' : 'Pay' },
      payload: r,
    }, approve ? hasPermission('payroll', 'approve') : hasPermission('payroll', 'pay'));
  }

  // 6. Approved purchase requests waiting to be bought.
  for (const pr of sources.purchaseRequests || []) {
    if (lower(pr.status) !== 'approved') continue;
    add({
      key: `pr-${pr.id}`, kind: 'markPurchased', severity: 'info',
      title: `Purchase request ${pr.pr_no || pr.prNo || ''} approved`.trim(),
      sub: pr.item_name || pr.itemName || '',
      amount: pr.est_amount != null ? num(pr.est_amount) : null, currency: (pr.currency || 'PKR').toUpperCase(),
      action: { type: 'markPurchased', label: 'Mark purchased' },
      payload: pr,
    }, anyOf(hasPermission, [['finance', 'confirm_payment'], ['milling', 'edit'], ['mill_store', 'create_purchase']]));
  }

  // 7. Open suspense money waiting to be reclassified.
  for (const e of sources.suspense || []) {
    if (['resolved', 'reversed'].includes(lower(e.status))) continue;
    const out = e.outstanding != null ? num(e.outstanding) : num(e.amount) - num(e.resolved_amount);
    if (!(out > 0.004)) continue;
    add({
      key: `suspense-${e.id}`, kind: 'resolveSuspense', severity: 'info',
      title: `Suspense ${e.entry_no || ''} · ${e.direction === 'payment' ? 'money out' : 'money in'}`,
      sub: e.party_details || e.reason || e.bank_account_name || '',
      amount: out, currency: (e.currency || 'PKR').toUpperCase(),
      action: { type: 'resolveSuspense', label: 'Resolve' },
      payload: e,
    }, hasPermission('finance', 'post_journal'));
  }

  // 8. Accounts below zero.
  for (const a of sources.accounts || []) {
    if (!(num(a.currentBalance) < 0) || a.isActive === false) continue;
    add({
      key: `overdrawn-${a.id}`, kind: 'overdrawn', severity: 'danger',
      title: `Overdrawn · ${a.name}`, sub: a.bankName || (a.type === 'cash' ? 'Cash' : ''),
      amount: num(a.currentBalance), currency: (a.currency || 'PKR').toUpperCase(),
      action: { type: 'openAccount', label: 'Open account' },
      payload: a,
    }, hasPermission('finance', 'view'));
  }

  // 9. The USD rate is stale (or there is none — the system default is in use).
  if (sources.fx) {
    const eff = sources.fx.latest?.effectiveDate || sources.fx.latest?.effective_date || null;
    const fallback = !eff || String(sources.fx.latest?.source || '').includes('fallback');
    const age = eff ? -daysUntil(eff, today) : null;
    if (fallback || age > STALE_FX_DAYS) {
      add({
        key: 'fx-stale', kind: 'staleFx', severity: 'warning',
        title: fallback ? 'No USD rate on file — the system default is in use' : `USD rate is ${age} days old`,
        sub: eff ? `Last rate ${String(eff).slice(0, 10)}` : 'Add today’s rate',
        amount: null, currency: null,
        action: { type: 'addRate', label: 'Add rate' },
        payload: null,
      }, hasPermission('finance', 'confirm_payment'));
    }
  }

  // 10. Data warnings the server raises (read-only, everyone with Finance).
  const cogs = sources.summary?.export?.cogsStatus;
  if (cogs && num(cogs.shippedMissingCogs) > 0) {
    items.push({
      key: 'warn-cogs', kind: 'warning', severity: 'warning',
      title: `${cogs.shippedMissingCogs} shipped order(s) without cost of goods`, sub: 'Their profit is overstated until costs are locked.',
      amount: null, currency: null, action: null, payload: null,
    });
  }
  (sources.summary?.warnings || []).forEach((w, i) => {
    if (/Finance → Rates/.test(w) && items.some((x) => x.kind === 'staleFx')) return;
    items.push({ key: `warn-${i}`, kind: 'warning', severity: 'info', title: String(w), sub: '', amount: null, currency: null, action: null, payload: null });
  });

  items.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || (new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15)));
  return { items, hiddenCount: hidden };
}

/** Item counts per currency — for a header that never sums across currencies. */
export function countByCurrency(items = []) {
  const out = {};
  for (const i of items) if (i.currency) out[i.currency] = (out[i.currency] || 0) + 1;
  return out;
}
