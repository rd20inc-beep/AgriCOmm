import { useState, useEffect, useCallback } from 'react';
import {
  Printer, Plus, Loader2, Truck, CheckCircle2, Trash2, Wallet, X, PackageCheck, AlertCircle,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import SlideDrawer from '../../../components/SlideDrawer';
import BagTypePicker from '../../../components/BagTypePicker';
import SupplierPicker from '../../../components/SupplierPicker';
import { printedBagsApi } from '../api/services';

const PRINTING_OPTIONS = ['Plain', 'Buyer Logo', 'Buyer Logo + Text', 'Custom Design'];
const rs = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatusPill({ status }) {
  const map = {
    Ordered: 'bg-amber-100 text-amber-800',
    Received: 'bg-emerald-100 text-emerald-800',
    Cancelled: 'bg-gray-100 text-gray-600',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}

function PayPill({ status, outstanding }) {
  if (status === 'Paid') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800">Paid</span>;
  const cls = status === 'Partial' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-700';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{status === 'Partial' ? `Partial · ${rs(outstanding)} left` : `Unpaid · ${rs(outstanding)}`}</span>;
}

export default function PrintedBagsTab({ order, onUpdated }) {
  const { addToast, suppliersList, bagTypesList, bankAccountsList } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payTarget, setPayTarget] = useState(null);

  const blank = { bagType: '', bagTypeId: null, bagSizeKg: '', vendorId: '', quantity: '', unitCost: '', printing: order?.bag_printing || '', brand: order?.bag_brand || '', notes: '' };
  const [draft, setDraft] = useState(blank);

  const load = useCallback(async () => {
    if (!order?.id) return;
    setLoading(true);
    try {
      const res = await printedBagsApi.list(order.id);
      setRows(res?.data?.items || []);
    } catch (err) {
      addToast?.(err?.message || 'Failed to load printed bag orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [order?.id, addToast]);

  useEffect(() => { load(); }, [load]);

  const total = (parseInt(draft.quantity, 10) || 0) * (parseFloat(draft.unitCost) || 0);

  async function submit() {
    if (!draft.quantity || (parseInt(draft.quantity, 10) || 0) <= 0) { addToast?.('Enter the number of bags', 'error'); return; }
    setSaving(true);
    try {
      await printedBagsApi.create({
        order_id: order.id,
        bag_type_id: draft.bagTypeId || null,
        bag_type_name: draft.bagType || null,
        bag_size_kg: draft.bagSizeKg || null,
        vendor_id: draft.vendorId || null,
        quantity: parseInt(draft.quantity, 10),
        unit_cost: parseFloat(draft.unitCost) || 0,
        printing: draft.printing || null,
        brand_marking: draft.brand || null,
        notes: draft.notes || null,
      });
      addToast?.('Printed bag order created', 'success');
      setShowAdd(false);
      setDraft(blank);
      await load();
      onUpdated?.();
    } catch (err) {
      addToast?.(err?.message || 'Failed to create order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function receive(row) {
    setBusyId(row.id);
    try {
      await printedBagsApi.receive(row.id, {});
      addToast?.(`${row.pbo_no} marked received`, 'success');
      await load();
    } catch (err) {
      addToast?.(err?.message || 'Failed to mark received', 'error');
    } finally { setBusyId(null); }
  }

  async function remove(row) {
    if (!window.confirm(`Delete printed bag order ${row.pbo_no}? This reverses its cost and payable.`)) return;
    setBusyId(row.id);
    try {
      await printedBagsApi.remove(row.id);
      addToast?.(`${row.pbo_no} deleted`, 'success');
      await load();
      onUpdated?.();
    } catch (err) {
      addToast?.(err?.message || 'Failed to delete', 'error');
    } finally { setBusyId(null); }
  }

  const totalOrdered = rows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
  const totalOutstanding = rows.reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Printer className="w-5 h-5 text-violet-600" /> Printed Bags</h3>
          <p className="text-sm text-gray-500">Order printed / branded bags from a vendor for this export order. Each order books a payable to the vendor.</p>
        </div>
        <button onClick={() => { setDraft(blank); setShowAdd(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700">
          <Plus className="w-4 h-4" /> Order Printed Bags
        </button>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-3"><p className="text-xs text-gray-500">Orders</p><p className="text-lg font-bold text-gray-900">{rows.length}</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-3"><p className="text-xs text-gray-500">Total cost</p><p className="text-lg font-bold text-gray-900">{rs(totalOrdered)}</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-3"><p className="text-xs text-gray-500">Outstanding</p><p className={`text-lg font-bold ${totalOutstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{rs(totalOutstanding)}</p></div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <PackageCheck className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No printed bags ordered for this export order yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm mobile-cards">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Order</th>
                <th className="text-left px-4 py-2 font-medium">Bag / Printing</th>
                <th className="text-left px-4 py-2 font-medium">Vendor</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
                <th className="text-right px-4 py-2 font-medium">Unit</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Payment</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td data-label="Order" className="px-4 py-2 font-mono text-xs text-gray-600">{r.pbo_no}</td>
                  <td data-label="Bag / Printing" className="px-4 py-2">
                    <div className="font-medium text-gray-900">{r.bag_type_name || r.bag_type_current_name || '—'}{r.bag_size_kg ? ` · ${r.bag_size_kg}kg` : ''}</div>
                    {(r.printing || r.brand_marking) && <div className="text-xs text-gray-500">{[r.printing, r.brand_marking].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td data-label="Vendor" className="mob-hide px-4 py-2 text-gray-700">{r.vendor_name || <span className="text-gray-400">—</span>}</td>
                  <td data-label="Qty" className="px-4 py-2 text-right text-gray-700">{(parseInt(r.quantity, 10) || 0).toLocaleString()}</td>
                  <td data-label="Unit" className="mob-hide px-4 py-2 text-right text-gray-700">{rs(r.unit_cost)}</td>
                  <td data-label="Total" className="px-4 py-2 text-right font-semibold text-gray-900">{rs(r.total_amount)}</td>
                  <td data-label="Status" className="px-4 py-2"><StatusPill status={r.status} /></td>
                  <td data-label="Payment" className="px-4 py-2"><PayPill status={r.payment_status} outstanding={r.outstanding} /></td>
                  <td data-label="" className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {r.status !== 'Received' && (
                        <button onClick={() => receive(r)} disabled={busyId === r.id} title="Mark received"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50">
                          {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Receive
                        </button>
                      )}
                      {(parseFloat(r.outstanding) || 0) > 0.01 && (
                        <button onClick={() => setPayTarget(r)} title="Pay vendor"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100">
                          <Wallet className="w-3 h-3" /> Pay
                        </button>
                      )}
                      <button onClick={() => remove(r)} disabled={busyId === r.id} title="Delete"
                        className="inline-flex items-center px-1.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add drawer */}
      <SlideDrawer open={showAdd} onClose={() => setShowAdd(false)} title="Order Printed Bags" icon={Printer} size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Order
            </button>
          </div>
        )}>
        <div className="space-y-4">
          <BagTypePicker label="Bag Type" value={draft.bagType} bagTypes={bagTypesList} addToast={addToast}
            onChange={(name, bt) => setDraft(d => ({ ...d, bagType: name, bagTypeId: bt?.id || null, bagSizeKg: bt ? String(bt.sizeKg ?? bt.size_kg ?? d.bagSizeKg) : d.bagSizeKg }))} />

          <SupplierPicker label="Bag Vendor" value={draft.vendorId} suppliers={suppliersList} addToast={addToast} clearable
            onChange={(id) => setDraft(d => ({ ...d, vendorId: id }))} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (bags) <span className="text-red-500">*</span></label>
              <input type="number" min="0" value={draft.quantity} onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500" placeholder="e.g. 2000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit cost (Rs/bag)</label>
              <input type="number" min="0" step="0.01" value={draft.unitCost} onChange={e => setDraft(d => ({ ...d, unitCost: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500" placeholder="e.g. 60" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Printing</label>
              <select value={draft.printing} onChange={e => setDraft(d => ({ ...d, printing: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500">
                <option value="">Select…</option>
                {PRINTING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand / Marking</label>
              <input value={draft.brand} onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500" placeholder="Brand on bag" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500" placeholder="Optional" />
          </div>

          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm flex items-center justify-between">
            <span className="text-violet-700 font-medium">Total cost</span>
            <span className="text-violet-900 font-bold">{rs(total)}</span>
          </div>
          <p className="text-xs text-gray-400 flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Creating the order books a payable to the vendor and a GL cost on this export order. Settle it with the Pay button or on the vendor's statement.</p>
        </div>
      </SlideDrawer>

      {/* Pay drawer */}
      <PayDrawer target={payTarget} bankAccounts={bankAccountsList} onClose={() => setPayTarget(null)}
        onPaid={async () => { setPayTarget(null); await load(); onUpdated?.(); }} addToast={addToast} />
    </div>
  );
}

function PayDrawer({ target, bankAccounts = [], onClose, onPaid, addToast }) {
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) { setAmount(String(Math.round(parseFloat(target.outstanding) || 0))); setBankId(''); setMethod('cash'); setRef(''); }
  }, [target]);

  if (!target) return null;

  async function pay() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { addToast?.('Enter an amount', 'error'); return; }
    setSaving(true);
    try {
      await printedBagsApi.pay({
        source: 'printed_bag',
        source_id: target.id,
        amount: amt,
        bank_account_id: bankId || null,
        payment_method: method,
        payment_reference: ref || null,
      });
      addToast?.(`Paid ${rs(amt)} to ${target.vendor_name || 'vendor'}`, 'success');
      onPaid?.();
    } catch (err) {
      addToast?.(err?.message || 'Payment failed', 'error');
    } finally { setSaving(false); }
  }

  return (
    <SlideDrawer open={!!target} onClose={onClose} title={`Pay — ${target.pbo_no}`} icon={Wallet} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={pay} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />} Record Payment
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="font-medium text-gray-900">{target.vendor_name || '—'}</span></div>
          <div className="flex justify-between mt-1"><span className="text-gray-500">Outstanding</span><span className="font-semibold text-red-600">{rs(target.outstanding)}</span></div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pay from account</label>
          <select value={bankId} onChange={e => setBankId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
            <option value="">— none —</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name ? ` (${a.bank_name})` : ''}</option>)}
          </select>
        </div>
        {method === 'cheque' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cheque #</label>
            <input value={ref} onChange={e => setRef(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>
    </SlideDrawer>
  );
}
