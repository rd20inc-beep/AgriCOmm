import { useMemo, useState } from 'react';
import { Loader2, CheckCircle2, PlusCircle } from 'lucide-react';
import Modal from '../../../components/Modal';
import { useApp } from '../../../context/AppContext';
import { useAddPurchaseToLot } from '../../../api/queries';

const fmtPKR = (v) => 'Rs ' + (Math.round((parseFloat(v) || 0) * 100) / 100).toLocaleString();
const num = (v) => parseFloat(v) || 0;

const COST_FIELDS = [
  ['transport_cost', 'Transport'],
  ['labor_cost', 'Labor'],
  ['unloading_cost', 'Unloading'],
  ['packing_cost', 'Packing'],
  ['other_cost', 'Other'],
];

/**
 * Add another purchase (same supplier) onto an existing untouched lot. Supplier
 * and rice type are inherited from the lot and shown read-only; the operator
 * enters only the new delivery's weight / price / costs. The lot's landed cost
 * becomes the weighted average — previewed live before submit.
 */
export default function AddPurchaseModal({ isOpen, lot, onClose, onSuccess }) {
  const { addToast } = useApp();
  const addMut = useAddPurchaseToLot();
  const [form, setForm] = useState({
    weight_kg: '',
    total_bags: '',
    price_per_mt: '',
    transport_cost: '',
    labor_cost: '',
    unloading_cost: '',
    packing_cost: '',
    other_cost: '',
    bag_cost_per_bag: '',
    bag_cost_included: true,
    purchase_date: new Date().toISOString().slice(0, 10),
    payment_status: 'Pending',
    paid_amount: '',
    notes: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const calc = useMemo(() => {
    const addKg = num(form.weight_kg);
    const bags = parseInt(form.total_bags, 10) || 0;
    const pricePerMT = num(form.price_per_mt);
    const addPurchase = (addKg / 1000) * pricePerMT;
    const direct = COST_FIELDS.reduce((s, [k]) => s + num(form[k]), 0);
    const bagCost = form.bag_cost_included ? 0 : num(form.bag_cost_per_bag) * bags;
    const addLanded = addPurchase + direct + bagCost;

    const oldKg = num(lot?.netWeightKg) || num(lot?.grossWeightKg);
    const oldLanded = num(lot?.landedCostTotal);
    const oldPerKg = num(lot?.landedCostPerKg);
    const newKg = oldKg + addKg;
    const newLanded = oldLanded + addLanded;
    const newPerKg = newKg > 0 ? newLanded / newKg : 0;
    return { addKg, addLanded, oldKg, oldPerKg, newKg, newLanded, newPerKg };
  }, [form, lot]);

  async function submit() {
    if (!(calc.addKg > 0)) { addToast?.('Enter a weight greater than zero', 'error'); return; }
    if (!(num(form.price_per_mt) > 0)) { addToast?.('Enter a price per MT', 'error'); return; }
    const bags = parseInt(form.total_bags, 10) || 0;
    const payload = {
      quantity_input: calc.addKg,
      quantity_unit: 'kg',
      rate_input: num(form.price_per_mt) / 1000,
      rate_unit: 'kg',
      bag_weight_kg: bags > 0 ? calc.addKg / bags : (num(lot?.bagWeightKg) || 50),
      total_bags: bags || null,
      transport_cost: num(form.transport_cost),
      labor_cost: num(form.labor_cost),
      unloading_cost: num(form.unloading_cost),
      packing_cost: num(form.packing_cost),
      other_cost: num(form.other_cost),
      bag_cost_per_bag: num(form.bag_cost_per_bag),
      bag_cost_included: !!form.bag_cost_included,
      purchase_date: form.purchase_date || null,
      payment_status: form.payment_status,
      paid_amount: form.payment_status === 'Partial' ? num(form.paid_amount) : null,
      notes: form.notes || null,
    };
    try {
      await addMut.mutateAsync({ id: lot.id, data: payload });
      addToast?.(`Added ${(calc.addKg / 1000).toFixed(2)} MT to ${lot.lotNo}`, 'success');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add purchase', 'error');
    }
  }

  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Add purchase to ${lot?.lotNo || 'lot'}`} size="lg">
      <div className="space-y-4">
        {/* Inherited context */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm bg-gray-50 rounded-lg p-3">
          <span><span className="text-gray-500">Supplier:</span> <span className="font-medium">{lot?.supplierName || '—'}</span></span>
          <span><span className="text-gray-500">Rice:</span> <span className="font-medium">{lot?.itemName}{lot?.variety ? ` — ${lot.variety}` : ''}</span></span>
          <span><span className="text-gray-500">Current:</span> <span className="font-medium">{(calc.oldKg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT @ {fmtPKR(calc.oldPerKg)}/kg</span></span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={lbl}>Weight (kg) *</label>
            <input type="number" min="0" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} className={inp} placeholder="0" />
          </div>
          <div>
            <label className={lbl}>Total bags</label>
            <input type="number" min="0" value={form.total_bags} onChange={(e) => set('total_bags', e.target.value)} className={inp} placeholder="0" />
          </div>
          <div>
            <label className={lbl}>Price (Rs / MT) *</label>
            <input type="number" min="0" value={form.price_per_mt} onChange={(e) => set('price_per_mt', e.target.value)} className={inp} placeholder="0" />
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {COST_FIELDS.map(([k, label]) => (
            <div key={k}>
              <label className={lbl}>{label}</label>
              <input type="number" min="0" value={form[k]} onChange={(e) => set(k, e.target.value)} className={inp} placeholder="0" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className={lbl}>Bag cost / bag</label>
            <input type="number" min="0" value={form.bag_cost_per_bag} onChange={(e) => set('bag_cost_per_bag', e.target.value)} disabled={form.bag_cost_included} className={`${inp} disabled:bg-gray-100`} placeholder="0" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input type="checkbox" checked={form.bag_cost_included} onChange={(e) => set('bag_cost_included', e.target.checked)} />
            Bag cost in price
          </label>
          <div>
            <label className={lbl}>Purchase date</label>
            <input type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} className={inp} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={lbl}>Payment</label>
            <select value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)} className={inp}>
              <option>Pending</option>
              <option>Partial</option>
              <option>Paid</option>
            </select>
          </div>
          {form.payment_status === 'Partial' && (
            <div>
              <label className={lbl}>Paid now</label>
              <input type="number" min="0" value={form.paid_amount} onChange={(e) => set('paid_amount', e.target.value)} className={inp} placeholder="0" />
            </div>
          )}
          <div className={form.payment_status === 'Partial' ? '' : 'col-span-2'}>
            <label className={lbl}>Notes</label>
            <input type="text" value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inp} placeholder="Optional" />
          </div>
        </div>

        {/* Blended-cost preview */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[11px] text-amber-700">This purchase (landed)</p>
            <p className="text-base font-bold text-gray-900">{fmtPKR(calc.addLanded)}</p>
          </div>
          <div>
            <p className="text-[11px] text-amber-700">New lot total</p>
            <p className="text-base font-bold text-gray-900">{(calc.newKg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT</p>
          </div>
          <div>
            <p className="text-[11px] text-amber-700">New blended cost</p>
            <p className="text-base font-bold text-gray-900">{fmtPKR(calc.newPerKg)}/kg</p>
            {calc.addKg > 0 && (
              <p className="text-[10px] text-gray-500">was {fmtPKR(calc.oldPerKg)}/kg</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={addMut.isPending} className="px-4 py-2 text-sm text-white bg-orange-600 rounded-lg hover:bg-orange-700 inline-flex items-center gap-2 disabled:opacity-60">
            {addMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Add to lot
          </button>
        </div>
      </div>
    </Modal>
  );
}
