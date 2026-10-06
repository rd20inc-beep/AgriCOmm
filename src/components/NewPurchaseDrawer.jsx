import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, ShoppingCart, ClipboardCheck } from 'lucide-react';
import SlideDrawer from './SlideDrawer';
import SupplierPicker from './SupplierPicker';
import ItemPicker from './ItemPicker';
import { useApp } from '../context/AppContext';
import { useMillStoreItems, useCreatePurchase } from '../modules/millStore/api/queries';
import { purchaseRequirementsApi } from '../modules/purchaseRequirements/api/services';
import { todayLocalISO, fmtPKR, fmtNum } from '../shared/utils/format';

const CATEGORIES = [
  { value: 'packaging',   label: 'Packaging' },
  { value: 'operational', label: 'Operational' },
  { value: 'fuel',        label: 'Fuel' },
  { value: 'maintenance', label: 'Maintenance' },
];

const newLine = () => ({ category: 'packaging', item_id: '', quantity: '', cost_per_unit: '', bag_kg: '', tare_kg: '' });

const hasSize = (v) => v != null && v !== '' && Number(v) > 0;

/**
 * Mill-store "Store Purchase" as a right slide-over — the ONE store purchase
 * form (the old full-page /mill-store/purchases/new is gone). Records a
 * consumable-materials purchase (bags/packaging/etc.) with multiple line items.
 *
 * Bag Kg / Tare Kg travel with each packaging line and are written to the item
 * master inside the purchase transaction ONLY where the master has none —
 * changing an existing figure is a Manage-items action (Mill Store → Items).
 *
 * Approved purchase requirements for the items on the lines are offered with a
 * checkbox and closed in the same transaction.
 *
 * Props: open, onClose, onSaved, prefill ({ item_id, quantity, cost_per_unit,
 * requirement_id }) — e.g. from a requirement's "Record Purchase".
 */
export default function NewPurchaseDrawer({ open, onClose, onSaved, prefill = null }) {
  const { suppliersList, addToast } = useApp();
  const { data: items = [] } = useMillStoreItems({ limit: 500 });
  const safeItems = Array.isArray(items) ? items : [];
  const createMut = useCreatePurchase();

  // Items added inline via the picker — merged on top so every line sees them.
  const [localItems, setLocalItems] = useState([]);
  const mergedItems = useMemo(() => {
    const seen = new Set();
    return [...localItems, ...safeItems].filter(i => i && !seen.has(i.id) && seen.add(i.id));
  }, [localItems, safeItems]);

  const [supplierId, setSupplierId] = useState('');
  const [walkIn, setWalkIn] = useState(false); // cash / walk-in vendor (not in supplier list)
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayLocalISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([newLine()]);
  // Approved purchase requirements (any item) + which ones this purchase closes.
  const [approvedReqs, setApprovedReqs] = useState([]);
  const [closeReqIds, setCloseReqIds] = useState(() => new Set());
  const prefillFixed = useRef(false);

  // Reset the form each time it opens (applying any prefill).
  useEffect(() => {
    if (!open) return;
    setSupplierId(''); setWalkIn(false); setVendorName(''); setInvoiceNumber(''); setNotes('');
    setPurchaseDate(todayLocalISO());
    prefillFixed.current = false;
    if (prefill?.item_id) {
      setLines([{
        ...newLine(),
        item_id: String(prefill.item_id),
        quantity: prefill.quantity != null ? String(Math.round(Number(prefill.quantity) * 1000) / 1000) : '',
        cost_per_unit: prefill.cost_per_unit != null ? String(prefill.cost_per_unit) : '',
      }]);
    } else {
      setLines([newLine()]);
    }
    setCloseReqIds(new Set(prefill?.requirement_id ? [Number(prefill.requirement_id)] : []));
    setApprovedReqs([]);
    let cancelled = false;
    purchaseRequirementsApi.list({ status: 'approved' })
      .then((res) => { if (!cancelled) setApprovedReqs((res?.data || res)?.requirements || []); })
      .catch(() => { /* optional — the purchase still records without it */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A prefilled item's category / bag figures come from the item master, which
  // may load after the drawer opens — fill them in once it does.
  useEffect(() => {
    if (!open || !prefill?.item_id || prefillFixed.current) return;
    const item = safeItems.find(i => String(i.id) === String(prefill.item_id));
    if (!item) return;
    prefillFixed.current = true;
    setLines(prev => prev.map((l, i) => (i === 0 && String(l.item_id) === String(prefill.item_id) ? {
      ...l,
      category: item.category || l.category,
      cost_per_unit: l.cost_per_unit !== '' ? l.cost_per_unit : (item.last_purchase_cost ?? ''),
      bag_kg: item.category === 'packaging' ? (item.capacity_kg ?? '') : '',
      tare_kg: item.category === 'packaging' ? (item.tare_weight_kg ?? '') : '',
    } : l)));
  }, [open, prefill, safeItems]);

  // Requirements relevant to this purchase = approved ones for an item on a line.
  const lineItemIds = useMemo(() => new Set(lines.filter(l => l.item_id).map(l => String(l.item_id))), [lines]);
  const matchingReqs = useMemo(
    () => approvedReqs.filter(r => r.item_id != null && lineItemIds.has(String(r.item_id))),
    [approvedReqs, lineItemIds],
  );
  const toggleReq = (id) => setCloseReqIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addLine = () => setLines(prev => [...prev, newLine()]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const setLine = (idx, key, val) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const totalAmount = useMemo(() =>
    lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost_per_unit) || 0), 0), [lines]);

  async function handleSubmit() {
    if (walkIn) {
      if (!vendorName.trim()) { addToast('Enter the cash / walk-in vendor name', 'error'); return; }
    } else if (!supplierId) {
      addToast('Select a supplier, add a new one, or switch to Cash / Walk-in', 'error'); return;
    }
    const validLines = lines.filter(l => l.item_id && Number(l.quantity) > 0 && Number(l.cost_per_unit) >= 0);
    if (validLines.length === 0) { addToast('Add at least one line item', 'error'); return; }
    // Packaging lines need a Bag Kg so we know how much rice each bag holds.
    const badBag = validLines.find(l => l.category === 'packaging' && !(Number(l.bag_kg) > 0));
    if (badBag) { addToast('Enter Bag Kg for each packaging item', 'error'); return; }
    // Only close requirements whose item is still on the purchase.
    const closeIds = matchingReqs.filter(r => closeReqIds.has(Number(r.id))).map(r => Number(r.id));
    try {
      // Bag Kg / Tare Kg go WITH the purchase: the server fills them into the
      // item master inside the purchase transaction, only where it has none.
      await createMut.mutateAsync({
        supplier_id: walkIn ? null : (supplierId ? Number(supplierId) : null),
        vendor_name: walkIn ? vendorName.trim() : null,
        invoice_number: invoiceNumber || null,
        purchase_date: purchaseDate,
        notes: notes || null,
        lines: validLines.map(l => ({
          item_id: Number(l.item_id),
          quantity: Number(l.quantity),
          cost_per_unit: Number(l.cost_per_unit),
          ...(l.category === 'packaging' ? {
            bag_kg: Number(l.bag_kg) || null,
            tare_kg: l.tare_kg === '' || l.tare_kg == null ? null : Number(l.tare_kg),
          } : {}),
        })),
        ...(closeIds.length ? { close_requirement_ids: closeIds } : {}),
      });
      addToast(closeIds.length
        ? `Purchase recorded — stock updated, ${closeIds.length} requirement${closeIds.length > 1 ? 's' : ''} closed`
        : 'Purchase recorded — stock updated', 'success');
      onSaved?.();
      onClose?.();
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  const INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white';
  const LABEL = 'block text-xs font-semibold text-gray-600 uppercase mb-1';

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title="Store Purchase"
      subtitle="Record a consumable materials purchase (bags, packaging, fuel…)"
      icon={ShoppingCart}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500">Total <span className="font-semibold text-gray-900">{fmtPKR(totalAmount, { decimals: 2 })}</span></span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={handleSubmit} disabled={createMut.isPending}
              className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <ShoppingCart size={16} /> {createMut.isPending ? 'Saving…' : 'Record Purchase'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className={LABEL + ' mb-0'}>Supplier <span className="text-red-500">*</span></label>
              <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 text-[11px]">
                <button type="button" onClick={() => { setWalkIn(false); setVendorName(''); }}
                  className={`px-2.5 py-1 font-medium ${!walkIn ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Registered</button>
                <button type="button" onClick={() => { setWalkIn(true); setSupplierId(''); }}
                  className={`px-2.5 py-1 font-medium ${walkIn ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Cash / Walk-in</button>
              </div>
            </div>
            {walkIn ? (
              <>
                <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)} className={INPUT}
                  placeholder="Vendor / shop name" autoFocus />
                <p className="text-[11px] text-gray-400 mt-1">For a vendor not in your list — they’re added as a pending supplier so the purchase shows on their statement.</p>
              </>
            ) : (
              <SupplierPicker
                value={supplierId}
                onChange={setSupplierId}
                suppliers={suppliersList || []}
                addToast={addToast}
                placeholder="Search supplier (or + Add new)…"
              />
            )}
          </div>
          <div>
            <label className={LABEL}>Date <span className="text-red-500">*</span></label>
            <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className={INPUT} required />
          </div>
          <div>
            <label className={LABEL}>Invoice #</label>
            <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className={INPUT} placeholder="Optional" />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className={INPUT} placeholder="Optional" />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
            <button type="button" onClick={addLine} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-gray-100 rounded-lg hover:bg-gray-200">
              <Plus size={14} /> Add Line
            </button>
          </div>
          <div className="space-y-3">
            {lines.map((line, idx) => {
              const lineTotal = (Number(line.quantity) || 0) * (Number(line.cost_per_unit) || 0);
              return (
                <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Category</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map(c => (
                        <button key={c.value} type="button"
                          onClick={() => setLines(prev => prev.map((l, i) => i === idx
                            ? { ...newLine(), category: c.value } : l))}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            line.category === c.value
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ItemPicker
                    label={line.category === 'packaging' ? 'Bag' : 'Item'}
                    category={line.category}
                    value={line.item_id}
                    onChange={(id) => {
                      setLine(idx, 'item_id', id);
                      const item = mergedItems.find(i => String(i.id) === String(id));
                      if (item?.last_purchase_cost) setLine(idx, 'cost_per_unit', item.last_purchase_cost);
                      if (line.category === 'packaging') {
                        setLine(idx, 'bag_kg', item?.capacity_kg ?? '');
                        setLine(idx, 'tare_kg', item?.tare_weight_kg ?? '');
                      }
                    }}
                    items={mergedItems}
                    onItemAdded={(it) => {
                      setLocalItems(prev => [it, ...prev]);
                      if (it?.last_purchase_cost) setLine(idx, 'cost_per_unit', it.last_purchase_cost);
                      if (line.category === 'packaging') {
                        setLine(idx, 'bag_kg', it?.capacity_kg ?? '');
                        setLine(idx, 'tare_kg', it?.tare_weight_kg ?? '');
                      }
                    }}
                    addToast={addToast}
                  />
                  {line.category === 'packaging' && line.item_id && (() => {
                    const master = mergedItems.find(i => String(i.id) === String(line.item_id));
                    const capDiffers = master && hasSize(master.capacity_kg) && line.bag_kg !== '' && Number(line.bag_kg) !== Number(master.capacity_kg);
                    const tareDiffers = master && hasSize(master.tare_weight_kg) && line.tare_kg !== '' && line.tare_kg != null && Number(line.tare_kg) !== Number(master.tare_weight_kg);
                    if (!capDiffers && !tareDiffers) return null;
                    return (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        This bag is set to {capDiffers ? `${Number(master.capacity_kg)} kg` : ''}{capDiffers && tareDiffers ? ' / ' : ''}{tareDiffers ? `${Number(master.tare_weight_kg)} kg tare` : ''} in Mill Store → Items.
                        A purchase only fills a blank figure — to change it, edit the item there (needs Manage items).
                      </p>
                    );
                  })()}
                  {line.category === 'packaging' && line.item_id && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-blue-700 uppercase mb-0.5">Bag Kg <span className="text-red-500">*</span></label>
                        <input type="number" min="0" step="any" value={line.bag_kg}
                          onChange={e => setLine(idx, 'bag_kg', e.target.value)}
                          className={INPUT} placeholder="rice per bag" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-blue-700 uppercase mb-0.5">Tare Kg</label>
                        <input type="number" min="0" step="any" value={line.tare_kg}
                          onChange={e => setLine(idx, 'tare_kg', e.target.value)}
                          className={INPUT} placeholder="empty bag wt" />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Qty</label>
                      <input type="number" min="0" step="any" value={line.quantity} onChange={e => setLine(idx, 'quantity', e.target.value)} className={INPUT} placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Cost/unit</label>
                      <input type="number" min="0" step="any" value={line.cost_per_unit} onChange={e => setLine(idx, 'cost_per_unit', e.target.value)} className={INPUT} placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Total</label>
                      <p className="text-sm font-medium text-gray-900 py-2 tabular-nums">{fmtPKR(lineTotal, { decimals: 2 })}</p>
                    </div>
                  </div>
                  {lines.length > 1 && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => removeLine(idx)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1">
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {matchingReqs.length > 0 && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5 mb-2">
                <ClipboardCheck size={14} /> Approved purchase requirements for these items
              </p>
              <div className="space-y-1.5">
                {matchingReqs.map(r => (
                  <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={closeReqIds.has(Number(r.id))} onChange={() => toggleReq(Number(r.id))}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="font-medium">{r.pr_no}</span>
                    <span className="text-gray-500">— {r.item_name}, {fmtNum(parseFloat(r.shortage_qty) || 0, 0)} {r.unit}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">Ticked requirements are marked Purchased with this purchase.</p>
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
            <p className="text-sm text-gray-500">{lines.filter(l => l.item_id).length} item(s)</p>
            <p className="text-base font-bold text-gray-900">Total: {fmtPKR(totalAmount, { decimals: 2 })}</p>
          </div>
        </div>
      </div>
    </SlideDrawer>
  );
}
