import { useMemo, useState, useEffect } from 'react';
import { Landmark, FileText } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { usePayables, useRecordPayment } from '../../../api/queries';

const PKR = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { if (!d) return ''; const dt = new Date(d); return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };

// Pay a supplier AGAINST a specific invoice (payable), so each payment records
// which invoice it settled — reconcilable later. Uses recordPayment with
// linked_payable_id (updates the payable + bank + posts a party-stamped journal).
export default function MillSupplierPayDrawer({ supplier, onClose }) {
  const { addToast, bankAccountsList = [] } = useApp();
  const { data: payables = [] } = usePayables();
  const payMut = useRecordPayment();
  const [saving, setSaving] = useState(false);

  // Open invoices (outstanding > 0) for this supplier, oldest first.
  const openInvoices = useMemo(() => (payables || [])
    .filter((p) => String(p.supplierId) === String(supplier.id))
    .filter((p) => (parseFloat(p.outstanding) || 0) > 0.001 && (p.status || '').toLowerCase() !== 'paid')
    .sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return (da - db) || ((a.dbId || a.id || 0) - (b.dbId || b.id || 0));
    }), [payables, supplier.id]);

  // Mill Finance pays only from its own cash float (Mill Cash) — never from a
  // Head Office bank account, and Head Office balances are never shown here.
  const millCash = useMemo(() => (Array.isArray(bankAccountsList) ? bankAccountsList : [])
    .find((b) => (b.type === 'cash') && ((b.entity || 'general') === 'mill'))
    || (Array.isArray(bankAccountsList) ? bankAccountsList : []).find((b) => b.type === 'cash'), [bankAccountsList]);

  const [payId, setPayId] = useState('');
  const [form, setForm] = useState({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], bank_account_id: '', reference: '', due_date: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!payId && openInvoices.length) {
      const inv = openInvoices[0];
      setPayId(String(inv.dbId || inv.id));
      setForm((f) => ({ ...f, amount: String(parseFloat(inv.outstanding) || 0) }));
    }
  }, [openInvoices, payId]);

  const selected = openInvoices.find((p) => String(p.dbId || p.id) === String(payId));
  const out = selected ? (parseFloat(selected.outstanding) || 0) : 0;
  const cur = selected?.currency || 'PKR';
  const invRef = (p) => p.linkedRef || p.payNo || `#${p.dbId || p.id}`;

  function pick(id) {
    setPayId(id);
    const inv = openInvoices.find((p) => String(p.dbId || p.id) === String(id));
    if (inv) set('amount', String(parseFloat(inv.outstanding) || 0));
  }

  async function submit() {
    const amt = parseFloat(form.amount);
    if (!payId) { addToast('Select an invoice to pay', 'error'); return; }
    if (!amt || amt <= 0) { addToast('Enter a valid amount', 'error'); return; }
    if (amt > out + 0.01) { addToast(`Amount exceeds the ${PKR(out)} outstanding on this invoice`, 'error'); return; }
    setSaving(true);
    try {
      await payMut.mutateAsync({
        type: 'payment', amount: Number(amt.toFixed(2)), currency: cur,
        payment_method: 'cash', payment_date: form.payment_date,
        bank_account_id: millCash?.id || null, due_date: form.due_date || null,
        bank_reference: form.reference || null, linked_payable_id: selected.dbId || selected.id,
        notes: `Payment for ${invRef(selected)} — ${supplier.name}`,
      });
      addToast(`${PKR(amt)} paid against ${invRef(selected)}`, 'success');
      onClose();
    } catch (err) { addToast(err?.response?.data?.message || err.message || 'Payment failed', 'error'); }
    setSaving(false);
  }

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button onClick={submit} disabled={saving || !openInvoices.length}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
        {saving ? 'Processing…' : `Pay ${PKR(parseFloat(form.amount) || 0)}`}
      </button>
    </div>
  );

  return (
    <SlideDrawer open onClose={onClose} title="Record Payment" subtitle={supplier.name} icon={Landmark} size="md" footer={footer}>
      <div className="space-y-4">
        {openInvoices.length === 0 ? (
          <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            No open invoices — nothing outstanding to this supplier.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Pay against invoice *</label>
              <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-200 p-1.5">
                {openInvoices.map((p) => {
                  const id = String(p.dbId || p.id);
                  return (
                    <button key={id} type="button" onClick={() => pick(id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm border ${payId === id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FileText size={14} className="text-gray-400 shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium text-gray-800 truncate block">{invRef(p)}</span>
                          {(p.category || p.dueDate) && <span className="text-[11px] text-gray-400">{p.category || ''}{p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ''}</span>}
                        </span>
                      </span>
                      <span className="text-xs shrink-0"><span className="text-gray-400">bal</span> <span className="font-semibold text-amber-700">{PKR(p.outstanding)}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Amount ({cur}) *</label>
                <input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} min="0" max={out}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                {selected && <p className="text-[11px] text-gray-400 mt-1">Outstanding: {PKR(out)}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Date</label>
                <input type="date" value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>

            <div className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-800">
              Paid from <span className="font-semibold">{millCash?.name || 'Mill Cash'}</span>. The mill settles
              supplier bills from its cash float; fund it from Head Office if it runs short.
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Reference</label>
              <input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Voucher #"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <p className="text-[11px] text-gray-400">Recorded against the selected invoice so the payable, the supplier balance and the GL all reconcile.</p>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}
