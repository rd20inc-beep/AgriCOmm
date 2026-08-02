import { useMemo, useState } from 'react';
import { Truck, Plus, Pencil, Trash2, Eye, EyeOff, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useHaulers,
  useHaulerLedger,
  useCreateHauler,
  useUpdateHauler,
  useDeleteHauler,
  useUnreconciledTransport,
  useReconcileTransport,
} from '../../../../api/queries';
import { useApp } from '../../../../context/AppContext';
import SlideDrawer from '../../../../components/SlideDrawer';
import HaulerPicker from '../../../../components/HaulerPicker';

const PAID_BY_OPTS = [
  ['company', 'Company (creates payable)'], ['supplier', 'Supplier'], ['customer', 'Customer'],
  ['service_client', 'Service Milling Client'], ['included_in_supplier_rate', 'Included in Supplier Rate'],
  ['deduct_from_supplier', 'Deduct from Supplier Payment'], ['other', 'Other'],
];

// #14 Phase 3 — reconcile legacy transport charges (lot / batch) that never
// became a transporter payable: pick a transporter + who bears it, then create
// the payable (company) or exclude the charge.
function ReconcileDrawer({ open, onClose, addToast }) {
  const { data, isLoading } = useUnreconciledTransport();
  const reconcileMut = useReconcileTransport();
  const [rowState, setRowState] = useState({}); // key -> { hauler_id, paid_by }
  const rows = [
    ...((data?.lots) || []).map((r) => ({ ...r, source: 'lot', key: `lot-${r.id}`, ref: r.lot_no, sid: r.id })),
    ...((data?.batches) || []).map((r) => ({ ...r, source: 'batch', key: `batch-${r.batch_id}`, ref: r.batch_no, sid: r.batch_id })),
  ];
  const setRow = (k, patch) => setRowState((p) => ({ ...p, [k]: { ...(p[k] || { paid_by: 'company' }), ...patch } }));

  async function doReconcile(row, action) {
    const st = rowState[row.key] || { paid_by: 'company' };
    try {
      await reconcileMut.mutateAsync({
        source: row.source, source_id: row.sid,
        hauler_id: st.hauler_id ? parseInt(st.hauler_id, 10) : null,
        paid_by: st.paid_by || 'company', action,
      });
      addToast(action === 'exclude' ? `${row.ref} excluded` : `${row.ref} reconciled — payable created`, 'success');
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Reconcile failed', 'error');
    }
  }

  return (
    <SlideDrawer open={open} onClose={onClose} title="Reconcile transport costs" subtitle="Legacy charges without a transporter payable" icon={History} size="lg">
      {isLoading ? (
        <div className="py-10 text-center text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-gray-400">Nothing to reconcile — every transport charge is linked.</div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-gray-500">Assign a transporter and who bears each charge. <b>Company</b> creates a transporter payable (payable in Money Out); <b>Exclude</b> dismisses the charge.</p>
          {rows.map((row) => {
            const st = rowState[row.key] || { paid_by: 'company' };
            return (
              <div key={row.key} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase mr-2">{row.source}</span>
                    <span className="font-medium text-gray-900">{row.ref}</span>
                    <span className="text-gray-400 text-xs ml-2">{row.date ? String(row.date).slice(0, 10) : ''}{row.supplier_name ? ` · ${row.supplier_name}` : ''}</span>
                  </div>
                  <span className="font-semibold tabular-nums">Rs {Number(row.amount).toLocaleString('en-PK', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <HaulerPicker value={st.hauler_id || ''} onChange={(id) => setRow(row.key, { hauler_id: id })} addToast={addToast} clearable placeholder="Transporter…" />
                  <select value={st.paid_by || 'company'} onChange={(e) => setRow(row.key, { paid_by: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white h-[38px] self-end">
                    {PAID_BY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => doReconcile(row, 'exclude')} disabled={reconcileMut.isPending}
                    className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">Exclude</button>
                  <button onClick={() => doReconcile(row, 'create')} disabled={reconcileMut.isPending}
                    className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Create payable</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SlideDrawer>
  );
}

const EMPTY = {
  name: '', contact_person: '', phone: '', email: '',
  address: '', ntn: '', vehicle_types: '', notes: '', opening_balance: '', is_active: true,
};

const fmt = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

// #14 Phase 1c — transporter ledger: opening balance, every charge and payment
// in date order with a running balance, and the closing (outstanding) balance.
// Lots and payments are drill-through links.
function HaulerLedgerDrawer({ id, open, onClose }) {
  const { data, isLoading } = useHaulerLedger(open ? id : null);
  const hauler = data?.hauler;
  const entries = data?.entries || [];
  const totals = data?.totals || {};
  const opening = Number(data?.opening_balance) || 0;
  const closing = Number(data?.closing_balance) || 0;
  return (
    <SlideDrawer open={open} onClose={onClose} title={hauler?.name || 'Transporter'} subtitle="Transporter ledger" icon={History} size="lg">
      {isLoading ? (
        <div className="py-10 text-center text-gray-400">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Opening</p>
              <p className="text-base font-semibold text-gray-900 tabular-nums">Rs {fmt(opening)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Charges</p>
              <p className="text-base font-semibold text-gray-900 tabular-nums">Rs {fmt(totals.charges)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Payments</p>
              <p className="text-base font-semibold text-emerald-700 tabular-nums">Rs {fmt(totals.payments)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 bg-amber-50">
              <p className="text-[11px] uppercase text-amber-600">Outstanding</p>
              <p className="text-base font-semibold text-amber-700 tabular-nums">Rs {fmt(closing)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Ref</th>
                  <th className="text-right px-3 py-2 font-medium">Charge</th>
                  <th className="text-right px-3 py-2 font-medium">Payment</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-500" colSpan={5}>Opening balance</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">Rs {fmt(opening)}</td>
                </tr>
                {entries.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No transactions yet.</td></tr>
                ) : entries.map((e, i) => (
                  <tr key={i} className={e.paidBy && e.paidBy !== 'company' && e.kind === 'charge' ? 'text-gray-400' : ''}>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.date ? String(e.date).slice(0, 10) : '—'}</td>
                    <td className="px-3 py-2">
                      {e.lotNo
                        ? <Link to={`/lot-inventory/${e.lotNo}`} className="text-blue-600 hover:underline">{e.description}</Link>
                        : e.description}
                      {e.kind === 'charge' && e.paidBy && e.paidBy !== 'company' && (
                        <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-500">{String(e.paidBy).replace(/_/g, ' ')} · not company</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{e.ref || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.charge ? `Rs ${fmt(e.charge)}` : (e.informationalAmount ? <span className="text-gray-400">(Rs {fmt(e.informationalAmount)})</span> : '—')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{e.payment ? `Rs ${fmt(e.payment)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">Rs {fmt(e.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-amber-50 font-semibold">
                  <td className="px-3 py-2" colSpan={5}>Closing balance (outstanding)</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">Rs {fmt(closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            Charges shown in grey/parentheses are supplier- or client-paid and do not affect
            the company balance. Payments come from Finance → Money Out.
          </p>
        </div>
      )}
    </SlideDrawer>
  );
}

export default function HaulersTab() {
  const { addToast } = useApp();
  const { data: haulers = [], isLoading } = useHaulers({ includeInactive: true });
  const createMut = useCreateHauler();
  const updateMut = useUpdateHauler();
  const deleteMut = useDeleteHauler();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [historyId, setHistoryId] = useState(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const { data: unrec } = useUnreconciledTransport();
  const unrecCount = unrec?.total || 0;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return haulers;
    return haulers.filter((h) =>
      (h.name || '').toLowerCase().includes(s) ||
      (h.contact_person || '').toLowerCase().includes(s) ||
      (h.phone || '').toLowerCase().includes(s));
  }, [haulers, q]);

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(h) {
    setEditingId(h.id);
    setForm({
      name: h.name || '', contact_person: h.contact_person || '', phone: h.phone || '',
      email: h.email || '', address: h.address || '', ntn: h.ntn || '',
      vehicle_types: h.vehicle_types || '', notes: h.notes || '', opening_balance: h.opening_balance != null ? String(h.opening_balance) : '', is_active: !!h.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    const name = String(form.name || '').trim();
    if (!name) { addToast('Hauler name is required', 'error'); return; }
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: form });
        addToast(`"${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(form);
        addToast(`"${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save', 'error');
    }
  }

  async function handleToggle(h) {
    try {
      await updateMut.mutateAsync({ id: h.id, data: { is_active: !h.is_active } });
      addToast(h.is_active ? `"${h.name}" hidden` : `"${h.name}" restored`, 'success');
    } catch (err) { addToast(err.message || 'Toggle failed', 'error'); }
  }

  async function handleDelete(h) {
    if (!window.confirm(`Delete "${h.name}"? If it has been used anywhere it will be hidden instead.`)) return;
    try {
      await deleteMut.mutateAsync(h.id);
      addToast(`"${h.name}" removed`, 'success');
    } catch (err) { addToast(err.message || 'Delete failed', 'error'); }
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Transport / Haulers</h2>
            <span className="text-xs text-gray-400 ml-1">freight contractors — separate from suppliers</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search haulers…"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
            <button
              onClick={() => setReconcileOpen(true)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm border ${unrecCount > 0 ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <History className="w-4 h-4" /> Reconcile{unrecCount > 0 ? ` (${unrecCount})` : ''}
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              <Plus className="w-4 h-4" /> Add Hauler
            </button>
          </div>
        </div>

        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No haulers yet. Add your first transport contractor.</td></tr>
              ) : (
                filtered.map((h) => (
                  <tr key={h.id} className={`hover:bg-gray-50 ${!h.is_active ? 'opacity-50' : ''}`}>
                    <td data-label="Name" className="px-4 py-3 font-medium text-gray-900">{h.name}</td>
                    <td data-label="Contact" className="mob-hide px-4 py-3 text-gray-700">{h.contact_person || '—'}</td>
                    <td data-label="Phone" className="px-4 py-3 text-gray-700">{h.phone || '—'}</td>
                    <td data-label="Status" className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        h.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {h.is_active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setHistoryId(h.id)} title="History"
                          className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded">
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleToggle(h)} title={h.is_active ? 'Hide' : 'Show'}
                          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded">
                          {h.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => openEdit(h)} title="Edit"
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(h)} title="Delete"
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SlideDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Edit Hauler' : 'Add Hauler'}
        subtitle="Transport contractor for purchase-lot freight"
        icon={Truck}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {createMut.isPending || updateMut.isPending ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Hauler')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hauler name *</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Malik Goods Transport"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact person</label>
              <input type="text" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">NTN / Tax ID</label>
              <input type="text" value={form.ntn} onChange={(e) => set('ntn', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle types / fleet</label>
              <input type="text" value={form.vehicle_types} onChange={(e) => set('vehicle_types', e.target.value)}
                placeholder="e.g. Mazda, 22-wheeler, Shehzore"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Opening balance (Rs)</label>
              <input type="number" step="0.01" value={form.opening_balance} onChange={(e) => set('opening_balance', e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums" />
              <p className="text-[11px] text-gray-400 mt-0.5">Amount already owed to this transporter at start (ledger opening line).</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
            <textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div className="flex items-center gap-2">
            <input id="hauler-active" type="checkbox" checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <label htmlFor="hauler-active" className="text-sm text-gray-700">Active (shown in the transport picker)</label>
          </div>
        </div>
      </SlideDrawer>

      <HaulerLedgerDrawer id={historyId} open={!!historyId} onClose={() => setHistoryId(null)} />
      <ReconcileDrawer open={reconcileOpen} onClose={() => setReconcileOpen(false)} addToast={addToast} />
    </>
  );
}
