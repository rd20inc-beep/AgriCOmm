import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Check, X, CheckCircle2, RefreshCw } from 'lucide-react';
import { purchaseRequirementsApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';

const STATUS_TONE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  purchased: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
};
const TABS = ['pending', 'approved', 'purchased', 'all'];

// Shared Purchase Requirements list + actions. Used both as the standalone page
// and embedded as a section on the Finance Dashboard (embedded). The API redacts
// customer/order/stock context for the Finance Manager (masked); this component
// just renders whatever it's given.
export default function PurchaseRequirementsPanel({ embedded = false, defaultTab = 'pending' }) {
  const { addToast } = useApp();
  const { user } = useAuth();
  const role = user?.role;
  const canApprove = ['Super Admin', 'Owner', 'Mill Manager'].includes(role);
  const canPurchase = ['Super Admin', 'Owner', 'Mill Manager', 'Finance Manager'].includes(role);

  const [tab, setTab] = useState(defaultTab);
  const [rows, setRows] = useState([]);
  const [masked, setMasked] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await purchaseRequirementsApi.list({ status: tab });
      const d = res?.data || res;
      setRows(d?.requirements || []);
      setMasked(!!d?.masked);
    } catch (e) { addToast?.(e?.response?.data?.message || 'Failed to load', 'error'); }
    finally { setLoading(false); }
  }, [tab, addToast]);
  useEffect(() => { load(); }, [load]);

  async function act(fn, id, ok) {
    try { await fn(id); addToast?.(ok); await load(); }
    catch (e) { addToast?.(e?.response?.data?.message || e.message || 'Action failed', 'error'); }
  }

  const money = (v, c) => (v != null ? `${c || 'PKR'} ${Math.round(parseFloat(v)).toLocaleString()}` : '—');
  const subtitle = masked ? 'Approved material purchase requests awaiting payment.' : 'Material shortages requiring purchase — approve to send to Finance.';

  const header = embedded ? (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2"><ShoppingCart size={15} /> Purchase Requests</h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <button onClick={load} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"><RefreshCw size={13} /> Refresh</button>
    </div>
  ) : (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ShoppingCart size={20} /> Purchase Requirements</h1>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
      <button onClick={load} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"><RefreshCw size={14} /> Refresh</button>
    </div>
  );

  const table = (
    <div className={embedded ? 'overflow-x-auto border border-gray-100 rounded-lg' : 'bg-white rounded-xl border border-gray-200 overflow-x-auto'}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
            <th className="text-left px-4 py-2.5">PR #</th>
            <th className="text-left px-4 py-2.5">Item</th>
            <th className="text-right px-4 py-2.5">Shortage</th>
            <th className="text-right px-4 py-2.5">Est. Amount</th>
            {!masked && <th className="text-left px-4 py-2.5">Department</th>}
            {!masked && <th className="text-left px-4 py-2.5">Ref</th>}
            <th className="text-center px-4 py-2.5">Status</th>
            <th className="text-right px-4 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No purchase requirements.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 font-medium text-gray-800">{r.pr_no}</td>
              <td className="px-4 py-2.5 text-gray-700">{r.item_name}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{Math.round(parseFloat(r.shortage_qty) || 0).toLocaleString()} {r.unit}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(r.est_amount, r.currency)}</td>
              {!masked && <td className="px-4 py-2.5 text-gray-500">{r.department}</td>}
              {!masked && <td className="px-4 py-2.5 text-gray-500">{r.linked_ref || '—'}</td>}
              <td className="px-4 py-2.5 text-center"><span className={`px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${STATUS_TONE[r.status] || 'bg-gray-100 text-gray-500'}`}>{r.status}</span></td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  {r.status === 'pending' && canApprove && (
                    <>
                      <button onClick={() => act(purchaseRequirementsApi.approve, r.id, 'Approved — sent to Finance')} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700"><Check size={13} /> Approve</button>
                      <button onClick={() => act((id) => purchaseRequirementsApi.reject(id, {}), r.id, 'Rejected')} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-600 bg-rose-50 rounded hover:bg-rose-100"><X size={13} /> Reject</button>
                    </>
                  )}
                  {r.status === 'approved' && canPurchase && (
                    <button onClick={() => act(purchaseRequirementsApi.markPurchased, r.id, 'Marked purchased')} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100"><CheckCircle2 size={13} /> Mark Purchased</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Tabs: full (non-masked) users pick a status; the masked Finance view is
  // always the approved-awaiting-payment list, so it needs no tabs.
  const tabsRow = !masked && (
    <div className="flex gap-2">
      {TABS.map((t) => (
        <button key={t} onClick={() => setTab(t)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{t}</button>
      ))}
    </div>
  );

  if (embedded) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {header}
        {tabsRow && <div className="mb-3">{tabsRow}</div>}
        {table}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {tabsRow}
      {table}
    </div>
  );
}
