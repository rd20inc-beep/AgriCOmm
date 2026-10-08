import { useState, useMemo } from 'react';
import { FileText } from 'lucide-react';
import PaymentFormDrawer from '../../../components/payments/PaymentFormDrawer';
import SlideDrawer from '../../../components/SlideDrawer';
import { serviceMillingApi } from '../api/services';
import { useHaulers } from '../../../api/queries';
import HaulerPicker from '../../../components/HaulerPicker';
import { fmtPKR, fmtKg, fmtNum } from '../../../shared/utils/format';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => fmtPKR(num(v), { decimals: 2 });

const kg0 = (v) => fmtKg(num(v));
const bags0 = (v) => fmtNum(num(v), 0);

/**
 * Create a Service Milling invoice for a batch. `batch` is a row from the
 * service-batches feed (client_name, service rates, and a `quantities` breakdown:
 * received / milled / unmilled / dispatched / in-stock). Each service line bills
 * on its OWN editable chargeable quantity — milling per kg milled, rental & labour
 * per katta/bag — so charges are never forced onto the full received quantity.
 */
export function CreateInvoiceDrawer({ open, batch, onClose, onCreated, addToast }) {
  const q = batch?.quantities || {};
  const [f, setF] = useState(null);
  const init = useMemo(() => (batch ? {
    // Milling defaults to what was actually milled; rental & labour to the full
    // received bags — all independently editable below.
    milling_qty_kg: String(Math.round(num(q.milledKg) || num(batch.milled_kg) || 0)),
    milling_rate_per_kg: batch.service_milling_rate_per_kg ?? '',
    rental_kattas: String(Math.round(num(q.receivedBags) || num(batch.katta_count) || num(batch.bag_count) || 0)),
    rental_rate_per_katta: batch.service_rental_rate_per_katta ?? '',
    rental_from: '', rental_to: '',
    labour_kattas: String(Math.round(num(q.receivedBags) || num(batch.katta_count) || num(batch.bag_count) || 0)),
    labour_rate_per_katta: batch.service_labour_rate_per_katta ?? '',
    extra_charges: '', discount: '', tax_pct: '', notes: '',
    freight_amount: '', freight_hauler_id: '',
  } : null), [batch]);
  const form = f || init || {};
  const set = (k, v) => setF({ ...form, [k]: v });
  const [saving, setSaving] = useState(false);
  const { data: haulers = [] } = useHaulers();

  const milling = num(form.milling_qty_kg) * num(form.milling_rate_per_kg);
  const rental = num(form.rental_kattas) * num(form.rental_rate_per_katta);
  const labour = num(form.labour_kattas) * num(form.labour_rate_per_katta);
  const subtotal = milling + rental + labour + num(form.extra_charges) - num(form.discount);
  const tax = subtotal * (num(form.tax_pct) / 100);
  const freight = num(form.freight_amount);
  const total = subtotal + tax + freight;

  async function submit() {
    if (total <= 0) { addToast?.('Enter at least one service rate — total must be > 0', 'error'); return; }
    if (freight > 0 && !form.freight_hauler_id) { addToast?.('Select the hauler for the client freight.', 'error'); return; }
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

  const Chip = ({ label, onClick }) => (
    <button type="button" onClick={onClick} className="px-2 py-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap">{label}</button>
  );
  const inputCls = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm';

  return (
    <SlideDrawer open={open} onClose={onClose} title="Create Service Milling Invoice" subtitle={batch ? `${batch.batch_no} · ${batch.client_name || 'client'}` : ''} icon={FileText} size="lg"
      footer={<div className="flex items-center justify-between w-full">
        <span className="text-sm text-gray-500">Total <b className="text-emerald-700 text-base">{pkr(total)}</b></span>
        <button onClick={submit} disabled={saving || total <= 0} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create Invoice'}</button>
      </div>}>
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">This is a <b>service</b> invoice (milling / rental / labour), not a sale of rice. Each service is billed on its own chargeable quantity — they don't have to match the received quantity.</div>

        {/* Lot quantity breakdown */}
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Lot Quantities</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm">
            <div><span className="block text-[11px] text-gray-400">Received</span><span className="font-medium text-gray-900">{kg0(q.receivedKg)} · {bags0(q.receivedBags)} bags</span></div>
            <div><span className="block text-[11px] text-gray-400">Milled</span><span className="font-medium text-gray-900">{kg0(q.milledKg)}</span></div>
            <div><span className="block text-[11px] text-gray-400">Unmilled</span><span className="font-medium text-gray-900">{kg0(q.unmilledKg)}</span></div>
            <div><span className="block text-[11px] text-gray-400">Dispatched</span><span className="font-medium text-gray-900">{kg0(q.dispatchedKg)}</span></div>
            <div><span className="block text-[11px] text-gray-400">In service stock</span><span className="font-medium text-gray-900">{kg0(q.inStockKg)}</span></div>
          </div>
        </div>

        {/* Milling service — per kg on the milled quantity */}
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex justify-between items-center mb-2">
            <div><p className="text-sm font-semibold text-gray-800">Milling Service</p><p className="text-[11px] text-gray-400">per kg · on the quantity actually milled</p></div>
            <span className="text-sm font-semibold text-emerald-700">{pkr(milling)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Chargeable milled (kg)</label>
              <input type="number" min="0" value={form.milling_qty_kg ?? ''} onChange={e => set('milling_qty_kg', e.target.value)} className={inputCls} />
              <div className="flex gap-1 mt-1 flex-wrap">
                <Chip label={`Milled ${kg0(q.milledKg)}`} onClick={() => set('milling_qty_kg', String(Math.round(num(q.milledKg))))} />
                <Chip label={`Received ${kg0(q.receivedKg)}`} onClick={() => set('milling_qty_kg', String(Math.round(num(q.receivedKg))))} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Rate / kg</label>
              <input type="number" step="0.01" min="0" value={form.milling_rate_per_kg ?? ''} onChange={e => set('milling_rate_per_kg', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Rental service — per katta/bag, own quantity + optional period */}
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex justify-between items-center mb-2">
            <div><p className="text-sm font-semibold text-gray-800">Rental Service</p><p className="text-[11px] text-gray-400">per katta/bag · storage of received / unmilled / finished stock</p></div>
            <span className="text-sm font-semibold text-emerald-700">{pkr(rental)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Chargeable kattas/bags</label>
              <input type="number" min="0" value={form.rental_kattas ?? ''} onChange={e => set('rental_kattas', e.target.value)} className={inputCls} />
              <div className="flex gap-1 mt-1 flex-wrap">
                <Chip label={`Received ${bags0(q.receivedBags)}`} onClick={() => set('rental_kattas', String(Math.round(num(q.receivedBags))))} />
                <Chip label={`Unmilled ${bags0(q.unmilledBags)}`} onClick={() => set('rental_kattas', String(Math.round(num(q.unmilledBags))))} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Rate / katta</label>
              <input type="number" step="0.01" min="0" value={form.rental_rate_per_katta ?? ''} onChange={e => set('rental_rate_per_katta', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Rental from</label>
              <input type="date" value={form.rental_from ?? ''} onChange={e => set('rental_from', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Rental to</label>
              <input type="date" value={form.rental_to ?? ''} onChange={e => set('rental_to', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Labour service — per katta/bag, own quantity */}
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex justify-between items-center mb-2">
            <div><p className="text-sm font-semibold text-gray-800">Labour Service</p><p className="text-[11px] text-gray-400">per katta/bag · own quantity per client agreement</p></div>
            <span className="text-sm font-semibold text-emerald-700">{pkr(labour)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Chargeable kattas/bags</label>
              <input type="number" min="0" value={form.labour_kattas ?? ''} onChange={e => set('labour_kattas', e.target.value)} className={inputCls} />
              <div className="flex gap-1 mt-1 flex-wrap">
                <Chip label={`Received ${bags0(q.receivedBags)}`} onClick={() => set('labour_kattas', String(Math.round(num(q.receivedBags))))} />
                <Chip label={`Milled ${bags0(q.milledBags)}`} onClick={() => set('labour_kattas', String(Math.round(num(q.milledBags))))} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Rate / katta</label>
              <input type="number" step="0.01" min="0" value={form.labour_rate_per_katta ?? ''} onChange={e => set('labour_rate_per_katta', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Extra / discount / tax */}
        <div className="grid grid-cols-3 gap-2">
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Extra Charges</label><input type="number" min="0" value={form.extra_charges ?? ''} onChange={e => set('extra_charges', e.target.value)} className={inputCls} /></div>
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Discount</label><input type="number" min="0" value={form.discount ?? ''} onChange={e => set('discount', e.target.value)} className={inputCls} /></div>
          <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Tax %</label><input type="number" min="0" step="0.01" value={form.tax_pct ?? ''} onChange={e => set('tax_pct', e.target.value)} className={inputCls} /></div>
        </div>

        {/* #14 2b-ii — client freight recovered on the bill (we front the hauler) */}
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex justify-between items-center mb-2">
            <div><p className="text-sm font-semibold text-gray-800">Client Freight <span className="text-[11px] font-normal text-gray-400">(recovered — not revenue)</span></p><p className="text-[11px] text-gray-400">we pay the hauler and bill it to the client</p></div>
            <span className="text-sm font-semibold text-emerald-700">{pkr(freight)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Freight amount</label>
              <input type="number" step="0.01" min="0" value={form.freight_amount ?? ''} onChange={e => set('freight_amount', e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Hauler {freight > 0 && <span className="text-red-500">*</span>}</label>
              {freight > 0 ? (
                <HaulerPicker value={form.freight_hauler_id ?? ''} onChange={id => set('freight_hauler_id', id)}
                  haulers={haulers || []} addToast={addToast} placeholder="Select hauler…" />
              ) : (
                <select value="" className={inputCls} disabled aria-label="Hauler">
                  <option value="">Enter freight first</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Milling ({bags0(form.milling_qty_kg)} kg)</span><span>{pkr(milling)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Rental ({bags0(form.rental_kattas)} bags)</span><span>{pkr(rental)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Labour ({bags0(form.labour_kattas)} bags)</span><span>{pkr(labour)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Subtotal (+extra −disc)</span><span>{pkr(subtotal)}</span></div>
          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Tax</span><span>{pkr(tax)}</span></div>
          {freight > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-gray-500">Client freight (recovered)</span><span>{pkr(freight)}</span></div>}
          <div className="flex justify-between px-3 py-2 bg-gray-50 font-bold"><span>Total Payable</span><span className="text-emerald-700">{pkr(total)}</span></div>
        </div>
        <div><label className="block text-[11px] font-medium text-gray-600 mb-1">Notes</label><input type="text" value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} className={inputCls} /></div>
      </div>
    </SlideDrawer>
  );
}

/**
 * Record a payment against a service invoice. `invoice` has total/received/balance.
 * The shared payment fields: the money lands in the cash or bank account picked
 * (cash pre-selects the cash float), and the server posts Dr 1000 / Cr 1120 with
 * a bank_transactions row through the one payment engine.
 */
// Record a service-milling invoice payment: the shared Payment form, variant
// receive_service (POST /service-milling/invoices/:id/payments — the same
// endpoint and body as before; service_milling.record_payment).
export function RecordPaymentDrawer({ open, invoice, onClose, onPaid }) {
  if (!open || !invoice) return null;
  return (
    <PaymentFormDrawer
      variant="receive_service"
      ctx={{
        invoiceId: invoice.id, currency: 'PKR', outstanding: num(invoice.balance_amount),
        party: { type: 'customer', id: invoice.client_customer_id || null, name: invoice.client_name || null },
        ref: invoice.invoice_no,
      }}
      onClose={onClose}
      onDone={() => onPaid?.()}
    />
  );
}
