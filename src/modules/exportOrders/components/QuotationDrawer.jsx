import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { INCOTERMS } from '../../../shared/constants/incoterms';
import CustomerPicker from '../../../components/CustomerPicker';
import RiceTypePicker from '../../../components/RiceTypePicker';
import ItemPicker from '../../../components/ItemPicker';
import { millStoreApi } from '../../millStore/api/services';
import { quotationsApi } from '../api/services';

const num = (v) => parseFloat(v) || 0;
const emptyItem = () => ({ productId: '', productName: '', qtyMT: '', pricePerMT: '', hsCode: '', bagSizeKg: '', bagType: 'PP' });
// Below this retail-bag size (kg) a shipment needs an outer master bag + a
// polythene liner per bag — same ≤15kg rule as the mill packing flow.
const SMALL_BAG_KG = 15;
const emptyPack = () => ({ bagItemId: '', bagUnitCost: '', bagQty: '', masterItemId: '', masterUnitCost: '', masterQty: '', polyItemId: '', polyUnitCost: '', polyQty: '' });

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
  const [packagingItems, setPackagingItems] = useState([]);
  const [pack, setPack] = useState(emptyPack());

  // Packaging items (bags / master bags / polythene) — searchable + quick-add.
  useEffect(() => {
    if (!open) return;
    millStoreApi.listItems({ category: 'packaging' })
      .then((res) => setPackagingItems(res?.data?.items || res?.data || []))
      .catch(() => setPackagingItems([]));
  }, [open]);
  const findPkg = (id) => packagingItems.find((p) => String(p.id) === String(id));
  const setPackF = (k, v) => setPack((p) => ({ ...p, [k]: v }));
  const onPkgAdded = (it) => setPackagingItems((prev) => [it, ...prev]);

  function defaults() {
    return {
      customerId: '', country: '', currency: 'USD', incoterm: 'FOB',
      destinationPort: '', portOfLoading: 'Karachi, Pakistan',
      paymentTerms: '20% advance, balance against documents', advancePct: '20',
      validUntil: '', notes: '',
      freightCost: '', otherCharges: '',
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
      const pl = Array.isArray(quotation.packing_lines) ? quotation.packing_lines : [];
      const byKind = (k) => pl.find((l) => l.kind === k) || {};
      const bg = byKind('bag'); const ms = byKind('master'); const py = byKind('poly');
      const s = (v) => (v != null && v !== '' ? String(v) : '');
      setPack({
        bagItemId: bg.itemId || '', bagUnitCost: s(bg.unitCost), bagQty: s(bg.qty),
        masterItemId: ms.itemId || '', masterUnitCost: s(ms.unitCost), masterQty: s(ms.qty),
        polyItemId: py.itemId || '', polyUnitCost: s(py.unitCost), polyQty: s(py.qty),
      });
    } else {
      setForm(defaults());
      setItems([emptyItem()]);
      setPack(emptyPack());
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

  const round2 = (n) => Math.round((num(n)) * 100) / 100;
  const itemsTotal = items.reduce((s, it) => s + num(it.qtyMT) * num(it.pricePerMT), 0);

  // ── Packaging builder maths ──
  const totalBagCount = items.reduce((s, it) => {
    const q = num(it.qtyMT); const bs = num(it.bagSizeKg) || 50;
    return s + (q > 0 && bs > 0 ? Math.ceil((q * 1000) / bs) : 0);
  }, 0);
  const totalRiceKg = items.reduce((s, it) => s + num(it.qtyMT) * 1000, 0);
  const bagItem = findPkg(pack.bagItemId);
  const minLineBag = items.reduce((m, it) => { const bs = num(it.bagSizeKg); return bs > 0 ? Math.min(m, bs) : m; }, Infinity);
  const smallBag = num(bagItem?.capacity_kg) > 0
    ? num(bagItem.capacity_kg) <= SMALL_BAG_KG
    : (minLineBag !== Infinity && minLineBag <= SMALL_BAG_KG);
  const eff = (v, auto) => (v !== '' && v != null ? num(v) : auto);
  const bagQty = eff(pack.bagQty, totalBagCount);
  const bagCost = eff(pack.bagUnitCost, num(bagItem?.avg_cost_per_unit));
  const bagAmt = round2(bagQty * bagCost);
  const masterItem = findPkg(pack.masterItemId);
  const masterAutoQty = num(masterItem?.capacity_kg) > 0 ? Math.ceil(totalRiceKg / num(masterItem.capacity_kg)) : 0;
  const masterQty = eff(pack.masterQty, masterAutoQty);
  const masterCost = eff(pack.masterUnitCost, num(masterItem?.avg_cost_per_unit));
  const masterAmt = smallBag ? round2(masterQty * masterCost) : 0;
  const polyItem = findPkg(pack.polyItemId);
  const polyQty = eff(pack.polyQty, totalBagCount);
  const polyCost = eff(pack.polyUnitCost, num(polyItem?.avg_cost_per_unit));
  const polyAmt = smallBag ? round2(polyQty * polyCost) : 0;
  const packingTotal = round2(bagAmt + masterAmt + polyAmt);

  function buildPackingLines() {
    const lines = [];
    if (pack.bagItemId && (bagAmt > 0 || bagQty > 0)) lines.push({ kind: 'bag', itemId: Number(pack.bagItemId), label: bagItem?.name || 'Bag', qty: bagQty, unitCost: bagCost, amount: bagAmt });
    if (smallBag && pack.masterItemId && (masterAmt > 0 || masterQty > 0)) lines.push({ kind: 'master', itemId: Number(pack.masterItemId), label: masterItem?.name || 'Master Bag', qty: masterQty, unitCost: masterCost, amount: masterAmt });
    if (smallBag && pack.polyItemId && (polyAmt > 0 || polyQty > 0)) lines.push({ kind: 'poly', itemId: Number(pack.polyItemId), label: polyItem?.name || 'Polythene', qty: polyQty, unitCost: polyCost, amount: polyAmt });
    return lines;
  }
  // Prefill unit cost from the packaging item's stored cost (editable, in quote currency).
  const pickBag = (id) => setPack((p) => ({ ...p, bagItemId: id, bagUnitCost: findPkg(id)?.avg_cost_per_unit != null ? String(findPkg(id).avg_cost_per_unit) : p.bagUnitCost }));
  const pickMaster = (id) => setPack((p) => ({ ...p, masterItemId: id, masterUnitCost: findPkg(id)?.avg_cost_per_unit != null ? String(findPkg(id).avg_cost_per_unit) : p.masterUnitCost }));
  const pickPoly = (id) => setPack((p) => ({ ...p, polyItemId: id, polyUnitCost: findPkg(id)?.avg_cost_per_unit != null ? String(findPkg(id).avg_cost_per_unit) : p.polyUnitCost }));

  const chargesTotal = packingTotal + num(form.freightCost) + num(form.otherCharges);
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
        packing_lines: buildPackingLines(),
        packing_cost: packingTotal,
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

        {/* Charges — packaging (item-driven, with auto master+poly) + freight/other */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-800">Packaging ({form.currency})</label>

          {/* Bag line */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <ItemPicker label="Bag" category="packaging" value={pack.bagItemId ? String(pack.bagItemId) : ''}
                  onChange={pickBag} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search bag…" />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] text-gray-500 mb-0.5">Bags</label>
                <input type="number" min="0" value={pack.bagQty} onChange={(e) => setPackF('bagQty', e.target.value)} placeholder={totalBagCount ? String(totalBagCount) : '0'} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost</label>
                <input type="number" min="0" step="0.0001" value={pack.bagUnitCost} onChange={(e) => setPackF('bagUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div className="col-span-2 text-right pb-1.5 text-sm font-medium text-gray-800">{bagAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            {smallBag && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Small bag (≤{SMALL_BAG_KG} kg) — a master bag &amp; polythene liner are added below.
              </div>
            )}
          </div>

          {/* Master bag + polythene — only for small bags */}
          {smallBag && (
            <>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6">
                  <ItemPicker label="Master Bag" category="packaging" value={pack.masterItemId ? String(pack.masterItemId) : ''}
                    onChange={pickMaster} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search master bag…" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-0.5">Masters</label>
                  <input type="number" min="0" value={pack.masterQty} onChange={(e) => setPackF('masterQty', e.target.value)} placeholder={masterAutoQty ? String(masterAutoQty) : '0'} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost</label>
                  <input type="number" min="0" step="0.0001" value={pack.masterUnitCost} onChange={(e) => setPackF('masterUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
                </div>
                <div className="col-span-2 text-right pb-1.5 text-sm font-medium text-gray-800">{masterAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6">
                  <ItemPicker label="Polythene" category="packaging" value={pack.polyItemId ? String(pack.polyItemId) : ''}
                    onChange={pickPoly} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search polythene…" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-0.5">Sheets</label>
                  <input type="number" min="0" value={pack.polyQty} onChange={(e) => setPackF('polyQty', e.target.value)} placeholder={totalBagCount ? String(totalBagCount) : '0'} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost</label>
                  <input type="number" min="0" step="0.0001" value={pack.polyUnitCost} onChange={(e) => setPackF('polyUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
                </div>
                <div className="col-span-2 text-right pb-1.5 text-sm font-medium text-gray-800">{polyAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </>
          )}

          <div className="flex justify-between text-xs text-gray-600">
            <span>Packing charge</span>
            <span className="font-semibold text-gray-900">{form.currency} {packingTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {/* Freight + Other (flat) */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Freight</label>
              <input type="number" min="0" step="0.01" value={form.freightCost} onChange={(e) => set('freightCost', e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Other</label>
              <input type="number" min="0" step="0.01" value={form.otherCharges} onChange={(e) => set('otherCharges', e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
          </div>

          <div className="mt-1 flex justify-between text-xs text-gray-500">
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
