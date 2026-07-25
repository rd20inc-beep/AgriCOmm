// Sample Analysis & Purchase Shortlisting (#7). Record supplier rice samples, run
// initial + final quality analysis, shortlist/reject/hold, compare side-by-side,
// and convert an approved sample into a purchase lot (carrying quality forward).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Search, GitCompare, Trash2, ArrowRight, X } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import Modal from '../../../components/Modal';
import SupplierPicker from '../../../components/SupplierPicker';
import RiceTypePicker from '../../../components/RiceTypePicker';
import { useSuppliers, useProducts } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { sampleApi } from '../api/services';
import { documentsApi } from '../../documents/api/services';

const ANALYSIS_FIELDS = [
  { k: 'moisture', l: 'Moisture %' }, { k: 'broken', l: 'Broken %' }, { k: 'foreign_matter', l: 'Foreign Matter %' },
  { k: 'chalky', l: 'Chalky %' }, { k: 'purity', l: 'Purity %' },
  { k: 'b1', l: 'B-1 %' }, { k: 'b2', l: 'B-2 %' }, { k: 'b3', l: 'B-3 %' }, { k: 'csr', l: 'C.S / CSR %' },
  { k: 'short_grain', l: 'Short Grain %' }, { k: 'cobba', l: 'Choba / Cobba %' }, { k: 'nb', l: 'N.B %' }, { k: 'ov', l: 'O.V %' },
  { k: 'sw', l: 'S.W %' }, { k: 'powder', l: 'Powder %' }, { k: 'sortex', l: 'Sortex %' }, { k: 'stone', l: 'Stone %' },
  { k: 'processing_loss', l: 'Processing Loss %' },
];
const SHORTLIST = ['Under Review', 'Shortlisted', 'Rejected', 'Hold', 'Reanalysis Required', 'Approved for Purchase'];
const STATUS_TABS = ['All', ...SHORTLIST, 'Converted'];
const STATUS_CLS = {
  'Under Review': 'bg-blue-50 text-blue-700 border-blue-200',
  'Shortlisted': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Rejected': 'bg-red-50 text-red-700 border-red-200',
  'Hold': 'bg-amber-50 text-amber-700 border-amber-200',
  'Reanalysis Required': 'bg-orange-50 text-orange-700 border-orange-200',
  'Approved for Purchase': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Converted': 'bg-gray-100 text-gray-500 border-gray-200',
};
const kg = (v) => (v == null ? '—' : `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`);
const rs = (v) => (v == null ? '—' : `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export default function SampleAnalysis() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('All');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null); // { mode:'create'|'analyze'|'convert', sample }
  const [selected, setSelected] = useState(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  const { data: samples = [], isLoading } = useQuery({
    queryKey: ['samples', tab],
    queryFn: async () => (await sampleApi.list(tab === 'All' ? {} : { status: tab }))?.data || [],
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['samples'] });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => sampleApi.setStatus(id, { status }),
    onSuccess: () => { addToast('Sample status updated', 'success'); invalidate(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed', 'error'),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => sampleApi.remove(id),
    onSuccess: () => { addToast('Sample deleted', 'info'); invalidate(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed', 'error'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return samples;
    return samples.filter((s) => [s.sample_no, s.supplier_name, s.variety, s.claimed_grade, s.origin_area].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [samples, search]);

  const summary = useMemo(() => {
    const s = { total: samples.length, review: 0, shortlisted: 0, approved: 0 };
    for (const x of samples) {
      if (x.status === 'Under Review') s.review++;
      if (x.status === 'Shortlisted') s.shortlisted++;
      if (x.status === 'Approved for Purchase') s.approved++;
    }
    return s;
  }, [samples]);

  const toggleSel = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><FlaskConical size={20} /> Sample Analysis</h1>
          <p className="text-xs text-gray-400 mt-0.5">Record supplier rice samples, analyze quality, shortlist, and convert approved samples into purchase lots.</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size >= 2 && (
            <button onClick={() => setCompareOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
              <GitCompare size={16} /> Compare ({selected.size})
            </button>
          )}
          <button onClick={() => setDrawer({ mode: 'create' })} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> New Sample
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total Samples" value={summary.total} />
        <Kpi label="Under Review" value={summary.review} tone="text-blue-700" />
        <Kpi label="Shortlisted" value={summary.shortlisted} tone="text-indigo-700" />
        <Kpi label="Approved for Purchase" value={summary.approved} tone="text-emerald-700" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-gray-100 rounded-lg p-0.5 flex-wrap">
          {STATUS_TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sample, supplier, variety…" className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-2 py-2"></th>
                <th className="px-3 py-2 text-left font-medium">Sample</th>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-left font-medium">Variety / Grade</th>
                <th className="px-3 py-2 text-right font-medium">Offered</th>
                <th className="px-3 py-2 text-right font-medium">Exp. Finished</th>
                <th className="px-3 py-2 text-right font-medium">Exp. Cost/kg</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No samples yet.</td></tr>
                : filtered.map((s) => {
                  const m = s.metrics || {};
                  const canConvert = ['Shortlisted', 'Approved for Purchase'].includes(s.status);
                  const editable = s.status !== 'Converted';
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td data-label="" className="mob-hide px-2 py-2 text-center"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSel(s.id)} /></td>
                      <td data-label="Sample" className="px-3 py-2"><button onClick={() => setDrawer({ mode: 'analyze', sample: s })} className="font-mono text-blue-600 hover:underline">{s.sample_no}</button><div className="text-[11px] text-gray-400">{String(s.sample_date).slice(0, 10)}</div></td>
                      <td data-label="Supplier" className="mob-hide px-3 py-2 text-gray-700 max-w-[10rem] truncate" title={s.supplier_name || ''}>{s.supplier_name || '—'}</td>
                      <td data-label="Variety / Grade" className="px-3 py-2 text-gray-700">{s.variety || s.product_name || '—'}{s.claimed_grade ? <span className="text-gray-400"> ({s.claimed_grade})</span> : ''}</td>
                      <td data-label="Offered" className="px-3 py-2 text-right tabular-nums">{kg(s.offered_qty_kg)}<div className="text-[11px] text-gray-400">{rs(s.offered_rate_per_kg)}/kg</div></td>
                      <td data-label="Exp. Finished" className="mob-hide px-3 py-2 text-right tabular-nums">{kg(m.expectedFinishedKg)}<div className="text-[11px] text-gray-400">{m.expectedFinishedPct ?? '—'}%</div></td>
                      <td data-label="Exp. Cost/kg" className="mob-hide px-3 py-2 text-right tabular-nums font-medium">{rs(m.expectedCostPerFinishedKg)}</td>
                      <td data-label="Status" className="px-3 py-2 text-center">
                        {editable ? (
                          <select value={s.status} onChange={(e) => statusMut.mutate({ id: s.id, status: e.target.value })} className={`text-[11px] font-medium border rounded-full px-2 py-0.5 cursor-pointer ${STATUS_CLS[s.status] || ''}`}>
                            {SHORTLIST.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                        ) : <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_CLS[s.status]}`}>{s.status}</span>}
                      </td>
                      <td data-label="Actions" className="px-3 py-2 text-right whitespace-nowrap">
                        {editable && <button onClick={() => setDrawer({ mode: 'analyze', sample: s })} className="text-xs text-blue-600 hover:underline mr-2">Analyze</button>}
                        {canConvert && <button onClick={() => setDrawer({ mode: 'convert', sample: s })} className="text-xs font-medium text-emerald-700 hover:underline mr-2 inline-flex items-center gap-0.5">Convert <ArrowRight size={11} /></button>}
                        {s.converted_lot_no && <Link to={`/lot-inventory/${s.converted_lot_id}`} className="text-xs text-gray-500 hover:underline mr-2">{s.converted_lot_no}</Link>}
                        {editable && <button onClick={() => { if (window.confirm(`Delete ${s.sample_no}?`)) deleteMut.mutate(s.id); }} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {drawer?.mode === 'create' && <SampleDrawer onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); invalidate(); }} addToast={addToast} />}
      {drawer?.mode === 'analyze' && <AnalysisDrawer sampleId={drawer.sample.id} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); invalidate(); }} addToast={addToast} />}
      {drawer?.mode === 'convert' && <ConvertDrawer sample={drawer.sample} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); invalidate(); }} addToast={addToast} />}
      {compareOpen && <CompareModal ids={[...selected]} onClose={() => setCompareOpen(false)} />}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${tone || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>{children}</div>;
}
function QualityGrid({ values, onChange }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {ANALYSIS_FIELDS.map((f) => (
        <div key={f.k}>
          <label className="block text-[11px] text-gray-500 mb-0.5">{f.l}</label>
          <input type="number" step="0.01" value={values[f.k] ?? ''} onChange={(e) => onChange(f.k, e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      ))}
    </div>
  );
}

function SampleDrawer({ onClose, onDone, addToast }) {
  const { data: suppliers = [] } = useSuppliers();
  const { data: products = [] } = useProducts();
  const [form, setForm] = useState({ supplier_id: '', product_id: '', variety: '', claimed_grade: '', origin_area: '', crop_year: '', offered_qty_kg: '', offered_rate_per_kg: '', bags: '', bag_weight_kg: 50, supplier_sample_ref: '', remarks: '', sample_date: new Date().toISOString().slice(0, 10) });
  const [analysis, setAnalysis] = useState({});
  const [file, setFile] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const res = await sampleApi.create({ ...form, analysis_json: analysis });
      const created = res?.data;
      if (file && created?.id) {
        try {
          const fd = new FormData();
          fd.append('file', file); fd.append('linked_type', 'sample'); fd.append('linked_id', created.id);
          fd.append('doc_type', 'sample_image'); fd.append('title', `Sample ${created.sample_no}`);
          await documentsApi.upload(fd);
        } catch { addToast('Sample saved, but the image upload failed.', 'warning'); }
      }
      return created;
    },
    onSuccess: () => { addToast('Sample recorded', 'success'); onDone(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed to record sample', 'error'),
  });
  const valid = form.supplier_id && (form.variety || form.product_id);

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Save Sample</button>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title="New Sample" subtitle="Stage 1 — sample received + initial analysis" icon={FlaskConical} footer={footer} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier"><SupplierPicker value={form.supplier_id} onChange={(v) => set('supplier_id', v)} suppliers={suppliers} addToast={addToast} /></Field>
          <Field label="Rice Type"><RiceTypePicker value={form.product_id} onChange={(v) => set('product_id', v)} products={products} addToast={addToast} /></Field>
          <Field label="Variety"><input value={form.variety} onChange={(e) => set('variety', e.target.value)} className="form-input" placeholder="e.g. 1121 Basmati" /></Field>
          <Field label="Claimed Grade"><input value={form.claimed_grade} onChange={(e) => set('claimed_grade', e.target.value)} className="form-input" /></Field>
          <Field label="Origin / Area"><input value={form.origin_area} onChange={(e) => set('origin_area', e.target.value)} className="form-input" /></Field>
          <Field label="Crop Year"><input value={form.crop_year} onChange={(e) => set('crop_year', e.target.value)} className="form-input" placeholder="2026" /></Field>
          <Field label="Offered Qty (kg)"><input type="number" value={form.offered_qty_kg} onChange={(e) => set('offered_qty_kg', e.target.value)} className="form-input" /></Field>
          <Field label="Offered Rate (Rs/kg)"><input type="number" value={form.offered_rate_per_kg} onChange={(e) => set('offered_rate_per_kg', e.target.value)} className="form-input" /></Field>
          <Field label="Bags"><input type="number" value={form.bags} onChange={(e) => set('bags', e.target.value)} className="form-input" /></Field>
          <Field label="Bag Weight (kg)"><input type="number" value={form.bag_weight_kg} onChange={(e) => set('bag_weight_kg', e.target.value)} className="form-input" /></Field>
          <Field label="Supplier Sample Ref"><input value={form.supplier_sample_ref} onChange={(e) => set('supplier_sample_ref', e.target.value)} className="form-input" /></Field>
          <Field label="Sample Date"><input type="date" value={form.sample_date} onChange={(e) => set('sample_date', e.target.value)} className="form-input" /></Field>
        </div>
        <Field label="Remarks"><textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={2} className="form-input resize-none" /></Field>
        <Field label="Sample Image / Attachment"><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
        <div>
          <p className="text-sm font-semibold text-gray-800 mb-2">Initial Sample Analysis</p>
          <QualityGrid values={analysis} onChange={(k, v) => setAnalysis((a) => ({ ...a, [k]: v }))} />
        </div>
      </div>
    </SlideDrawer>
  );
}

function AnalysisDrawer({ sampleId, onClose, onDone, addToast }) {
  const { data: sample } = useQuery({ queryKey: ['samples', 'get', sampleId], queryFn: async () => (await sampleApi.get(sampleId))?.data });
  const [which, setWhich] = useState('initial');
  const [vals, setVals] = useState(null);
  const current = which === 'final' ? (sample?.final_analysis_json || {}) : (sample?.analysis_json || {});
  const editing = vals ?? current;

  const mut = useMutation({
    mutationFn: () => sampleApi.updateAnalysis(sampleId, { which, analysis: editing }),
    onSuccess: () => { addToast(`${which === 'final' ? 'Final' : 'Initial'} analysis saved`, 'success'); onDone(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed', 'error'),
  });
  const setV = (k, v) => setVals({ ...(vals ?? current), [k]: v });

  const initial = sample?.analysis_json || {};
  const final = sample?.final_analysis_json || {};
  const hasBoth = Object.keys(initial).length && Object.keys(final).length;

  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
      <button disabled={mut.isPending} onClick={() => mut.mutate()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Save {which === 'final' ? 'Final' : 'Initial'} Analysis</button>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title={sample ? `Analysis — ${sample.sample_no}` : 'Analysis'} subtitle="Stage 2 / 4 — initial and final analysis" icon={FlaskConical} footer={footer} size="xl">
      {!sample ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex bg-gray-100 rounded-lg p-0.5 w-max">
            {[{ v: 'initial', l: 'Initial Analysis' }, { v: 'final', l: 'Final / Pre-Purchase' }].map((o) => (
              <button key={o.v} onClick={() => { setWhich(o.v); setVals(null); }} className={`px-3 py-1.5 text-sm font-medium rounded-md ${which === o.v ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>{o.l}</button>
            ))}
          </div>
          <QualityGrid values={editing} onChange={setV} />

          {hasBoth && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-gray-800 mb-2">Initial vs Final differences</p>
              <div className="overflow-x-auto mobile-cards">
                <table className="w-full text-xs">
                  <thead className="text-gray-400"><tr><th className="text-left py-1">Field</th><th className="text-right">Initial</th><th className="text-right">Final</th><th className="text-right">Δ</th></tr></thead>
                  <tbody>
                    {ANALYSIS_FIELDS.filter((f) => initial[f.k] != null || final[f.k] != null).map((f) => {
                      const i = parseFloat(initial[f.k]); const fi = parseFloat(final[f.k]);
                      const d = (Number.isFinite(fi) ? fi : 0) - (Number.isFinite(i) ? i : 0);
                      return <tr key={f.k} className="border-t border-gray-100"><td data-label="Δ" data-label="Final" data-label="Initial" data-label="Field" className="py-1 text-gray-600">{f.l}</td><td className="text-right tabular-nums">{initial[f.k] ?? '—'}</td><td className="text-right tabular-nums">{final[f.k] ?? '—'}</td><td className={`text-right tabular-nums font-medium ${d > 0 ? 'text-red-600' : d < 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{d ? (d > 0 ? '+' : '') + d.toFixed(2) : '—'}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </SlideDrawer>
  );
}

function ConvertDrawer({ sample, onClose, onDone, addToast }) {
  const [form, setForm] = useState({ qty_kg: sample.offered_qty_kg || '', rate_per_kg: sample.offered_rate_per_kg || '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const mut = useMutation({
    mutationFn: () => sampleApi.convert(sample.id, { qty_kg: parseFloat(form.qty_kg), rate_per_kg: parseFloat(form.rate_per_kg) }),
    onSuccess: (res) => { addToast(`Purchase lot ${res?.data?.lot?.lot_no || ''} created`, 'success'); onDone(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Failed to convert', 'error'),
  });
  const valid = parseFloat(form.qty_kg) > 0 && parseFloat(form.rate_per_kg) > 0;
  const footer = (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Create Purchase Lot</button>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title={`Convert ${sample.sample_no}`} subtitle="Stage 5 — create a purchase lot from this sample" icon={ArrowRight} footer={footer} size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Supplier</span><span className="font-medium">{sample.supplier_name || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Variety / Grade</span><span className="font-medium">{sample.variety || sample.product_name || '—'} {sample.claimed_grade ? `(${sample.claimed_grade})` : ''}</span></div>
          <p className="text-[11px] text-gray-400 pt-1">Supplier, variety, grade and the analysis carry forward automatically. The lot links back to this sample.</p>
        </div>
        <Field label="Quantity (kg)"><input type="number" value={form.qty_kg} onChange={(e) => set('qty_kg', e.target.value)} className="form-input" /></Field>
        <Field label="Rate (Rs/kg)"><input type="number" value={form.rate_per_kg} onChange={(e) => set('rate_per_kg', e.target.value)} className="form-input" /></Field>
      </div>
    </SlideDrawer>
  );
}

function CompareModal({ ids, onClose }) {
  const { data } = useQuery({ queryKey: ['samples', 'compare', ids], queryFn: async () => (await sampleApi.compare(ids))?.data });
  const samples = data?.samples || [];
  return (
    <Modal isOpen onClose={onClose} title={`Compare ${samples.length} Samples`} size="xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-gray-400 text-xs"><th className="text-left py-2">Metric</th>{samples.map((s) => <th key={s.id} className="text-right px-2 py-2 font-medium text-gray-700">{s.sample_no}</th>)}</tr></thead>
          <tbody>
            <Row label="Supplier" samples={samples} f={(s) => s.supplier_name || '—'} />
            <Row label="Variety / Grade" samples={samples} f={(s) => `${s.variety || s.product_name || '—'}${s.claimed_grade ? ` (${s.claimed_grade})` : ''}`} />
            <Row label="Offered Qty" samples={samples} f={(s) => kg(s.offered_qty_kg)} />
            <Row label="Rate / kg" samples={samples} f={(s) => rs(s.offered_rate_per_kg)} />
            <Row label="Exp. Finished %" samples={samples} f={(s) => (s.metrics?.expectedFinishedPct ?? '—') + '%'} bold />
            <Row label="Exp. Finished kg" samples={samples} f={(s) => kg(s.metrics?.expectedFinishedKg)} />
            <Row label="Processing Loss %" samples={samples} f={(s) => (s.metrics?.processingLossPct ?? '—') + '%'} />
            <Row label="Exp. Cost / finished kg" samples={samples} f={(s) => rs(s.metrics?.expectedCostPerFinishedKg)} bold />
            <tr><td colSpan={samples.length + 1} className="pt-3 pb-1 text-xs font-semibold text-gray-500">Quality (final if available, else initial)</td></tr>
            {ANALYSIS_FIELDS.map((fld) => (
              <Row key={fld.k} label={fld.l} samples={samples} f={(s) => { const a = s.final_analysis_json || s.analysis_json || {}; return a[fld.k] ?? '—'; }} />
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
function Row({ label, samples, f, bold }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1.5 text-gray-600">{label}</td>
      {samples.map((s) => <td key={s.id} className={`py-1.5 px-2 text-right tabular-nums ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{f(s)}</td>)}
    </tr>
  );
}
