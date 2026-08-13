// Suspense Account (#8) — record unidentified/unallocated money into the 1290
// Suspense control account, then resolve (reclassify) each entry to the true
// account(s). Original entry + journals are never deleted; reverse flips them.
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, Plus, CheckCircle, Search } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import SearchSelect from '../../../components/SearchSelect';
import { financeApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { favStar } from '../../../shared/utils/favorites';

const PKR = (v) => 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString();
const STATUS_META = {
  'Open': 'bg-blue-50 text-blue-700 border-blue-200',
  'Under Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Partially Resolved': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Resolved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Reversed': 'bg-gray-100 text-gray-500 border-gray-200',
};
const STATUS_TABS = ['All', 'Open', 'Under Review', 'Partially Resolved', 'Resolved', 'Reversed'];

function Kpi({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${tone || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
const TARGET_TYPES = [
  { v: 'customer', l: 'Customer' }, { v: 'supplier', l: 'Supplier' },
  { v: 'export_order', l: 'Export Order' }, { v: 'local_sale', l: 'Local Sale' },
  { v: 'inventory_lot', l: 'Purchase Lot' }, { v: 'service_milling_invoice', l: 'Service Invoice' },
  { v: 'mill_worker', l: 'Employee' }, { v: 'expense', l: 'Expense' },
  { v: 'income', l: 'Income' }, { v: 'other', l: 'Other Ledger' },
];

export default function Suspense() {
  const { addToast, bankAccountsList = [] } = useApp();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState('All');
  const [search, setSearch] = useState('');
  const [showRecord, setShowRecord] = useState(false);
  const [resolveFor, setResolveFor] = useState(null);

  const { data: summary } = useQuery({ queryKey: ['suspense', 'summary'], queryFn: async () => (await financeApi.suspenseSummary())?.data || {} });
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['suspense', 'list', statusTab],
    queryFn: async () => (await financeApi.suspenseList(statusTab === 'All' ? {} : { status: statusTab }))?.data || [],
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['suspense'] }); };

  const reviewMut = useMutation({
    mutationFn: (id) => financeApi.suspenseReview(id),
    onSuccess: () => { addToast('Marked Under Review', 'info'); invalidate(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed', 'error'),
  });
  const reverseMut = useMutation({
    mutationFn: (id) => financeApi.suspenseReverse(id, { reason: 'Reversed from Suspense screen' }),
    onSuccess: () => { addToast('Entry reversed', 'success'); invalidate(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed', 'error'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => [e.entry_no, e.party_details, e.reason, e.reference_no, e.bank_account_name].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><HelpCircle size={20} /> Suspense Account</h1>
          <p className="text-xs text-gray-400 mt-0.5">Unidentified / unallocated money held in the 1290 Suspense account until Finance resolves it to the correct account.</p>
        </div>
        <button onClick={() => setShowRecord(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Record Suspense Entry
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Open / In-progress" value={summary?.openCount ?? 0} tone="text-amber-600" />
        <Kpi label="Unidentified Receipts" value={PKR(summary?.receiptOutstanding)} tone="text-emerald-700" />
        <Kpi label="Unidentified Payments" value={PKR(summary?.paymentOutstanding)} tone="text-red-600" />
        <Kpi label="Net Suspense Balance" value={PKR(summary?.netOutstanding)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-gray-100 rounded-lg p-0.5 flex-wrap">
          {STATUS_TABS.map((t) => (
            <button key={t} onClick={() => setStatusTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entry, payer, reason…"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Entry</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Payer / Payee</th>
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No suspense entries.</td></tr>
                : filtered.map((e) => {
                  const outstanding = parseFloat(e.outstanding ?? (e.amount - e.resolved_amount)) || 0;
                  const canResolve = !['Resolved', 'Reversed'].includes(e.status) && outstanding > 0.01;
                  const canReverse = e.status !== 'Reversed';
                  return (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td data-label="Entry" className="px-3 py-2 font-mono text-blue-600">{e.entry_no}</td>
                      <td data-label="Date" className="mob-hide px-3 py-2 text-gray-600">{String(e.date).slice(0, 10)}</td>
                      <td data-label="Type" className="mob-hide px-3 py-2">{e.direction === 'receipt' ? <span className="text-emerald-700">Receipt</span> : <span className="text-red-600">Payment</span>}</td>
                      <td data-label="Payer / Payee" className="px-3 py-2 text-gray-700 max-w-[12rem] truncate" title={e.party_details || ''}>{e.party_details || '—'}</td>
                      <td data-label="Account" className="mob-hide px-3 py-2 text-gray-500 text-xs">{e.bank_account_name || '—'}</td>
                      <td data-label="Amount" className="px-3 py-2 text-right tabular-nums">{PKR(e.amount)}</td>
                      <td data-label="Outstanding" className="mob-hide px-3 py-2 text-right tabular-nums font-medium">{outstanding > 0.01 ? PKR(outstanding) : '—'}</td>
                      <td data-label="Status" className="px-3 py-2 text-center"><span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_META[e.status] || ''}`}>{e.status}</span></td>
                      <td data-label="Actions" className="px-3 py-2 text-right whitespace-nowrap">
                        {canResolve && <button onClick={() => setResolveFor(e)} className="text-xs font-medium text-emerald-700 hover:underline mr-2">Resolve</button>}
                        {e.status === 'Open' && <button onClick={() => reviewMut.mutate(e.id)} className="text-xs text-amber-600 hover:underline mr-2">Review</button>}
                        {canReverse && <button onClick={() => { if (window.confirm(`Reverse ${e.entry_no}? This unwinds the money movement and all reclassifications.`)) reverseMut.mutate(e.id); }} className="text-xs text-red-600 hover:underline">Reverse</button>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {showRecord && <RecordDrawer bankAccounts={bankAccountsList} onClose={() => setShowRecord(false)} onDone={() => { setShowRecord(false); invalidate(); }} addToast={addToast} />}
      {resolveFor && <ResolveDrawer entry={resolveFor} onClose={() => setResolveFor(null)} onDone={() => { setResolveFor(null); invalidate(); }} addToast={addToast} />}
    </div>
  );
}

function RecordDrawer({ bankAccounts, onClose, onDone, addToast }) {
  const [form, setForm] = useState({ direction: 'receipt', amount: '', bank_account_id: '', payment_method: 'bank_transfer', reference_no: '', party_details: '', reason: '', date: new Date().toISOString().slice(0, 10) });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const mut = useMutation({
    mutationFn: () => financeApi.suspenseCreate({ ...form, amount: parseFloat(form.amount) }),
    onSuccess: () => { addToast('Suspense entry recorded', 'success'); onDone(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed to record', 'error'),
  });
  const valid = parseFloat(form.amount) > 0 && form.bank_account_id;

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Record</button>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title="Record Suspense Entry" subtitle="Unidentified money — resolve later" icon={HelpCircle} footer={footer} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[{ v: 'receipt', l: 'Receipt (money in)' }, { v: 'payment', l: 'Payment (money out)' }].map((o) => (
              <button key={o.v} onClick={() => set('direction', o.v)} className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md ${form.direction === o.v ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>{o.l}</button>
            ))}
          </div>
        </div>
        <Field label="Amount (PKR)"><input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="form-input" min="0" step="0.01" /></Field>
        <Field label="Bank / Cash Account">
          <select value={form.bank_account_id} onChange={(e) => set('bank_account_id', e.target.value)} className="form-input">
            <option value="">Select account…</option>
            {(bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{favStar(a)}{a.name} ({a.currency})</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">The account the money physically sits in. {form.direction === 'receipt' ? 'Balance increases now.' : 'Balance decreases now.'}</p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="form-input" /></Field>
          <Field label="Method">
            <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)} className="form-input">
              <option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="online">Online</option>
            </select>
          </Field>
        </div>
        <Field label="Reference No"><input value={form.reference_no} onChange={(e) => set('reference_no', e.target.value)} className="form-input" placeholder="Bank ref / cheque no" /></Field>
        <Field label="Payer / Payee details"><input value={form.party_details} onChange={(e) => set('party_details', e.target.value)} className="form-input" placeholder="Whatever is known" /></Field>
        <Field label="Reason"><textarea value={form.reason} onChange={(e) => set('reason', e.target.value)} rows={2} className="form-input resize-none" placeholder="Why it can't be allocated yet" /></Field>
      </div>
    </SlideDrawer>
  );
}

function ResolveDrawer({ entry, onClose, onDone, addToast }) {
  const { data: accounts = [] } = useQuery({ queryKey: ['coa'], queryFn: async () => { const r = await financeApi.chartOfAccounts(); return r?.data?.accounts || r?.accounts || r?.data || []; } });
  const { data: full } = useQuery({ queryKey: ['suspense', 'get', entry.id], queryFn: async () => (await financeApi.suspenseGet(entry.id))?.data || entry });
  const outstanding = parseFloat((full || entry).outstanding ?? ((full || entry).amount - (full || entry).resolved_amount)) || 0;
  const [alloc, setAlloc] = useState({ amount: '', account_id: '', target_type: 'income', target_ref: '', narration: '' });
  const set = (k, v) => setAlloc((a) => ({ ...a, [k]: v }));

  const mut = useMutation({
    mutationFn: () => financeApi.suspenseResolve(entry.id, { allocations: [{ ...alloc, amount: parseFloat(alloc.amount) }] }),
    onSuccess: () => { addToast('Suspense resolved', 'success'); onDone(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed to resolve', 'error'),
  });
  const amt = parseFloat(alloc.amount) || 0;
  const valid = amt > 0 && amt - outstanding <= 0.01 && alloc.account_id;
  const accountOpts = (accounts || []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, sub: a.type }));

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Post Reclassification</button>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title={`Resolve ${entry.entry_no}`} subtitle={`${entry.direction === 'receipt' ? 'Receipt' : 'Payment'} · Outstanding ${PKR(outstanding)}`} icon={CheckCircle} footer={footer} size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-medium">{PKR(entry.amount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Already resolved</span><span className="font-medium">{PKR(entry.resolved_amount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold text-emerald-700">{PKR(outstanding)}</span></div>
          {entry.party_details && <div className="text-xs text-gray-400 mt-1">Payer/Payee: {entry.party_details}</div>}
        </div>

        {full?.resolutions?.length > 0 && (
          <div className="text-xs text-gray-500">
            <p className="font-medium mb-1">Prior reclassifications</p>
            {full.resolutions.map((r) => (
              <div key={r.id} className="flex justify-between py-0.5"><span>{r.account_code} {r.account_name}{r.target_ref ? ` · ${r.target_ref}` : ''}</span><span className="tabular-nums">{PKR(r.amount)}</span></div>
            ))}
          </div>
        )}

        <p className="text-sm font-medium text-gray-800">Reclassify to</p>
        <Field label="Amount (PKR)"><input type="number" value={alloc.amount} onChange={(e) => set('amount', e.target.value)} className="form-input" min="0" max={outstanding} step="0.01" placeholder={String(Math.round(outstanding))} /></Field>
        <Field label="Target Account (GL)"><SearchSelect value={alloc.account_id} onChange={(v) => set('account_id', v)} options={accountOpts} placeholder="Search chart of accounts…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Linked to">
            <select value={alloc.target_type} onChange={(e) => set('target_type', e.target.value)} className="form-input">
              {TARGET_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Field>
          <Field label="Reference"><input value={alloc.target_ref} onChange={(e) => set('target_ref', e.target.value)} className="form-input" placeholder="e.g. EXP-2026-003" /></Field>
        </div>
        <Field label="Narration"><input value={alloc.narration} onChange={(e) => set('narration', e.target.value)} className="form-input" placeholder="Optional note" /></Field>
        {amt > outstanding + 0.01 && <p className="text-xs text-red-600">Amount exceeds outstanding {PKR(outstanding)}.</p>}
        <p className="text-[11px] text-gray-400">Posts a balancing journal ({entry.direction === 'receipt' ? 'DR Suspense / CR target' : 'DR target / CR Suspense'}). The original entry is kept for audit.</p>
      </div>
    </SlideDrawer>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
