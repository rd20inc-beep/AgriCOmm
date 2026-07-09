import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Package, Plus, RefreshCw, Check, Lock, AlertTriangle } from 'lucide-react';
import { FinanceTable, FinanceKPI } from '../../../components/finance';
import { useFxRates, useCommodityRates } from '../../../api/queries';
import { financeApi } from '../../../api/services';
import { useApp } from '../../../context/AppContext';

const SUB_TABS = [
  { key: 'fx', label: 'FX Rates', icon: DollarSign },
  { key: 'commodity', label: 'Commodity & Product Rates', icon: Package },
];

export default function RatesCenter() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState('fx');
  const { data: fxData = {}, isLoading: fxLoading } = useFxRates();
  const { data: commodityRates = [], isLoading: crLoading } = useCommodityRates();

  const fxRates = fxData.rates || [];
  const latestFx = fxData.latest || {};

  // Add FX Rate form
  const [showFxForm, setShowFxForm] = useState(false);
  const [fxForm, setFxForm] = useState({ currency_code: 'USD', rate: '', effective_date: new Date().toISOString().split('T')[0], source_type: 'manual', notes: '' });

  // Add Commodity Rate form
  const [showCrForm, setShowCrForm] = useState(false);
  const [crForm, setCrForm] = useState({ rateType: '', productType: '', unit: 'per_mt', currency: 'PKR', rateValue: '', effectiveDate: new Date().toISOString().split('T')[0], notes: '' });

  async function handleAddFxRate(e) {
    e.preventDefault();
    try {
      await financeApi.addFxRate(fxForm);
      addToast('FX rate added successfully', 'success');
      setShowFxForm(false);
      setFxForm({ ...fxForm, rate: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['finance-fx-rates'] });
      qc.invalidateQueries({ queryKey: ['finance-overview-summary'] });
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function handleAddCommodityRate(e) {
    e.preventDefault();
    try {
      await financeApi.addCommodityRate(crForm);
      addToast('Commodity rate added', 'success');
      setShowCrForm(false);
      setCrForm({ ...crForm, rateValue: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['finance-commodity-rates'] });
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function handleRefreshFx() {
    try {
      const res = await financeApi.refreshFxValues();
      const data = res?.data || res;
      addToast(`Updated ${data.updatedOrders || 0} orders to rate ${data.currentRate}`, 'success');
      qc.invalidateQueries({ queryKey: ['finance-overview-summary'] });
    } catch (err) {
      addToast(`Refresh failed: ${err.message}`, 'error');
    }
  }

  const fxColumns = [
    { key: 'from_currency', label: 'From', sortable: true },
    { key: 'to_currency', label: 'To', sortable: true },
    { key: 'rate', label: 'Rate', sortable: true, align: 'right', render: (v) => parseFloat(v).toFixed(2) },
    { key: 'effective_date', label: 'Effective Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—' },
    { key: 'source_type', label: 'Source', render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full ${v === 'manual' ? 'bg-blue-50 text-blue-700' : v === 'market' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}>{v || 'manual'}</span>
    )},
    { key: 'is_active', label: 'Active', render: (v) => v ? <Check size={14} className="text-emerald-500" /> : <span className="text-gray-300">—</span> },
  ];

  const crColumns = [
    { key: 'rateType', label: 'Rate Type', sortable: true, render: (v) => (v || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { key: 'productType', label: 'Product', sortable: true, render: (v) => v || '—' },
    { key: 'unit', label: 'Unit', render: (v) => v || 'per_mt' },
    { key: 'currency', label: 'Currency', render: (v) => v || 'PKR' },
    { key: 'rateValue', label: 'Rate', sortable: true, align: 'right', render: (v) => `Rs ${parseFloat(v).toLocaleString()}` },
    { key: 'effectiveDate', label: 'Effective', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—' },
    { key: 'isLocked', label: 'Locked', render: (v) => v ? <Check size={14} className="text-emerald-500" /> : '—' },
  ];

  const isFallback = latestFx.source === 'system_settings_fallback';
  const heroGradient = isFallback
    ? 'from-amber-600 via-amber-500 to-amber-500'
    : 'from-violet-700 via-indigo-600 to-blue-600';

  const lockedCount = useMemo(() => commodityRates.filter(c => c.isLocked).length, [commodityRates]);

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 30%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <DollarSign size={14} /> Current USD / PKR
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {latestFx.rate ? `Rs ${parseFloat(latestFx.rate).toFixed(2)}` : 'Not set'}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {latestFx.effectiveDate ? <>Effective {new Date(latestFx.effectiveDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</> : 'No FX history yet'}
              {' · '}{fxRates.length} historical {fxRates.length === 1 ? 'entry' : 'entries'}
              {' · '}{commodityRates.length} commodity {commodityRates.length === 1 ? 'rate' : 'rates'}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full ${isFallback ? 'bg-white/15 ring-1 ring-white/30' : 'bg-emerald-500/20 ring-1 ring-emerald-300/30'}`}>
              {isFallback ? <AlertTriangle size={12} /> : <Check size={12} />}
              {isFallback ? 'Fallback rate — add proper FX' : `Source: ${latestFx.source || 'manual'}`}
            </span>
            <button onClick={handleRefreshFx}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors">
              <RefreshCw size={12} /> Refresh open orders
            </button>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-3">
        <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
          {SUB_TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  subTab === t.key ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}><Icon size={14} /> {t.label}</button>
            );
          })}
        </div>
      </div>

      {subTab === 'fx' && (
        <>
          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={() => setShowFxForm(!showFxForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus size={14} /> Add FX Rate
            </button>
          </div>

          {/* Add form */}
          {showFxForm && (
            <form onSubmit={handleAddFxRate} className="bg-gray-50 rounded-xl border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Currency</label>
                <select value={fxForm.currency_code} onChange={e => setFxForm({ ...fxForm, currency_code: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rate (to PKR)</label>
                <input type="number" step="0.01" required value={fxForm.rate} onChange={e => setFxForm({ ...fxForm, rate: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" placeholder="280.00" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Effective Date</label>
                <input type="date" required value={fxForm.effective_date} onChange={e => setFxForm({ ...fxForm, effective_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Source</label>
                <select value={fxForm.source_type} onChange={e => setFxForm({ ...fxForm, source_type: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="manual">Manual</option><option value="market">Market</option><option value="imported">Imported</option>
                </select>
              </div>
              <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-blue-700">Save</button>
            </form>
          )}

          <FinanceTable title="FX Rate History" columns={fxColumns} data={fxRates}
            searchKeys={['from_currency']} exportFilename="fx-rates" loading={fxLoading} />
        </>
      )}

      {subTab === 'commodity' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <FinanceKPI icon={Package} title="Total Rates" value={String(commodityRates.length)}
              subtitle="Across all products" status="neutral" loading={crLoading} />
            <FinanceKPI icon={Lock} title="Locked Rates" value={String(lockedCount)}
              subtitle={`${commodityRates.length - lockedCount} editable`} status={lockedCount > 0 ? 'info' : 'neutral'} loading={crLoading} />
            <FinanceKPI icon={Package} title="Rate Types" value={String(new Set(commodityRates.map(c => c.rateType)).size)}
              subtitle="Distinct categories" status="neutral" loading={crLoading} />
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowCrForm(!showCrForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus size={14} /> Add Rate
            </button>
          </div>

          {showCrForm && (
            <form onSubmit={handleAddCommodityRate} className="bg-gray-50 rounded-xl border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rate Type</label>
                <select value={crForm.rateType} onChange={e => setCrForm({ ...crForm, rateType: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" required>
                  <option value="">Select...</option>
                  <option value="raw_rice_purchase">Raw Rice Purchase</option><option value="finished_rice">Finished Rice</option>
                  <option value="broken_rice">Broken Rice</option>
                  <option value="milling_cost">Milling Cost</option><option value="packaging_rate">Packaging</option><option value="freight_rate">Freight</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Product Type</label>
                <input type="text" value={crForm.productType} onChange={e => setCrForm({ ...crForm, productType: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" placeholder="e.g. IRRI-6" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rate (PKR)</label>
                <input type="number" step="0.01" required value={crForm.rateValue} onChange={e => setCrForm({ ...crForm, rateValue: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" placeholder="95000" />
              </div>
              <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-blue-700">Save</button>
            </form>
          )}

          <FinanceTable title="Commodity & Product Rates" columns={crColumns} data={commodityRates}
            searchKeys={['rateType', 'productType']} exportFilename="commodity-rates" loading={crLoading} />
        </>
      )}
    </div>
  );
}
