import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Wallet, HandCoins, Info } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useReceivables, usePayables, useBankAccounts, useRecordPayment } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';

// Small currency formatter — mirrors the symbols used across the finance pages.
function curSymbol(cur) {
  const c = (cur || 'PKR').toUpperCase();
  return c === 'PKR' ? 'Rs ' : c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'AED' ? 'AED ' : `${c} `;
}
function fmt(v, cur) {
  const n = parseFloat(v) || 0;
  return `${curSymbol(cur)}${Math.round(n).toLocaleString()}`;
}

const eqStatus = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const sumOut = (rows) => rows.reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);

/**
 * Right-side drawer to settle a party's balance straight from its ledger.
 *
 * The statement balance is GL-driven, but the receivables / payables sub-ledger
 * (Money In / Money Out) tracks the same money per invoice. To keep both in sync
 * we don't post a bare on-account journal — we allocate the entered amount across
 * the party's OPEN invoices oldest-first (FIFO) and reuse the existing, tested
 * recordPayment endpoint per invoice. Each call updates the receivable/payable,
 * the bank account, and posts a party-stamped journal, so the statement and the
 * aging lists both move together.
 */
export default function StatementPayDrawer({ mode, party, onClose }) {
  const isCustomer = mode === 'customer';
  const { addToast } = useApp();
  const qc = useQueryClient();
  const recordPaymentMut = useRecordPayment();
  const { data: bankAccounts = [] } = useBankAccounts();
  // Only one side is ever relevant; React Query caches both cheaply.
  const { data: receivables = [], isLoading: rLoading } = useReceivables();
  const { data: payables = [], isLoading: pLoading } = usePayables();
  const loading = isCustomer ? rLoading : pLoading;

  // Open, unpaid items for this party, with a positive outstanding.
  const openItems = useMemo(() => {
    const src = isCustomer ? receivables : payables;
    const idKey = isCustomer ? 'customerId' : 'supplierId';
    return src
      .filter((r) => String(r[idKey]) === String(party.id))
      .filter((r) => !eqStatus(r.status, 'Paid') && (parseFloat(r.outstanding) || 0) > 0)
      // Payables include DERIVED rows (mill costs / export costs) with string ids
      // like "MC-123" — those aren't real, settleable `payables` rows and the
      // backend's linked_payable_id is a numeric Joi field, so submitting them
      // always 400s. Only offer real stored payables (numeric id) as pay targets.
      .filter((r) => isCustomer || /^\d+$/.test(String(r.dbId || r.id)));
  }, [isCustomer, receivables, payables, party.id]);

  // A party is almost always single-currency (export = USD, local/mill = PKR),
  // but group by currency so a stray mixed-currency invoice doesn't get summed
  // into an apples-to-oranges total. The user pays one currency bucket at a time.
  const byCurrency = useMemo(() => {
    const m = {};
    openItems.forEach((r) => {
      const c = (r.currency || 'PKR').toUpperCase();
      (m[c] ||= []).push(r);
    });
    return m;
  }, [openItems]);
  const currencies = useMemo(
    () => Object.keys(byCurrency).sort((a, b) => sumOut(byCurrency[b]) - sumOut(byCurrency[a])),
    [byCurrency],
  );

  const [curOverride, setCurOverride] = useState('');
  const activeCur = curOverride || currencies[0] || 'PKR';

  // Which invoice to settle: '' = all open (oldest-first FIFO), or a specific
  // invoice id so the user pays ONE bill instead of the whole balance.
  const [targetId, setTargetId] = useState('');

  // Items of the active currency, oldest-first. The full sorted list drives the
  // picker; the FIFO queue is this list narrowed to the chosen target.
  const sortedItems = useMemo(() => {
    const rows = [...(byCurrency[activeCur] || [])];
    rows.sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const dbb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (da !== dbb) return da - dbb;
      return (a.dbId || a.id || 0) - (b.dbId || b.id || 0);
    });
    return rows;
  }, [byCurrency, activeCur]);
  const queue = useMemo(
    () => (targetId ? sortedItems.filter((r) => String(r.dbId || r.id) === String(targetId)) : sortedItems),
    [sortedItems, targetId],
  );
  const totalOut = useMemo(() => sumOut(queue), [queue]);

  const [form, setForm] = useState({
    amount: '',
    bankAccountId: '',
    method: 'bank_transfer',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  // Default the amount to the full bucket once the queue resolves / currency
  // switches, unless the user has typed their own figure.
  const [amountTouched, setAmountTouched] = useState(false);
  const effectiveAmount = amountTouched ? parseFloat(form.amount) || 0 : totalOut;

  // FIFO allocation preview — how the entered amount lands across invoices.
  const allocation = useMemo(() => {
    let remaining = Math.min(effectiveAmount, totalOut);
    const plan = [];
    for (const it of queue) {
      if (remaining <= 0.0001) break;
      const out = parseFloat(it.outstanding) || 0;
      const chunk = Math.min(remaining, out);
      if (chunk > 0) {
        plan.push({ item: it, chunk });
        remaining -= chunk;
      }
    }
    return plan;
  }, [queue, effectiveAmount, totalOut]);

  const allocatedTotal = allocation.reduce((s, a) => s + a.chunk, 0);
  const overpay = effectiveAmount > totalOut + 0.0001;
  const verb = isCustomer ? 'Receipt' : 'Payment';
  const refOf = (it) => it.recvNo || it.payNo || `#${it.dbId || it.id}`;

  function setAmount(v) {
    setAmountTouched(true);
    setForm((f) => ({ ...f, amount: v }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (allocatedTotal <= 0) {
      addToast('Enter a valid amount to apply', 'error');
      return;
    }
    try {
      // Sequential so each invoice's outstanding is read fresh by the backend.
      for (const { item, chunk } of allocation) {
        await recordPaymentMut.mutateAsync({
          type: isCustomer ? 'receipt' : 'payment',
          amount: Number(chunk.toFixed(2)),
          currency: activeCur,
          payment_method: form.method,
          payment_date: form.date,
          bank_account_id: form.bankAccountId || null,
          ...(isCustomer
            ? { linked_receivable_id: item.dbId || item.id }
            : { linked_payable_id: item.dbId || item.id }),
          notes: form.notes || `${verb} for ${refOf(item)} — ${party.name}`,
        });
      }
      // recordPayment already invalidates receivables/payables/overview/journals;
      // the statement is GL-driven, so refresh it too.
      qc.invalidateQueries({ queryKey: ['party-statement'] });
      addToast(
        `${verb} of ${fmt(allocatedTotal, activeCur)} recorded across ${allocation.length} invoice${allocation.length === 1 ? '' : 's'}`,
        'success',
      );
      onClose();
    } catch (err) {
      // A mid-loop failure still applied the earlier chunks — refresh so the UI
      // shows what actually went through.
      qc.invalidateQueries({ queryKey: ['party-statement'] });
      addToast(`Failed: ${err.message}`, 'error');
    }
  }

  const Icon = isCustomer ? Wallet : HandCoins;

  return (
    <SlideDrawer
      open
      onClose={onClose}
      icon={Icon}
      title={`Record ${verb}`}
      subtitle={party.name}
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading open invoices…</div>
      ) : queue.length === 0 ? (
        <div className="py-10 text-center">
          <Info size={28} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            No open invoices to settle for this {mode}.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            This party’s balance isn’t tied to an open {isCustomer ? 'receivable' : 'payable'}, so there’s nothing to apply a {verb.toLowerCase()} against here.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Outstanding summary + optional currency switch */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Open outstanding ({activeCur})</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{fmt(totalOut, activeCur)}</p>
              <p className="text-[11px] text-gray-400">{queue.length} open invoice{queue.length === 1 ? '' : 's'}</p>
            </div>
            {currencies.length > 1 && (
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Currency</label>
                <select
                  value={activeCur}
                  onChange={(e) => { setCurOverride(e.target.value); setTargetId(''); setAmountTouched(false); }}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Which invoice to pay — default "All open (FIFO)" or pick ONE bill */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              {isCustomer ? 'Apply receipt to' : 'Apply payment to'}
            </label>
            <select
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setAmountTouched(false); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All open — oldest first ({sortedItems.length} invoice{sortedItems.length === 1 ? '' : 's'}, {fmt(sumOut(sortedItems), activeCur)})</option>
              {sortedItems.map((it) => (
                <option key={it.dbId || it.id} value={it.dbId || it.id}>
                  {refOf(it)} — {fmt(it.outstanding, activeCur)}{it.dueDate ? ` · due ${new Date(it.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              {targetId
                ? 'Only this invoice will be settled.'
                : 'The amount is spread across open invoices, oldest first — it may settle more than one.'}
            </p>
          </div>

          {/* Bank account */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              {isCustomer ? 'Receive into account' : 'Pay from account'}
            </label>
            <select
              value={form.bankAccountId}
              onChange={(e) => {
                const id = e.target.value;
                // A cash account (e.g. Office Petty Cash) implies a cash payment;
                // switching back to a bank account flips the default back. A
                // non-cash method the user picked themselves is left alone.
                const acct = bankAccounts.find((a) => String(a.id) === String(id));
                setForm((f) => ({
                  ...f,
                  bankAccountId: id,
                  method: acct?.type === 'cash'
                    ? 'cash'
                    : (f.method === 'cash' ? 'bank_transfer' : f.method),
                }));
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select bank account…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.bankName || ''} ({a.currency || 'PKR'} {Math.round(parseFloat(a.currentBalance) || 0).toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {/* Amount + date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Amount ({activeCur})</label>
              <input
                type="number" step="0.01" min="0"
                value={amountTouched ? form.amount : String(Math.round(totalOut))}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Date</label>
              <input
                type="date" required value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Quick amounts */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAmount(String(Math.round(totalOut)))}
              className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Full</button>
            <button type="button" onClick={() => setAmount(String(Math.round(totalOut / 2)))}
              className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Half</button>
            <button type="button" onClick={() => setAmount('')}
              className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Custom</button>
          </div>

          {/* Method */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Method</label>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="bank_transfer">Bank Transfer / TT</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              {isCustomer && <option value="lc">Letter of Credit</option>}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Notes</label>
            <input
              type="text" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={`${verb} from ${party.name}`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* FIFO allocation preview */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">{targetId ? 'Applies to' : 'Applies to (oldest first)'}</p>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-44 overflow-y-auto">
              {allocation.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400">Enter an amount to see how it’s applied.</p>
              ) : (
                allocation.map(({ item, chunk }) => {
                  const out = parseFloat(item.outstanding) || 0;
                  const settles = chunk >= out - 0.0001;
                  return (
                    <div key={item.dbId || item.id} className="px-3 py-2 flex items-center justify-between text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-700">{refOf(item)}</span>
                        <span className="text-gray-400 ml-2">
                          {item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                        </span>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <span className="tabular-nums text-gray-900">{fmt(chunk, activeCur)}</span>
                        <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${settles ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {settles ? 'Paid' : 'Partial'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {overpay && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                Amount exceeds the open outstanding — only {fmt(totalOut, activeCur)} will be applied.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={recordPaymentMut.isPending || allocatedTotal <= 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm disabled:opacity-50">
            <CheckCircle size={16} />
            {recordPaymentMut.isPending
              ? 'Processing…'
              : `Record ${verb} — ${fmt(allocatedTotal, activeCur)}`}
          </button>
        </form>
      )}
    </SlideDrawer>
  );
}
