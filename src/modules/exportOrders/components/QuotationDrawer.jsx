import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { INCOTERMS } from '../../../shared/constants/incoterms';
import CustomerPicker from '../../../components/CustomerPicker';
import RiceTypePicker from '../../../components/RiceTypePicker';
import { quotationsApi } from '../api/services';

const num = (v) => parseFloat(v) || 0;
const emptyItem = () => ({ productId: '', productName: '', qtyMT: '', pricePerMT: '', hsCode: '', bagSizeKg: '', bagType: 'PP' });

/**
 * Create / edit an export quotation. Right slide-over (no backdrop close, so a
 * stray click won't drop the form). On save it POSTs/PUTs to /api/quotations
 * and calls onSaved with the fresh row.
 */
export default function QuotationDrawer({ open, onClose, quotation, onSaved }) {
  const { customersList = [], productsList = [], addToast } = useApp();
  const isEdit = !!quotation?.id;

  const [form, setForm] = useState(defaults());
  const [items, setItems] = useState([emptyItem()]);
  const [saving, setSaving] = useState(false);

  function defaults() {
    return {
      customerId: '', country: '', currency: 'USD', incoterm: 'FOB',
      destinationPort: '', portOfLoading: 'Karachi, Pakistan',
      paymentTerms: '20% advance, balance against documents', advancePct: '20',
      validUntil: '', notes: '',
      packingCost: '', freightCost: '', otherCharges: '',
    };
  }

  useEffect(() => {
    if (!open) return;
    if (quotation?.id) {
      setForm({
        customerId: quotation.customer_id || '',
        country: quotation.country || '',
        currency: quotation.currency || 'USD',
        incoterm: quotation.incoterm || 'FOB',
        destinationPort: quotation.destination_port || '',
        portOfLoading: quotation.port_of_loading || 'Karachi, Pakistan',
        paymentTerms: quotation.payment_terms || '',
        advancePct: quotation.advance_pct != null ? String(quotation.advance_pct) : '0',
        validUntil: quotation.valid_until ? String(quotation.valid_until).split('T')[0] : '',
        notes: quotation.notes || '',
        packingCost: num(quotation.packing_cost) ? String(quotation.packing_cost) : '',
        freightCost: num(quotation.freight_cost) ? String(quotation.freight_cost) : '',
        otherCharges: num(quotation.other_charges) ? String(quotation.other_charges) : '',
      });
      setItems((quotation.items || []).length
        ? quotation.items.map((it) => ({
            productId: it.product_id || '', productName: it.product_name || '',
            qtyMT: it.qty_mt != null ? String(it.qty_mt) : '', pricePerMT: it.price_per_mt != null ? String(it.price_per_mt) : '',
            hsCode: it.hs_code || '', bagSizeKg: it.bag_size_kg != null ? String(it.bag_size_kg) : '', bagType: it.bag_type || 'PP',
          }))
        : [emptyItem()]);
    } else {
      setForm(defaults());
      setItems([emptyItem()]);
    }
  }, [open, quotation]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setItem = (i, k, v) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i) => setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const onPickCustomer = (id) => {
    set('customerId', id);
    const c = customersList.find((x) => String(x.id) === String(id));
    if (c && c.country && !form.country) set('country', c.country);
  };
  const onPickProduct = (i, id) => {
    // Name may be blank for a just-quick-added rice type — the backend backfills
    // product_name from product_id on save, so passing '' here is safe.
    const p = productsList.find((x) => String(x.id) === String(id));
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, productId: id, productName: p?.name || '' } : it)));
  };

  const itemsTotal = items.reduce((s, it) => s + num(it.qtyMT) * num(it.pricePerMT), 0);
  const chargesTotal = num(form.packingCost) + num(form.freightCost) + num(form.otherCharges);
  const total = itemsTotal + chargesTotal;

  async function save(sendNow = false) {
    if (!form.customerId) { addToast('Select a customer', 'error'); return; }
    const cleanItems = items.filter((it) => (it.productId || it.productName) && num(it.qtyMT) > 0);
    if (!cleanItems.length) { addToast('Add at least one line item with a quantity', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        customer_id: Number(form.customerId),
        country: form.country || null,
        currency: form.currency,
        incoterm: form.incoterm || null,
        destination_port: form.destinationPort || null,
        port_of_loading: form.portOfLoading || null,
        payment_terms: form.paymentTerms || null,
        advance_pct: num(form.advancePct),
        valid_until: form.validUntil || null,
        packing_cost: num(form.packingCost),
        freight_cost: num(form.freightCost),
        other_charges: num(form.otherCharges),
        notes: form.notes || null,
        items: cleanItems.map((it) => ({
          product_id: it.productId ? Number(it.productId) : null,
          product_name: it.productName || null,
          qty_mt: num(it.qtyMT),
          price_per_mt: num(it.pricePerMT),
          hs_code: it.hsCode || null,
          bag_size_kg: it.bagSizeKg || null,
          bag_type: it.bagType || null,
        })),
      };
      let res;
      if (isEdit) {
        res = await quotationsApi.update(quotation.id, payload);
        if (sendNow) await quotationsApi.setStatus(quotation.id, 'Sent');
      } else {
        res = await quotationsApi.create({ ...payload, status: sendNow ? 'Sent' : 'Draft' });
      }
      addToast(isEdit ? 'Quotation updated' : `Quotation ${sendNow ? 'created & sent' : 'created'}`, 'success');
      onSaved?.(res?.data?.quotation);
      onClose?.();
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save quotation', 'error');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${quotation.quotation_no}` : 'New Quotation'}
      subtitle="Pre-order price quote for an export customer"
      icon={FileText}
      size="2xl"
      footer={(
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-gray-500">Total: <span className="font-semibold text-gray-900">{form.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={() => save(false)} disabled={saving} className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50">{isEdit ? 'Save' : 'Save Draft'}</button>
            <button onClick={() => save(true)} disabled={saving} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save & Send'}</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {/* Customer + terms */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <CustomerPicker
              label={<span>Customer <span className="text-red-500">*</span></span>}
              value={form.customerId ? String(form.customerId) : ''}
              onChange={onPickCustomer}
              onCreated={(c) => { if (c?.id) { set('customerId', c.id); if (c.country) set('country', c.country); } }}
              addToast={addToast}
              clearable
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
            <input value={form.country} onChange={(e) => set('country', e.target.value)} className={inputCls} placeholder="Destination country" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls}>
              {['USD', 'EUR', 'GBP', 'AED', 'PKR'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Incoterm</label>
            <select value={form.incoterm} onChange={(e) => set('incoterm', e.target.value)} className={inputCls}>
              {INCOTERMS.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Advance %</label>
            <input type="number" min="0" max="100" value={form.advancePct} onChange={(e) => set('advancePct', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Port of Loading</label>
            <input value={form.portOfLoading} onChange={(e) => set('portOfLoading', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destination Port</label>
            <input value={form.destinationPort} onChange={(e) => set('destinationPort', e.target.value)} className={inputCls} placeholder="e.g. Rotterdam" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valid Until</label>
            <input type="date" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
            <input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-semibold text-gray-800">Line Items</label>
            <button onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"><Plus size={14} /> Add line</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2.5 space-y-2">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Rice Type</label>
                    <RiceTypePicker
                      value={it.productId ? String(it.productId) : ''}
                      onChange={(id) => onPickProduct(i, id)}
                      products={productsList}
                      addToast={addToast}
                      placeholder="Search rice type…"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Qty (MT)</label>
                    <input type="number" min="0" step="0.001" value={it.qtyMT} onChange={(e) => setItem(i, 'qtyMT', e.target.value)} className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Price/MT</label>
                    <input type="number" min="0" step="0.01" value={it.pricePerMT} onChange={(e) => setItem(i, 'pricePerMT', e.target.value)} className={inputCls} />
                  </div>
                  <div className="col-span-2 text-right pb-1.5 text-sm font-medium text-gray-700">
                    {(num(it.qtyMT) * num(it.pricePerMT)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="col-span-1 flex justify-end pb-1">
                    <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500" title="Remove line"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-5">
                    <input value={it.hsCode} onChange={(e) => setItem(i, 'hsCode', e.target.value)} className={inputCls} placeholder="HS code (e.g. 1006.30.10)" />
                  </div>
                  <div className="col-span-3">
                    <input type="number" min="0" step="0.001" value={it.bagSizeKg} onChange={(e) => setItem(i, 'bagSizeKg', e.target.value)} className={inputCls} placeholder="Bag kg" />
                  </div>
                  <div className="col-span-4">
                    <input value={it.bagType} onChange={(e) => setItem(i, 'bagType', e.target.value)} className={inputCls} placeholder="Bag type (PP)" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Charges — flat amounts added to the rice subtotal for the client-facing total */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">Charges ({form.currency})</label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Packing / Bags</label>
              <input type="number" min="0" step="0.01" value={form.packingCost} onChange={(e) => set('packingCost', e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Freight</label>
              <input type="number" min="0" step="0.01" value={form.freightCost} onChange={(e) => set('freightCost', e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Other</label>
              <input type="number" min="0" step="0.01" value={form.otherCharges} onChange={(e) => set('otherCharges', e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>Rice subtotal: {form.currency} {itemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span>+ Charges: {form.currency} {chargesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inputCls} placeholder="Optional notes shown internally" />
        </div>
      </div>
    </SlideDrawer>
  );
}
