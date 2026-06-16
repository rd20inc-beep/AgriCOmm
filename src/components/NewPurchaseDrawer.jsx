import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';
import SlideDrawer from './SlideDrawer';
import SupplierPicker from './SupplierPicker';
import ItemPicker from './ItemPicker';
import { useApp } from '../context/AppContext';
import { useMillStoreItems, useCreatePurchase } from '../modules/millStore/api/queries';

/**
 * Mill-store "New Purchase" as a right slide-over (same form as the full
 * /mill-store/purchases/new page). Records a consumable-materials purchase
 * (bags/packaging/etc.) with multiple line items. Props: open, onClose, onSaved.
 */
export default function NewPurchaseDrawer({ open, onClose, onSaved }) {
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
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ item_id: '', quantity: '', cost_per_unit: '' }]);

  // Reset the form each time it opens.
  useEffect(() => {
    if (!open) return;
    setSupplierId(''); setInvoiceNumber(''); setNotes('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setLines([{ item_id: '', quantity: '', cost_per_unit: '' }]);
  }, [open]);

  const addLine = () => setLines(prev => [...prev, { item_id: '', quantity: '', cost_per_unit: '' }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const setLine = (idx, key, val) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const totalAmount = useMemo(() =>
    lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost_per_unit) || 0), 0), [lines]);

  async function handleSubmit() {
    const validLines = lines.filter(l => l.item_id && Number(l.quantity) > 0 && Number(l.cost_per_unit) >= 0);
    if (validLines.length === 0) { addToast('Add at least one line item', 'error'); return; }
    try {
      await createMut.mutateAsync({
        supplier_id: supplierId ? Number(supplierId) : null,
        invoice_number: invoiceNumber || null,
        purchase_date: purchaseDate,
        notes: notes || null,
        lines: validLines.map(l => ({ item_id: Number(l.item_id), quantity: Number(l.quantity), cost_per_unit: Number(l.cost_per_unit) })),
      });
      addToast('Purchase recorded — stock updated', 'success');
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
      title="New Purchase"
      subtitle="Record a consumable materials purchase"
      icon={ShoppingCart}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500">Total <span className="font-semibold text-gray-900">Rs {totalAmount.toLocaleString()}</span></span>
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
            <SupplierPicker
              label="Supplier (optional)"
              value={supplierId}
              onChange={setSupplierId}
              suppliers={suppliersList || []}
              addToast={addToast}
              clearable
              placeholder="Search supplier (or leave blank for cash / walk-in)…"
            />
          </div>
          <div>
            <label className={LABEL}>Date *</label>
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
                  <ItemPicker
                    label="Item"
                    value={line.item_id}
                    onChange={(id) => {
                      setLine(idx, 'item_id', id);
                      const item = mergedItems.find(i => String(i.id) === String(id));
                      if (item?.last_purchase_cost) setLine(idx, 'cost_per_unit', item.last_purchase_cost);
                    }}
                    items={mergedItems}
                    onItemAdded={(it) => setLocalItems(prev => [it, ...prev])}
                    addToast={addToast}
                  />
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
                      <p className="text-sm font-medium text-gray-900 py-2 tabular-nums">Rs {lineTotal.toLocaleString()}</p>
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
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
            <p className="text-sm text-gray-500">{lines.filter(l => l.item_id).length} item(s)</p>
            <p className="text-base font-bold text-gray-900">Total: Rs {totalAmount.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </SlideDrawer>
  );
}
