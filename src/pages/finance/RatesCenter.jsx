import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Package, Plus, RefreshCw, Check } from 'lucide-react';
import { FinanceTable, FinanceKPI } from '../../components/finance';
import { useFxRates, useCommodityRates } from '../../api/queries';
import { financeApi } from '../../api/services';
import { useApp } from '../../context/AppContext';

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

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {SUB_TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  subTab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}><Icon size={14} /> {t.label}</button>
            );
          })}
        </div>
      </div>

      {subTab === 'fx' && (
        <>
          {/* FX KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <FinanceKPI icon={DollarSign} title="Current USD/PKR" value={latestFx.rate ? String(latestFx.rate) : '—'}
              subtitle={latestFx.effectiveDate ? `Since ${new Date(latestFx.effectiveDate).toLocaleDateString()}` : '—'}
              status="info" loading={fxLoading} />
            <FinanceKPI icon={RefreshCw} title="Rate Source" value={latestFx.source || '—'}
              subtitle={latestFx.source === 'system_settings_fallback' ? 'Using default — add a proper rate' : 'From fx_rates table'}
              status={latestFx.source === 'system_settings_fallback' ? 'warning' : 'good'} loading={fxLoading} />
            <FinanceKPI icon={DollarSign} title="Total Rates" value={String(fxRates.length)}
              subtitle="Historical entries" status="neutral" loading={fxLoading} />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={() => setShowFxForm(!showFxForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus size={14} /> Add FX Rate
            </button>
            <button onClick={handleRefreshFx}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              <RefreshCw size={14} /> Refresh Open Orders
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
                  <option value="paddy_purchase">Paddy Purchase</option><option value="finished_rice">Finished Rice</option>
                  <option value="broken_rice">Broken Rice</option><option value="bran">Bran</option><option value="husk">Husk</option>
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
