import { useMemo, useState, useEffect } from 'react';
import { Landmark, FileText } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { useLocalSales, useAcceptLocalSalePayment } from '../../../api/queries';

const PKR = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { const dt = new Date(d); return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };

// Record a receipt from a local customer AGAINST a specific invoice (local
// sale), so the payment is reconcilable. Uses acceptLocalSalePayment which
// updates the sale AND its receivable.
export default function MillCustomerPayDrawer({ customer, onClose }) {
  const { addToast } = useApp();
  const { data: salesData } = useLocalSales({ customer_id: customer.id, limit: 200 });
  const sales = Array.isArray(salesData) ? salesData : (salesData?.sales || salesData?.localSales || []);
  const payMut = useAcceptLocalSalePayment();
  const [saving, setSaving] = useState(false);

  // Open invoices (due > 0), oldest first.
  const openInvoices = useMemo(() => (sales || [])
    .filter((s) => (parseFloat(s.dueAmount ?? s.due_amount) || 0) > 0.001)
    .sort((a, b) => new Date(a.saleDate || a.sale_date || a.createdAt || 0) - new Date(b.saleDate || b.sale_date || b.createdAt || 0)),
  [sales]);

  const [saleId, setSaleId] = useState('');
  const [form, setForm] = useState({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], collection_location: 'Mill', bank_account_id: '', reference: '', due_date: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Default to the oldest open invoice and its full due.
  useEffect(() => {
    if (!saleId && openInvoices.length) {
      const inv = openInvoices[0];
      setSaleId(String(inv.id));
      setForm((f) => ({ ...f, amount: String(parseFloat(inv.dueAmount ?? inv.due_amount) || 0) }));
    }
  }, [openInvoices, saleId]);

  const selected = openInvoices.find((s) => String(s.id) === String(saleId));
  const due = selected ? (parseFloat(selected.dueAmount ?? selected.due_amount) || 0) : 0;

  function pickInvoice(id) {
    setSaleId(id);
    const inv = openInvoices.find((s) => String(s.id) === String(id));
    if (inv) set('amount', String(parseFloat(inv.dueAmount ?? inv.due_amount) || 0));
  }

  async function submit() {
    const amt = parseFloat(form.amount);
    if (!saleId) { addToast('Select an invoice to pay', 'error'); return; }
    if (!amt || amt <= 0) { addToast('Enter a valid amount', 'error'); return; }
    if (amt > due + 0.01) { addToast(`Amount exceeds the ${PKR(due)} outstanding on this invoice`, 'error'); return; }
    setSaving(true);
    try {
      await payMut.mutateAsync({ saleId, data: {
        amount: amt, payment_method: form.payment_method, payment_date: form.payment_date,
        collection_location: form.collection_location, bank_account_id: form.bank_account_id || null,
        reference: form.reference || null, due_date: form.due_date || null,
      } });
      addToast(`${PKR(amt)} recorded against ${selected?.saleNo || selected?.sale_no || 'invoice'}`, 'success');
      onClose();
    } catch (err) { addToast(err?.response?.data?.message || err.message || 'Payment failed', 'error'); }
    setSaving(false);
  }

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button onClick={submit} disabled={saving || !openInvoices.length}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
        {saving ? 'Processing…' : `Record ${PKR(parseFloat(form.amount) || 0)}`}
      </button>
    </div>
  );

  return (
    <SlideDrawer open onClose={onClose} title="Record Payment" subtitle={customer.name} icon={Landmark} size="md" footer={footer}>
      <div className="space-y-4">
        {openInvoices.length === 0 ? (
          <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            No open invoices — this customer has nothing outstanding.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Pay against invoice *</label>
              <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-200 p-1.5">
                {openInvoices.map((s) => {
                  const id = String(s.id);
                  const sd = parseFloat(s.dueAmount ?? s.due_amount) || 0;
                  const no = s.saleNo || s.sale_no;
                  return (
                    <button key={id} type="button" onClick={() => pickInvoice(id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm border ${saleId === id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FileText size={14} className="text-gray-400 shrink-0" />
                        <span className="font-medium text-gray-800 truncate">{no}</span>
                        <span className="text-xs text-gray-400">{fmtDate(s.saleDate || s.sale_date || s.createdAt)}</span>
                      </span>
                      <span className="text-xs shrink-0"><span className="text-gray-400">due</span> <span className="font-semibold text-amber-700">{PKR(sd)}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Amount (PKR) *</label>
                <input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} min="0" max={due}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                {selected && <p className="text-[11px] text-gray-400 mt-1">Outstanding: {PKR(due)}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Date</label>
                <input type="date" value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Payment Method</label>
              <select value={form.payment_method}
                onChange={(e) => { const m = e.target.value; setForm((f) => ({ ...f, payment_method: m, bank_account_id: '' })); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="cash">Cash</option><option value="cheque">Cheque</option>
              </select>
            </div>

            {form.payment_method === 'cash' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Collected at</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Mill', 'Head Office'].map((loc) => (
                    <button key={loc} type="button" onClick={() => set('collection_location', loc)}
                      className={`px-3 py-2 text-sm font-medium rounded-lg border ${form.collection_location === loc ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>{loc}</button>
                  ))}
                </div>
              </div>
            )}

            {form.payment_method === 'cheque' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Cheque clears on <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Reference {form.payment_method === 'cheque' ? '/ Cheque #' : ''}</label>
              <input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Receipt / cheque #"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <p className="text-[11px] text-gray-400">Recorded against the selected invoice so the sale, the customer balance, and the receivable all reconcile.</p>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}
