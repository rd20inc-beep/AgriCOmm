import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useMillStoreItems, useCreatePurchase } from '../api/queries';

export default function NewPurchase() {
  const navigate = useNavigate();
  const { suppliersList, addToast } = useApp();
  const { data: items = [] } = useMillStoreItems({ limit: 500 });
  const safeItems = Array.isArray(items) ? items : [];
  const createMut = useCreatePurchase();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ item_id: '', quantity: '', cost_per_unit: '' }]);

  const addLine = () => setLines(prev => [...prev, { item_id: '', quantity: '', cost_per_unit: '' }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const setLine = (idx, key, val) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const totalAmount = useMemo(() =>
    lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost_per_unit) || 0), 0),
    [lines]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supplierId) { addToast('Select a supplier', 'error'); return; }
    const validLines = lines.filter(l => l.item_id && Number(l.quantity) > 0 && Number(l.cost_per_unit) >= 0);
    if (validLines.length === 0) { addToast('Add at least one line item', 'error'); return; }

    try {
      await createMut.mutateAsync({
        supplier_id: Number(supplierId),
        invoice_number: invoiceNumber || null,
        purchase_date: purchaseDate,
        notes: notes || null,
        lines: validLines.map(l => ({
          item_id: Number(l.item_id),
          quantity: Number(l.quantity),
          cost_per_unit: Number(l.cost_per_unit),
        })),
      });
      addToast('Purchase recorded — stock updated', 'success');
      navigate('/mill-store');
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">New Purchase</h1>
      <p className="text-sm text-gray-500 mb-6">Record a consumable materials purchase</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="form-input w-full text-sm"
                required
              >
                <option value="">Select supplier</option>
                {(suppliersList || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Invoice #</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="form-input w-full text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Date *</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="form-input w-full text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="form-input w-full text-sm"
                placeholder="Optional"
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button type="button" onClick={addLine}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <Plus size={14} /> Add Line
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const selectedItem = safeItems.find(i => String(i.id) === String(line.item_id));
              const lineTotal = (Number(line.quantity) || 0) * (Number(line.cost_per_unit) || 0);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    {idx === 0 && <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Item</label>}
                    <select
                      value={line.item_id}
                      onChange={(e) => {
                        setLine(idx, 'item_id', e.target.value);
                        const item = safeItems.find(i => String(i.id) === e.target.value);
                        if (item?.last_purchase_cost) setLine(idx, 'cost_per_unit', item.last_purchase_cost);
                      }}
                      className="form-input w-full text-sm"
                    >
                      <option value="">Select item</option>
                      {safeItems.map(i => (
                        <option key={i.id} value={i.id}>{i.code} — {i.name} ({i.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Qty</label>}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => setLine(idx, 'quantity', e.target.value)}
                      className="form-input w-full text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Cost/unit</label>}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.cost_per_unit}
                      onChange={(e) => setLine(idx, 'cost_per_unit', e.target.value)}
                      className="form-input w-full text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-2 text-right">
                    {idx === 0 && <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Total</label>}
                    <p className="text-sm font-medium text-gray-900 py-2">Rs {lineTotal.toLocaleString()}</p>
                  </div>
                  <div className="col-span-1 text-right">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200 flex justify-between items-center">
            <p className="text-sm text-gray-500">{lines.filter(l => l.item_id).length} items</p>
            <p className="text-lg font-bold text-gray-900">Total: Rs {totalAmount.toLocaleString()}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/mill-store')}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <ShoppingCart size={16} />
            {createMut.isPending ? 'Saving...' : 'Record Purchase'}
          </button>
        </div>
      </form>
    </div>
  );
}
