import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Sparkles, Search, Mail, AlertTriangle, Copy, Database, Loader2, MessageSquare } from 'lucide-react';
import api from '../../../api/client';
import { useCustomers, useSuppliers } from '../../../api/queries';
import SearchSelect from '../../../shared/components/SearchSelect';

const PKR = (v) => 'Rs ' + (Number(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SEV = { high: 'bg-red-100 text-red-700 border-red-200', medium: 'bg-amber-100 text-amber-700 border-amber-200', low: 'bg-slate-100 text-slate-600 border-slate-200' };

const TABS = [
  { key: 'ask', label: 'Ask', icon: Search },
  { key: 'draft', label: 'Draft Email', icon: Mail },
  { key: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
];

export default function AiAssistant() {
  const [tab, setTab] = useState('ask');
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: async () => (await api.get('/api/ai/status'))?.data });
  const enabled = status?.enabled;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center"><Sparkles className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">AI Assistant</h1>
            <p className="text-xs text-gray-500">Ask questions, draft emails, and spot anomalies across your data.</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-lg ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {enabled ? `AI on · ${status.model}` : 'AI off'}
        </span>
      </div>

      {status && !enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI features are off. Add <code className="px-1 bg-amber-100 rounded">OPENAI_API_KEY</code> to the server environment and restart the backend to enable them.
        </div>
      )}

      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'ask' && <AskTab enabled={enabled} />}
      {tab === 'draft' && <DraftTab enabled={enabled} />}
      {tab === 'anomalies' && <AnomaliesTab enabled={enabled} />}
    </div>
  );
}

const copy = (t) => navigator.clipboard?.writeText(t);

function AskTab({ enabled }) {
  const [q, setQ] = useState('');
  const [showSql, setShowSql] = useState(false);
  const mut = useMutation({ mutationFn: (question) => api.post('/api/ai/query', { question }) });
  const res = mut.data?.data;
  const examples = [
    'Total local sales this month',
    'Top 5 suppliers by amount owed',
    'Which lots have the lowest yield?',
    'Salaries paid in the last 30 days',
  ];

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} placeholder="Ask anything about your business data…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => <button key={ex} onClick={() => setQ(ex)} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">{ex}</button>)}
        </div>
        <div className="flex justify-end">
          <button onClick={() => q.trim() && mut.mutate(q.trim())} disabled={!enabled || mut.isPending || !q.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Ask
          </button>
        </div>
      </div>

      {mut.isError && <Err msg={mut.error?.message} />}
      {res?.aiEnabled === false && <Err msg={res.message} />}
      {res?.rows && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {res.explanation && <p className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{res.explanation}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 text-gray-500">{res.columns.map((c) => <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {res.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {res.columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap tabular-nums">{fmtCell(row[c])}</td>)}
                  </tr>
                ))}
                {res.rows.length === 0 && <tr><td colSpan={res.columns.length || 1} className="px-3 py-6 text-center text-gray-400">No rows.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
            <span>{res.rowCount} row{res.rowCount === 1 ? '' : 's'}</span>
            <button onClick={() => setShowSql((s) => !s)} className="inline-flex items-center gap-1 hover:text-gray-700"><Database className="w-3 h-3" /> {showSql ? 'Hide' : 'Show'} SQL</button>
          </div>
          {showSql && <pre className="px-4 py-2 bg-gray-50 text-[11px] text-gray-600 overflow-x-auto border-t border-gray-100">{res.sql}</pre>}
        </div>
      )}
    </div>
  );
}

function DraftTab({ enabled }) {
  const [partyType, setPartyType] = useState('customer');
  const [partyId, setPartyId] = useState('');
  const [kind, setKind] = useState('statement');
  const [instructions, setInstructions] = useState('');
  const { data: customers = [] } = useCustomers();
  const { data: suppliers = [] } = useSuppliers();
  const list = partyType === 'customer' ? customers : suppliers;
  const options = (list || []).map((p) => ({ value: p.id, label: p.name, sub: p.email || '' }));
  const mut = useMutation({ mutationFn: (body) => api.post('/api/ai/draft', body) });
  const res = mut.data?.data;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Party</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {['customer', 'supplier'].map((t) => (
                <button key={t} onClick={() => { setPartyType(t); setPartyId(''); }} className={`px-3 py-2 rounded-lg border text-sm capitalize ${partyType === t ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>{t}</button>
              ))}
            </div>
            <SearchSelect value={partyId} onChange={setPartyId} options={options} placeholder={`Select ${partyType}…`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-gray-900">
              <option value="statement">Statement summary</option>
              <option value="reminder">Payment reminder</option>
              <option value="thankyou">Thank-you note</option>
            </select>
            <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Extra instructions (optional)</label>
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. mention the cheque due next week" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={() => partyId && mut.mutate({ party_type: partyType, party_id: partyId, kind, instructions })} disabled={!enabled || mut.isPending || !partyId}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Draft Email
          </button>
        </div>
      </div>

      {mut.isError && <Err msg={mut.error?.message} />}
      {res?.aiEnabled === false && <Err msg={res.message} />}
      {res?.subject && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm"><span className="text-gray-400">To:</span> {res.party}{res.to ? ` <${res.to}>` : ' (no email on file)'}</div>
            <button onClick={() => copy(`Subject: ${res.subject}\n\n${res.body}`)} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"><Copy className="w-3.5 h-3.5" /> Copy all</button>
          </div>
          <div className="flex items-center gap-2">
            <input readOnly value={res.subject} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium bg-gray-50" />
            <button onClick={() => copy(res.subject)} className="p-2 text-gray-400 hover:text-gray-700"><Copy className="w-4 h-4" /></button>
          </div>
          <textarea readOnly value={res.body} rows={12} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 whitespace-pre-wrap" />
        </div>
      )}
    </div>
  );
}

function AnomaliesTab({ enabled }) {
  const [showSignals, setShowSignals] = useState(false);
  const mut = useMutation({ mutationFn: () => api.get('/api/ai/anomalies') });
  const res = mut.data?.data;
  const anomalies = res?.anomalies || [];

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">Scan payroll, GL, stock, cash, and overdue balances for anything unusual.</p>
        <button onClick={() => mut.mutate()} disabled={!enabled || mut.isPending} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Scan now
        </button>
      </div>

      {mut.isError && <Err msg={mut.error?.message} />}
      {res?.aiEnabled === false && <Err msg={res.message} />}
      {res?.aiEnabled && anomalies.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-700">No anomalies found — everything looks consistent.</div>
      )}
      {anomalies.map((a, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${SEV[a.severity] || SEV.low}`}>{a.severity}</span>
            <span className="text-[11px] text-gray-400 uppercase">{a.area}</span>
            <span className="text-sm font-semibold text-gray-900">{a.title}</span>
          </div>
          <p className="text-sm text-gray-600">{a.detail}</p>
          {a.recommendation && <p className="text-xs text-blue-700 mt-1.5">→ {a.recommendation}</p>}
        </div>
      ))}
      {res?.signals && (
        <div className="text-center">
          <button onClick={() => setShowSignals((s) => !s)} className="text-[11px] text-gray-400 hover:text-gray-600">{showSignals ? 'Hide' : 'Show'} raw signals</button>
          {showSignals && <pre className="text-left mt-2 px-4 py-3 bg-gray-50 rounded-xl text-[10px] text-gray-500 overflow-x-auto">{JSON.stringify(res.signals, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

function Err({ msg }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{msg || 'Something went wrong.'}</div>;
}

function fmtCell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}
