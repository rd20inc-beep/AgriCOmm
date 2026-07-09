import { useState, useMemo } from 'react';
import { FileText, Wallet } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { serviceMillingApi } from '../api/services';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => `PKR ${Math.round(num(v)).toLocaleString()}`;

/**
 * Create a Service Milling invoice for a batch. `batch` is a row from the
 * service-batches feed (client_name, service rates, milled/katta counts).
 */
export function CreateInvoiceDrawer({ open, batch, onClose, onCreated, addToast }) {
  const [f, setF] = useState(null);
  // Initialise from the batch when opened.
  const init = useMemo(() => (batch ? {
    milling_qty_kg: String(Math.round(num(batch.milled_kg) || num(batch.actual_finished_kg) || 0)),
    milling_rate_per_kg: batch.service_milling_rate_per_kg ?? '',
    rental_kattas: String(num(batch.katta_count) || num(batch.bag_count) || 0),
    rental_rate_per_katta: batch.service_rental_rate_per_katta ?? '',
    labour_kattas: String(num(batch.katta_count) || num(batch.bag_count) || 0),
    labour_rate_per_katta: batch.service_labour_rate_per_katta ?? '',
    extra_charges: '', discount: '', tax_pct: '', notes: '',
  } : null), [batch]);
  const form = f || init || {};
  const set = (k, v) => setF({ ...form, [k]: v });
  const [saving, setSaving] = useState(false);

  const milling = num(form.milling_qty_kg) * num(form.milling_rate_per_kg);
  const rental = num(form.rental_kattas) * num(form.rental_rate_per_katta);
  const labour = num(form.labour_kattas) * num(form.labour_rate_per_katta);
  const subtotal = milling + rental + labour + num(form.extra_charges) - num(form.discount);
  const tax = subtotal * (num(form.tax_pct) / 100);
  const total = subtotal + tax;

  async function submit() {
    if (total <= 0) { addToast?.('Enter at least one service rate — total must be > 0', 'error'); return; }
    setSaving(true);
    try {
      const res = await serviceMillingApi.createInvoice({ service_batch_id: batch.id, ...form });
      addToast?.(`Invoice ${res?.data?.invoice_no || ''} created`, 'success');
      setF(null);
      onCreated?.(res?.data);
      onClose?.();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to create invoice', 'error');
    } finally { setSaving(false); }
  }

  const Row = ({ label, qtyKey, rateKey, unit }) => (
    <div className="grid grid-cols-12 gap-2 items-end">
      <div className="col-span-5">
        <label className="block text-[11px] font-medium text-gray-600 mb-1">{label} ({unit})</label>
        <input type="number" min="0" value={form[qtyKey] ?? ''} onChange={e => set(qtyKey, e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <div className="col-span-4">
        <label className="block text-[11px] font-medium text-gray-600 mb-1">Rate</label>
        <input type="number" step="0.01" min="0" value={form[rateKey] ?? ''} onChange={e => set(rateKey, e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <div className="col-span-3 text-right text-sm font-medium text-gray-800 pb-1.5">{pkr(num(form[qtyKey]) * num(form[rateKey]))}</div>
    </div>
  );

  return (
    <SlideDrawer open={open} onClose={onClose} title="Create Service Milling Invoice" subtitle={batch ? `${batch.batch_no} · ${batch.client_name || 'client'}` : ''} icon={FileText} size="lg"
      footer={<div className="flex items-center justify-between w-full">
        <span className="text-sm text-gray-500">Total <b className="text-emerald-700 text-base">{pkr(total)}</b></span>
        <button onClick={submit} disabled={saving || total <= 0} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create Invoice'}</button>
      </div>}>
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">This is a <b>service</b> invoice (milling / rental / labour), not a sale of rice. The rice belongs to the client.</div>
        <Row label="Milling — KG milled" qtyKey="milling_qty_kg" rateKey="milling_rate_per_kg" unit="kg" />
        <Row label="Rental — kattas" qtyKey="rental_kattas" rateKey="rental_rate_per_katta" unit="katta" />
        <Row label="Labour — kattas" qtyKey="labour_kattas" rateKey="labour_rate_per_katta" unit="katta" />
        <div className="grid grid-cols-3 gap-2">
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Extra Charges</label><input type="number" min="0" value={form.extra_charges ?? ''} onChange={e => set('extra_charges', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" /></div>
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Discount</label><input type="number" min="0" value={form.discount ?? ''} onChange={e => set('discount', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" /></div>
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Tax %</label><input type="number" min="0" step="0.01" value={form.tax_pct ?? ''} onChange={e => set('tax_pct', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" /></div>
        </div>
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Milling</span><span>{pkr(milling)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Rental</span><span>{pkr(rental)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Labour</span><span>{pkr(labour)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Subtotal (+extra −disc)</span><span>{pkr(subtotal)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Tax</span><span>{pkr(tax)}</span></div>
          <div className="flex justify-between px-3 py-2 bg-gray-50 font-bold"><span>Total Payable</span><span className="text-emerald-700">{pkr(total)}</span></div>
        </div>
        <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Notes</label><input type="text" value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" /></div>
      </div>
    </SlideDrawer>
  );
}

/** Record a payment against a service invoice. `invoice` has total/received/balance. */
export function RecordPaymentDrawer({ open, invoice, onClose, onPaid, addToast }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const balance = invoice ? num(invoice.balance_amount) : 0;

  async function submit() {
    const amt = num(amount);
    if (amt <= 0) { addToast?.('Enter a payment amount', 'error'); return; }
    if (amt - balance > 0.009) { addToast?.(`Amount exceeds balance (${pkr(balance)})`, 'error'); return; }
    setSaving(true);
    try {
      await serviceMillingApi.recordPayment(invoice.id, { amount: amt, payment_method: method, reference: reference || null });
      addToast?.('Payment recorded', 'success');
      setAmount(''); setReference('');
      onPaid?.();
      onClose?.();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to record payment', 'error');
    } finally { setSaving(false); }
  }

  return (
    <SlideDrawer open={open} onClose={onClose} title="Record Payment" subtitle={invoice ? `${invoice.invoice_no} · ${invoice.client_name || ''}` : ''} icon={Wallet} size="md"
      footer={<button onClick={submit} disabled={saving} className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Recording…' : 'Record Payment'}</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-gray-200 p-2"><p className="text-[10px] uppercase text-gray-400">Total</p><p className="font-bold text-gray-800">{pkr(invoice?.total_amount)}</p></div>
          <div className="rounded-lg border border-gray-200 p-2"><p className="text-[10px] uppercase text-gray-400">Received</p><p className="font-bold text-emerald-700">{pkr(invoice?.received_amount)}</p></div>
          <div className="rounded-lg border border-gray-200 p-2"><p className="text-[10px] uppercase text-gray-400">Balance</p><p className="font-bold text-rose-600">{pkr(balance)}</p></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR)</label>
          <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} autoFocus className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={() => setAmount(String(Math.round(balance)))} className="text-xs text-blue-600 mt-1">Pay full balance</button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference (optional)</label>
          <input type="text" value={reference} onChange={e => setReference(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
    </SlideDrawer>
  );
}
