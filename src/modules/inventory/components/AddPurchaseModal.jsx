import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, PlusCircle, Package, Wrench, Warehouse, Boxes, DollarSign, Truck } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { useAddPurchaseToLot } from '../../../api/queries';

const fmtPKR = (v) => 'Rs ' + (Math.round((parseFloat(v) || 0) * 100) / 100).toLocaleString();
const num = (v) => parseFloat(v) || 0;

// Landed (in-COGS) add-on costs. Transport is NOT here — it's a hauler payable set
// via the Additional Costs editor, not part of the rice's landed cost.
const COST_FIELDS = [
  ['labor_cost', 'Labor', Wrench],
  ['unloading_cost', 'Unloading', Warehouse],
  ['packing_cost', 'Packing', Boxes],
  ['other_cost', 'Other', DollarSign],
];

const BLANK = {
  weight_kg: '', total_bags: '', price_per_kg: '',
  labor_cost: '', unloading_cost: '', packing_cost: '', other_cost: '',
  bag_cost_per_bag: '', bag_cost_included: true,
  purchase_date: new Date().toISOString().slice(0, 10),
  payment_status: 'Pending', paid_amount: '', notes: '',
};

/**
 * Add another purchase (same supplier) onto an existing untouched lot, as a
 * right-side drawer. Supplier & rice type are inherited from the lot; the operator
 * enters the new delivery's weight / price / add-on costs. The lot's landed cost
 * becomes the weighted average — previewed live. Transport is handled separately
 * (Additional Costs → Hauler), so it isn't collected here.
 */
export default function AddPurchaseModal({ isOpen, lot, onClose, onSuccess }) {
  const { addToast } = useApp();
  const navigate = useNavigate();
  const addMut = useAddPurchaseToLot();
  const [form, setForm] = useState(BLANK);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  useEffect(() => { if (isOpen) setForm({ ...BLANK, purchase_date: new Date().toISOString().slice(0, 10) }); }, [isOpen]);

  const calc = useMemo(() => {
    const addKg = num(form.weight_kg);
    const bags = parseInt(form.total_bags, 10) || 0;
    const pricePerKg = num(form.price_per_kg);
    const addPurchase = addKg * pricePerKg;
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
    if (!(num(form.price_per_kg) > 0)) { addToast?.('Enter a price per kg', 'error'); return; }
    const bags = parseInt(form.total_bags, 10) || 0;
    const payload = {
      quantity_input: calc.addKg,
      quantity_unit: 'kg',
      rate_input: num(form.price_per_kg),
      rate_unit: 'kg',
      bag_weight_kg: bags > 0 ? calc.addKg / bags : (num(lot?.bagWeightKg) || 50),
      total_bags: bags || null,
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
      const resp = await addMut.mutateAsync({ id: lot.id, data: payload });
      const d = resp?.data || {};
      onSuccess?.();
      onClose?.();
      if (d.split && d.newLotNo) {
        // Lot had rice committed to a batch — the remainder + this purchase went to
        // a fresh lot; the committed portion kept its cost. Jump to the new lot.
        addToast?.(`Committed stock kept on ${lot.lotNo}; remainder + purchase → new lot ${d.newLotNo}`, 'success');
        navigate(`/lot-inventory/${d.newLotNo}`);
      } else {
        addToast?.(`Added ${(calc.addKg / 1000).toFixed(2)} MT to ${lot.lotNo}`, 'success');
      }
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add purchase', 'error');
    }
  }

  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1';

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-gray-500">
        New blended <span className="font-bold text-gray-900 ml-1">{fmtPKR(calc.newPerKg)}/kg</span>
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        <button onClick={submit} disabled={addMut.isPending || !(calc.addKg > 0) || !(num(form.price_per_kg) > 0)}
          className="btn btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-60">
          {addMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Add to lot
        </button>
      </div>
    </div>
  );

  return (
    <SlideDrawer open={isOpen} onClose={onClose} title="Add Purchase" subtitle={lot?.lotNo} icon={PlusCircle} size="lg" footer={footer}>
      <div className="space-y-5">
        {/* Inherited context */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Supplier</span><span className="font-medium text-gray-900">{lot?.supplierName || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Rice</span><span className="font-medium text-gray-900 truncate ml-2">{lot?.itemName}{lot?.variety ? ` — ${lot.variety}` : ''}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Current stock</span><span className="font-medium text-gray-900">{(calc.oldKg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT @ {fmtPKR(calc.oldPerKg)}/kg</span></div>
        </div>

        {/* Delivery */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1"><Package size={12} /> New delivery</p>
          <div className="grid grid-cols-3 gap-2.5">
            <div><label className={lbl}>Weight (kg) *</label><input type="number" min="0" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} className={inp} placeholder="0" /></div>
            <div><label className={lbl}>Total bags</label><input type="number" min="0" value={form.total_bags} onChange={(e) => set('total_bags', e.target.value)} className={inp} placeholder="0" /></div>
            <div><label className={lbl}>Price (Rs/kg) *</label><input type="number" min="0" value={form.price_per_kg} onChange={(e) => set('price_per_kg', e.target.value)} className={inp} placeholder="0" /></div>
          </div>
        </div>

        {/* Add-on costs (in COGS) */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Add-on costs (in rice cost)</p>
          <div className="grid grid-cols-2 gap-2.5">
            {COST_FIELDS.map(([k, label, Icon]) => (
              <div key={k}>
                <label className={`${lbl} flex items-center gap-1`}><Icon size={11} /> {label}</label>
                <input type="number" min="0" value={form[k]} onChange={(e) => set(k, e.target.value)} className={inp} placeholder="0" />
              </div>
            ))}
            <div>
              <label className={lbl}>Bag cost / bag</label>
              <input type="number" min="0" value={form.bag_cost_per_bag} onChange={(e) => set('bag_cost_per_bag', e.target.value)} disabled={form.bag_cost_included} className={`${inp} disabled:bg-gray-100`} placeholder="0" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 pt-6">
              <input type="checkbox" checked={form.bag_cost_included} onChange={(e) => set('bag_cost_included', e.target.checked)} />
              Bag cost in price
            </label>
          </div>
          <p className="mt-2 text-[11px] text-indigo-500 flex items-center gap-1"><Truck size={11} /> Transport? Add it with a hauler in the Costing tab → Additional Costs.</p>
        </div>

        {/* Date + payment */}
        <div className="grid grid-cols-2 gap-2.5">
          <div><label className={lbl}>Purchase date</label><input type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} className={inp} /></div>
          <div><label className={lbl}>Payment</label>
            <select value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)} className={inp}>
              <option>Pending</option><option>Partial</option><option>Paid</option>
            </select>
          </div>
          {form.payment_status === 'Partial' && (
            <div><label className={lbl}>Paid now</label><input type="number" min="0" value={form.paid_amount} onChange={(e) => set('paid_amount', e.target.value)} className={inp} placeholder="0" /></div>
          )}
          <div className={form.payment_status === 'Partial' ? '' : 'col-span-2'}>
            <label className={lbl}>Notes</label>
            <input type="text" value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inp} placeholder="Optional" />
          </div>
        </div>

        {/* Blended-cost preview */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 grid grid-cols-3 gap-3 text-center">
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
            {calc.addKg > 0 && <p className="text-[10px] text-gray-500">was {fmtPKR(calc.oldPerKg)}/kg</p>}
          </div>
        </div>
      </div>
    </SlideDrawer>
  );
}
