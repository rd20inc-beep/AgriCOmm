import { useState, useEffect } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { lotInventoryApi } from '../../../api/services';
import { fmtPKR as fmtPKRBase, fmtNum } from '../../../shared/utils/format';

const fmtPKR = (v, opts) => fmtPKRBase(parseFloat(v) || 0, { decimals: 2, ...opts });

// Lot-precise Mill <-> Export stock transfer drawers. Shared by Lot Detail,
// the Lot Inventory row action (W14) and the Stock transfers page, so every
// entry point posts through the same endpoint with the same validation.

// Transfer a finished/by-product mill lot's stock to the export entity. Deducts
// this lot and creates a matching export-entity lot (lot-precise, validated).
export function TransferToExportDrawer({ isOpen, onClose, lot, addToast, onSuccess }) {
  // Mill Operator/Supervisor move finished goods to the export-ready pool but do
  // NOT select/connect export orders — that's the Export user's job (allocation
  // happens on the export side), so this drawer never shows an order picker.
  const availableKg = parseFloat(lot?.availableQty) || 0;
  const defaultPrice = Math.round((parseFloat(lot?.costPerUnit) || 0) * 100) / 100; // per KG
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQty(availableKg ? String(availableKg) : '');
    setPrice(defaultPrice ? String(defaultPrice) : '');
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lot) return null;

  const q = parseFloat(qty) || 0;
  const exceeds = q > availableKg + 0.0001;
  const totalVal = q * (parseFloat(price) || 0); // qty (kg) × price (per-kg)

  async function handleSubmit(e) {
    e.preventDefault();
    if (!q || q <= 0) { addToast('Enter a quantity', 'error'); return; }
    if (exceeds) { addToast(`Only ${availableKg} KG available`, 'error'); return; }
    setSaving(true);
    try {
      const res = await lotInventoryApi.transferLotToExport(lot.id, {
        qty_kg: q,
        // Input is per-kg; the export/transfer doc boundary is per-MT.
        transfer_price_pkr: price === '' ? null : parseFloat(price) * 1000,
      });
      addToast(res?.message || 'Transferred to export', 'success');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Transfer failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-500">Value <span className="font-semibold text-gray-900">{fmtPKR(totalVal, { decimals: 2 })}</span></span>
      <div className="flex gap-2">
        <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !q || exceeds} className="btn btn-primary btn-sm">
          <ArrowRightLeft className="w-4 h-4" /> {saving ? 'Transferring…' : 'Transfer to Export'}
        </button>
      </div>
    </div>
  );

  return (
    <SlideDrawer open={isOpen} onClose={onClose} title="Transfer to Export" subtitle={lot.lotNo} icon={ArrowRightLeft} size="md" footer={footer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
          Moves finished rice from the <b>mill</b> entity to <b>export</b>. A new export-entity lot is created and this lot is drawn down. Available: <b>{availableKg} KG</b>.
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG) <span className="text-red-500">*</span></label>
          <input type="number" min="0" max={availableKg} step="any" value={qty} onChange={e => setQty(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          {exceeds && <p className="text-xs text-red-600 mt-1">Only {availableKg} KG available.</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Transfer price (Rs / kg)</label>
          <input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400 mt-1">Defaults to the lot's cost. Sets the export lot's cost and the inter-entity transfer value.</p>
        </div>
        <p className="text-xs text-gray-400">The stock moves to the export-ready pool. An Export user allocates it to an order later.</p>
      </form>
    </SlideDrawer>
  );
}

// Transfer an export lot's stock back to the mill entity. Deducts this export
// lot (only its available qty) and creates a matching mill-entity lot.
export function TransferToMillDrawer({ isOpen, onClose, lot, addToast, onSuccess }) {
  const availableKg = parseFloat(lot?.availableQty) || 0;
  const reservedKg = parseFloat(lot?.reservedQty) || 0;
  const defaultPrice = Math.round((parseFloat(lot?.costPerUnit) || 0) * 100) / 100; // per KG
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQty(availableKg ? String(availableKg) : '');
    setPrice(defaultPrice ? String(defaultPrice) : '');
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lot) return null;

  const q = parseFloat(qty) || 0;
  const exceeds = q > availableKg + 0.0001;
  const totalVal = q * (parseFloat(price) || 0); // qty (kg) × price (per-kg)

  async function handleSubmit(e) {
    e.preventDefault();
    if (!q || q <= 0) { addToast('Enter a quantity', 'error'); return; }
    if (exceeds) { addToast(`Only ${availableKg} KG available`, 'error'); return; }
    setSaving(true);
    try {
      const res = await lotInventoryApi.transferLotToMill(lot.id, {
        qty_kg: q,
        // Input is per-kg; the transfer doc boundary is per-MT.
        transfer_price_pkr: price === '' ? null : parseFloat(price) * 1000,
      });
      addToast(res?.message || 'Transferred back to mill', 'success');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Transfer failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-500">Value <span className="font-semibold text-gray-900">{fmtPKR(totalVal, { decimals: 2 })}</span></span>
      <div className="flex gap-2">
        <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !q || exceeds} className="btn btn-primary btn-sm">
          <ArrowRightLeft className="w-4 h-4" /> {saving ? 'Transferring…' : 'Transfer to Mill'}
        </button>
      </div>
    </div>
  );

  return (
    <SlideDrawer open={isOpen} onClose={onClose} title="Transfer to Mill" subtitle={lot.lotNo} icon={ArrowRightLeft} size="md" footer={footer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          Moves stock from the <b>export</b> entity back to <b>mill</b>. A new mill-entity lot is created and this lot is drawn down. Available: <b>{availableKg} KG</b>{reservedKg > 0 ? ` (${fmtNum(Math.round(reservedKg))} kg reserved for an order can't move)` : ''}.
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG) <span className="text-red-500">*</span></label>
          <input type="number" min="0" max={availableKg} step="any" value={qty} onChange={e => setQty(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          {exceeds && <p className="text-xs text-red-600 mt-1">Only {availableKg} KG available.</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Transfer price (Rs / kg)</label>
          <input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400 mt-1">Defaults to the lot's cost. Sets the new mill lot's cost basis.</p>
        </div>
      </form>
    </SlideDrawer>
  );
}
