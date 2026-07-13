import { useState, useEffect, useRef } from 'react';
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
const emptyPack = () => ({ bagItemId: '', bagSize: '', bagUnitCost: '', masterItemId: '', masterSize: '', masterUnitCost: '', polyItemId: '', polyUnitCost: '' });

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
  // Auto-default master/poly only once per open (so it never fights a manual clear).
  const didDefault = useRef(false);

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
        bagItemId: bg.itemId || '', bagSize: s(bg.sizeKg), bagUnitCost: s(bg.unitCost),
        masterItemId: ms.itemId || '', masterSize: s(ms.sizeKg), masterUnitCost: s(ms.unitCost),
        polyItemId: py.itemId || '', polyUnitCost: s(py.unitCost),
      });
      // Editing an existing quote already has its master/poly — don't auto-default over it.
      didDefault.current = true;
    } else {
      setForm(defaults());
      setItems([emptyItem()]);
      setPack(emptyPack());
      didDefault.current = false;
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
  const fmt2 = (n) => num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt3 = (n) => num(n).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fmtN = (n) => num(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const itemsTotal = items.reduce((s, it) => s + num(it.qtyMT) * num(it.pricePerMT), 0);

  // ── Packaging builder maths — quantities are DERIVED live from the net weight
  // and the bag / master-bag sizes, so they auto-fill and re-compute as any of
  // those change. Sizes default from the picked item's capacity or the rice
  // line bag size, and are editable. ──
  const eff = (v, auto) => (v !== '' && v != null ? num(v) : auto);
  const totalRiceKg = items.reduce((s, it) => s + num(it.qtyMT) * 1000, 0);
  const totalMt = totalRiceKg / 1000;
  const minLineBag = items.reduce((m, it) => { const bs = num(it.bagSizeKg); return bs > 0 ? Math.min(m, bs) : m; }, Infinity);
  const lineBagDefault = minLineBag !== Infinity ? minLineBag : 0;

  const bagItem = findPkg(pack.bagItemId);
  const bagSize = eff(pack.bagSize, num(bagItem?.capacity_kg) || lineBagDefault) || 0;
  const bagCount = totalRiceKg > 0 && bagSize > 0 ? Math.ceil(totalRiceKg / bagSize) : 0;
  const smallBag = bagSize > 0 && bagSize <= SMALL_BAG_KG;
  const bagCost = eff(pack.bagUnitCost, num(bagItem?.avg_cost_per_unit));
  const bagAmt = round2(bagCount * bagCost);

  const masterItem = findPkg(pack.masterItemId);
  const masterSize = eff(pack.masterSize, num(masterItem?.capacity_kg) || 25) || 0;
  const masterCount = smallBag && masterSize > 0 && totalRiceKg > 0 ? Math.ceil(totalRiceKg / masterSize) : 0;
  const masterCost = eff(pack.masterUnitCost, num(masterItem?.avg_cost_per_unit));
  const masterAmt = round2(masterCount * masterCost);

  const polyItem = findPkg(pack.polyItemId);
  const polyCount = smallBag ? bagCount : 0; // one liner per retail bag
  const polyCost = eff(pack.polyUnitCost, num(polyItem?.avg_cost_per_unit));
  const polyAmt = round2(polyCount * polyCost);

  const packingTotal = round2(bagAmt + masterAmt + polyAmt);

  // Auto-pick sensible master-bag + polythene items the first time a small bag is
  // in play, so operators don't re-select them each time. Runs once per open
  // (didDefault) and never overrides a manual choice/clear.
  useEffect(() => {
    if (!open || didDefault.current || !smallBag || !packagingItems.length) return;
    const master = packagingItems.find((x) => /master/i.test(x.name || '') || /master|mstr/i.test(x.code || ''))
      || packagingItems.find((x) => num(x.capacity_kg) > SMALL_BAG_KG);
    const poly = packagingItems.find((x) => /poly|polythene|liner/i.test(x.name || '') || /poly/i.test(x.code || ''));
    if (!master && !poly) return;
    setPack((p) => {
      let next = p;
      if (master && !p.masterItemId) next = { ...next, masterItemId: String(master.id), masterUnitCost: master.avg_cost_per_unit != null ? String(master.avg_cost_per_unit) : next.masterUnitCost, masterSize: num(master.capacity_kg) > 0 ? String(master.capacity_kg) : next.masterSize };
      if (poly && !p.polyItemId) next = { ...next, polyItemId: String(poly.id), polyUnitCost: poly.avg_cost_per_unit != null ? String(poly.avg_cost_per_unit) : next.polyUnitCost };
      return next;
    });
    didDefault.current = true;
  }, [open, smallBag, packagingItems]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildPackingLines() {
    const lines = [];
    if (pack.bagItemId && bagCount > 0) lines.push({ kind: 'bag', itemId: Number(pack.bagItemId), label: bagItem?.name || 'Bag', sizeKg: bagSize, qty: bagCount, unitCost: bagCost, amount: bagAmt });
    if (smallBag && pack.masterItemId && masterCount > 0) lines.push({ kind: 'master', itemId: Number(pack.masterItemId), label: masterItem?.name || 'Master Bag', sizeKg: masterSize, qty: masterCount, unitCost: masterCost, amount: masterAmt });
    if (smallBag && pack.polyItemId && polyCount > 0) lines.push({ kind: 'poly', itemId: Number(pack.polyItemId), label: polyItem?.name || 'Polythene', qty: polyCount, unitCost: polyCost, amount: polyAmt });
    return lines;
  }
  // Prefill size + unit cost from the packaging item (both editable, quote currency).
  const pickBag = (id) => setPack((p) => { const it = findPkg(id); return { ...p, bagItemId: id, bagUnitCost: it?.avg_cost_per_unit != null ? String(it.avg_cost_per_unit) : p.bagUnitCost, bagSize: (!p.bagSize && num(it?.capacity_kg) > 0) ? String(it.capacity_kg) : p.bagSize }; });
  const pickMaster = (id) => setPack((p) => { const it = findPkg(id); return { ...p, masterItemId: id, masterUnitCost: it?.avg_cost_per_unit != null ? String(it.avg_cost_per_unit) : p.masterUnitCost, masterSize: (!p.masterSize && num(it?.capacity_kg) > 0) ? String(it.capacity_kg) : p.masterSize }; });
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

        {/* Charges — packaging (item-driven, sizes drive live qty/weight) + freight/other */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <label className="block text-sm font-semibold text-gray-800">Packaging ({form.currency})</label>
            <span className="text-[11px] text-gray-500">
              Net weight <b className="text-gray-700">{fmt3(totalMt)} MT</b>
              {bagSize > 0 && <> · <b className="text-gray-700">{bagCount.toLocaleString()}</b> bags @ {fmtN(bagSize)} kg</>}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 -mt-1.5">Unit costs pre-fill from each item's saved cost — enter/adjust them in <b>{form.currency}</b>.</p>

          {/* Bag line — size + unit cost are editable; bag count is derived live */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-1.5">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <ItemPicker label="Bag" category="packaging" value={pack.bagItemId ? String(pack.bagItemId) : ''}
                  onChange={pickBag} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search bag…" />
              </div>
              <div className="col-span-3">
                <label className="block text-[10px] text-gray-500 mb-0.5">Bag size (kg)</label>
                <input type="number" min="0" step="0.001" value={pack.bagSize} onChange={(e) => setPackF('bagSize', e.target.value)} placeholder={lineBagDefault ? String(lineBagDefault) : '50'} className={inputCls} />
              </div>
              <div className="col-span-3">
                <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost / bag ({form.currency})</label>
                <input type="number" min="0" step="0.0001" value={pack.bagUnitCost} onChange={(e) => setPackF('bagUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
            </div>
            <div className="text-right text-xs text-gray-600"><b className="text-gray-800">{bagCount.toLocaleString()}</b> bags × {fmtN(bagCost)} = <b className="text-gray-900">{form.currency} {fmt2(bagAmt)}</b></div>
            {smallBag && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Small bag (≤{SMALL_BAG_KG} kg) — a master bag &amp; polythene liner are added below.
              </div>
            )}
          </div>

          {/* Master bag + polythene — only for small bags; quantities derive from sizes */}
          {smallBag && (
            <>
              <div className="rounded-lg border border-gray-200 p-3 space-y-1.5">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6">
                    <ItemPicker label="Master Bag" category="packaging" value={pack.masterItemId ? String(pack.masterItemId) : ''}
                      onChange={pickMaster} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search master bag…" />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Master size (kg)</label>
                    <input type="number" min="0" step="0.001" value={pack.masterSize} onChange={(e) => setPackF('masterSize', e.target.value)} placeholder="25" className={inputCls} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost / master ({form.currency})</label>
                    <input type="number" min="0" step="0.0001" value={pack.masterUnitCost} onChange={(e) => setPackF('masterUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
                  </div>
                </div>
                <div className="text-right text-xs text-gray-600"><b className="text-gray-800">{masterCount.toLocaleString()}</b> masters × {fmtN(masterCost)} = <b className="text-gray-900">{form.currency} {fmt2(masterAmt)}</b></div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 space-y-1.5">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6">
                    <ItemPicker label="Polythene" category="packaging" value={pack.polyItemId ? String(pack.polyItemId) : ''}
                      onChange={pickPoly} items={packagingItems} onItemAdded={onPkgAdded} addToast={addToast} placeholder="Search polythene…" />
                  </div>
                  <div className="col-span-3 pb-1.5 text-[11px] text-gray-400">1 sheet / bag</div>
                  <div className="col-span-3">
                    <label className="block text-[10px] text-gray-500 mb-0.5">Unit cost / sheet ({form.currency})</label>
                    <input type="number" min="0" step="0.0001" value={pack.polyUnitCost} onChange={(e) => setPackF('polyUnitCost', e.target.value)} placeholder="0.00" className={inputCls} />
                  </div>
                </div>
                <div className="text-right text-xs text-gray-600"><b className="text-gray-800">{polyCount.toLocaleString()}</b> sheets × {fmtN(polyCost)} = <b className="text-gray-900">{form.currency} {fmt2(polyAmt)}</b></div>
              </div>
            </>
          )}

          <div className="flex justify-between text-xs text-gray-600">
            <span>Packing charge</span>
            <span className="font-semibold text-gray-900">{form.currency} {fmt2(packingTotal)}</span>
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
