import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { localSalesApi } from '../api/services';
import { useBankAccounts } from '../../../api/queries';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { fmtPKR, fmtDate } from '../../../shared/utils/format';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => fmtPKR(num(v), { decimals: 2 });
const REFUND_METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['online', 'Online'], ['mobile', 'Mobile wallet']];

/**
 * Returns / credit notes on one confirmed sale line (P3-11, owner decision
 * D-22). A return is its own document (LSR-…): the goods go back to the lot
 * they came from at the cost they left at, revenue and cost of goods come back
 * out, what is still owed is reduced first and the rest is refunded or kept as
 * the customer's credit. The sale itself is never edited. Owner-approved.
 */
export default function SaleReturnsPanel({ sale, canCreate, addToast, onChanged }) {
  const saleId = sale?.id;
  const { data: returns = [], refetch } = useQuery({
    queryKey: ['local-sale-returns', saleId],
    queryFn: async () => {
      const res = await localSalesApi.returns(saleId);
      return res?.data?.returns || res?.returns || [];
    },
    enabled: !!saleId,
  });
  const [open, setOpen] = useState(false);

  const isLot = !!(sale?.lotId || sale?.lot_id);
  const soldQty = isLot ? num(sale?.quantityKg) : (num(sale?.quantityBags) || num(sale?.quantityKg));
  const returnedQty = returns.reduce((s, r) => s + num(r.quantity_kg), 0);
  const left = Math.max(0, Math.round((soldQty - returnedQty) * 1000) / 1000);
  const unit = isLot ? 'kg' : 'units';
  const canReturn = canCreate && sale?.status === 'Completed' && left > 0;

  if (!returns.length && !canReturn) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Returns</h3>
        {canReturn && (
          <button onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-50 rounded-lg ring-1 ring-amber-200 hover:bg-amber-100">
            <RotateCcw size={14} /> Record return
          </button>
        )}
      </div>
      {returns.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No returns against this sale.</p>
      ) : (
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="px-3 py-2">Return</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2">Settled as</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returns.map((r) => (
                <tr key={r.id}>
                  <td data-label="Return" className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.return_no}</td>
                  <td data-label="Date" className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(r.return_date)}</td>
                  <td data-label="Qty" className="px-3 py-2 text-right tabular-nums">{num(r.quantity_kg).toLocaleString()} {unit}</td>
                  <td data-label="Value" className="px-3 py-2 text-right tabular-nums">{pkr(r.return_value)}</td>
                  <td data-label="Settled as" className="px-3 py-2 text-xs text-gray-700">
                    {num(r.applied_to_receivable) > 0 && <div>Off the amount due: {pkr(r.applied_to_receivable)}</div>}
                    {num(r.refund_amount) > 0 && <div>Refunded {pkr(r.refund_amount)}{r.refund_payment_no ? ` (${r.refund_payment_no})` : ''}</div>}
                    {num(r.credit_amount) > 0 && <div>Customer credit {pkr(r.credit_amount)} · {r.credit_status}</div>}
                  </td>
                  <td data-label="Reason" className="px-3 py-2 text-xs text-gray-500">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <ReturnDrawer sale={sale} left={left} unit={unit} soldQty={soldQty}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); refetch(); onChanged?.(); }}
          addToast={addToast} />
      )}
    </div>
  );
}

function ReturnDrawer({ sale, left, unit, soldQty, onClose, onDone, addToast }) {
  const { requestOwnerApproval } = useOwnerAuth();
  const { data: accounts = [] } = useBankAccounts();
  const [form, setForm] = useState({ quantity: String(left), reason: '', settlement: '', refund_method: 'cash', refund_bank_account_id: '', refund_reference: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const qty = num(form.quantity);
  // An estimate for the form only — the server computes the exact figures from
  // what the sale posted (the last return takes whatever is left).
  const value = soldQty > 0 ? Math.round(num(sale.totalAmount) * qty / soldQty * 100) / 100 : 0;
  const due = num(sale.dueAmount);
  const excess = Math.max(0, Math.round((value - Math.min(value, due)) * 100) / 100);
  const hasCustomer = !!(sale.customerId || sale.customer_id);
  const needsAccount = form.settlement === 'refund' && form.refund_method !== 'cash';
  const valid = qty > 0 && qty <= left + 0.001 && form.reason.trim().length >= 3
    && (excess <= 0.005 || ['refund', 'credit'].includes(form.settlement))
    && (!needsAccount || form.refund_bank_account_id);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body = {
        quantity: qty, reason: form.reason.trim(),
        settlement: excess > 0.005 ? form.settlement : null,
        refund_method: form.settlement === 'refund' ? form.refund_method : null,
        refund_bank_account_id: needsAccount ? parseInt(form.refund_bank_account_id, 10) : null,
        refund_reference: form.refund_reference || null,
      };
      await requestOwnerApproval((ownerId) => localSalesApi.createReturn(sale.id, { ...body, authorized_by_owner_id: ownerId }),
        { label: `Return on ${sale.saleNo}` });
      addToast?.('Return recorded', 'success');
      onDone();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Could not record the return', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideDrawer open onClose={onClose} title={`Return on ${sale.saleNo}`} subtitle="Goods back to their lot at the original cost" icon={RotateCcw}
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={submit} disabled={!valid || busy}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Recording…' : 'Record return'}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Quantity returned ({unit}) — up to {left.toLocaleString()}</span>
          <input type="number" min="0" step="0.001" value={form.quantity} onChange={set('quantity')}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right tabular-nums" />
        </label>
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <div className="flex justify-between"><span>Value of the return (about)</span><span className="tabular-nums font-medium">{pkr(value)}</span></div>
          <div className="flex justify-between"><span>Comes off what is still due</span><span className="tabular-nums">{pkr(Math.min(value, due))}</span></div>
          <div className="flex justify-between"><span>Already paid — to refund or credit</span><span className="tabular-nums">{pkr(excess)}</span></div>
        </div>
        {excess > 0.005 && (
          <div className="space-y-3">
            <span className="block text-xs font-medium text-gray-600">The paid part</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm((p) => ({ ...p, settlement: 'refund' }))}
                className={`flex-1 px-3 py-2 text-sm rounded-lg ring-1 ${form.settlement === 'refund' ? 'bg-amber-50 ring-amber-400 text-amber-900' : 'ring-gray-200 text-gray-700'}`}>
                Refund the money
              </button>
              <button type="button" disabled={!hasCustomer} onClick={() => setForm((p) => ({ ...p, settlement: 'credit' }))}
                title={hasCustomer ? '' : 'A walk-in sale has no customer account to hold a credit'}
                className={`flex-1 px-3 py-2 text-sm rounded-lg ring-1 disabled:opacity-40 ${form.settlement === 'credit' ? 'bg-amber-50 ring-amber-400 text-amber-900' : 'ring-gray-200 text-gray-700'}`}>
                Keep as customer credit
              </button>
            </div>
            {form.settlement === 'refund' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-gray-500">Paid out by</span>
                  <select value={form.refund_method} onChange={set('refund_method')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                    {REFUND_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {needsAccount && (
                  <label className="block">
                    <span className="text-xs text-gray-500">From account</span>
                    <select value={form.refund_bank_account_id} onChange={set('refund_bank_account_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Choose…</option>
                      {accounts.filter((a) => (a.currency || 'PKR') === 'PKR' && a.type !== 'cash').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="block col-span-2">
                  <span className="text-xs text-gray-500">Reference (optional)</span>
                  <input value={form.refund_reference} onChange={set('refund_reference')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </label>
              </div>
            )}
          </div>
        )}
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Reason</span>
          <textarea rows={2} value={form.reason} onChange={set('reason')} placeholder="Why the goods came back"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <p className="text-[11px] text-gray-500">
          The sale stays as it is; the return is recorded as its own document. Needs the Owner&apos;s authorization.
        </p>
      </div>
    </SlideDrawer>
  );
}
