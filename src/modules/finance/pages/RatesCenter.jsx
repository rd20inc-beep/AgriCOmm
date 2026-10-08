import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Package, Plus, RefreshCw, Check, Lock, AlertTriangle } from 'lucide-react';
import { FinanceTable, FinanceKPI } from '../../../components/finance';
import { useFxRates, useCommodityRates, useProducts } from '../../../api/queries';
import { financeApi } from '../../../api/services';
import { useApp } from '../../../context/AppContext';
import PermissionGate from '../../../shared/components/PermissionGate';
import { todayLocalISO, fmtDate, fmtNum, fmtMoney, fmtPKR } from '../../../shared/utils/format';
import { HeadlineCard, TypeChip } from '../components/FinanceUI';
import { btnPrimary, btnSecondary } from '../utils/uiClasses';
import FxRevaluationPanel from '../components/FxRevaluationPanel';

// By-product grades a rate can be scoped to; blank means the product as a whole.
// Finished rice and raw are priced per product, so they leave this empty.
const BYPRODUCT_GRADES = ['B1', 'B2', 'B3', 'CSR', 'SWEEPING', 'STONE', 'POWDER', 'CHOBA'];

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
  const [fxForm, setFxForm] = useState({ currency_code: 'USD', rate: '', effective_date: todayLocalISO(), source_type: 'manual', notes: '' });

  // Add Commodity Rate form
  const [showCrForm, setShowCrForm] = useState(false);
  const [crForm, setCrForm] = useState({ rateType: '', productId: '', productType: '', unit: 'per_kg', currency: 'PKR', rateValue: '', effectiveDate: todayLocalISO(), notes: '' });
  // Products for the picker — a rate is keyed by product (+ grade for by-products),
  // which is how held-stock profit finds the selling price for each lot.
  const { data: productsData } = useProducts({ limit: 500 });
  const productOptions = useMemo(() => {
    const raw = productsData?.products || productsData || [];
    return (Array.isArray(raw) ? raw : []).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [productsData]);

  // Disable Save while a request is in flight so a double-click can't post twice.
  const [savingFx, setSavingFx] = useState(false);
  const [savingCr, setSavingCr] = useState(false);

  async function handleAddFxRate(e) {
    e.preventDefault();
    if (savingFx) return;
    setSavingFx(true);
    try {
      await financeApi.addFxRate(fxForm);
      addToast('FX rate added successfully', 'success');
      setShowFxForm(false);
      setFxForm({ ...fxForm, rate: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['finance-fx-rates'] });
      qc.invalidateQueries({ queryKey: ['finance-overview-summary'] });
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    } finally {
      setSavingFx(false);
    }
  }

  async function handleAddCommodityRate(e) {
    e.preventDefault();
    if (savingCr) return;
    setSavingCr(true);
    try {
      await financeApi.addCommodityRate(crForm);
      addToast('Commodity rate added', 'success');
      setShowCrForm(false);
      setCrForm({ ...crForm, rateValue: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['finance-commodity-rates'] });
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    } finally {
      setSavingCr(false);
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
    { key: 'rate', label: 'Rate', sortable: true, align: 'right', render: (v) => fmtNum(v, 2) },
    { key: 'effective_date', label: 'Effective Date', sortable: true, render: (v) => fmtDate(v) },
    { key: 'source_type', label: 'Source', render: (v) => (
      <TypeChip className="capitalize">{v || 'manual'}</TypeChip>
    )},
    { key: 'is_active', label: 'Active', render: (v) => v ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check size={14} aria-hidden="true" /> Active</span> : <span className="text-gray-400">—</span> },
  ];

  const crColumns = [
    { key: 'rateType', label: 'Rate Type', sortable: true, render: (v) => (v || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { key: 'productName', label: 'Product', sortable: true, render: (v) => v || <span className="text-gray-300">any</span> },
    { key: 'productType', label: 'Grade', sortable: true, render: (v) => v || <span className="text-gray-300">all</span> },
    { key: 'unit', label: 'Unit', render: (v) => v || 'per_mt' },
    { key: 'currency', label: 'Currency', render: (v) => v || 'PKR' },
    { key: 'rateValue', label: 'Rate', sortable: true, align: 'right', render: (v, row) => fmtMoney(v, row.currency || 'PKR', { decimals: 2 }) },
    { key: 'effectiveDate', label: 'Effective', sortable: true, render: (v) => fmtDate(v) },
    { key: 'isLocked', label: 'Locked', render: (v) => v ? <span className="inline-flex items-center gap-1 text-xs text-gray-700"><Lock size={13} aria-hidden="true" /> Locked</span> : '—' },
  ];

  const isFallback = latestFx.source === 'system_settings_fallback';

  const lockedCount = useMemo(() => commodityRates.filter(c => c.isLocked).length, [commodityRates]);

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Headline: the rate in use, and whether it is a real one ─── */}
      <HeadlineCard
        icon={DollarSign}
        label="Current USD / PKR"
        value={latestFx.rate ? fmtPKR(latestFx.rate, { decimals: 2 }) : 'Not set'}
        sub={<>
          {latestFx.effectiveDate ? <>Effective {fmtDate(latestFx.effectiveDate)}</> : 'No FX history yet'}
          {' · '}{fxRates.length} historical {fxRates.length === 1 ? 'entry' : 'entries'}
          {' · '}{commodityRates.length} commodity {commodityRates.length === 1 ? 'rate' : 'rates'}
        </>}
        right={<>
          {isFallback ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" data-testid="fx-fallback">
              <AlertTriangle size={13} aria-hidden="true" /> Fallback rate — add proper FX
            </span>
          ) : (
            <TypeChip icon={Check}>Source: {latestFx.source || 'manual'}</TypeChip>
          )}
          {/* Adding / refreshing rates is finance.confirm_payment (finance.routes.js). */}
          <PermissionGate module="finance" action="confirm_payment">
            <button type="button" onClick={handleRefreshFx} data-action="refresh-fx" className={btnSecondary}>
              <RefreshCw size={14} aria-hidden="true" /> Refresh open orders
            </button>
          </PermissionGate>
        </>}
      />

      {/* Sub-tabs */}
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
        <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5" role="group" aria-label="Rates">
          {SUB_TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" aria-pressed={subTab === t.key} onClick={() => setSubTab(t.key)}
                className={`flex items-center gap-1.5 px-4 min-h-10 sm:min-h-9 text-sm font-medium rounded-md whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  subTab === t.key ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}><Icon size={14} aria-hidden="true" /> {t.label}</button>
            );
          })}
        </div>
      </div>

      {subTab === 'fx' && (
        <>
          {/* Actions */}
          <PermissionGate module="finance" action="confirm_payment">
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowFxForm(!showFxForm)} data-action="add-fx-rate" aria-expanded={showFxForm}
                className={showFxForm ? btnSecondary : btnPrimary}>
                <Plus size={14} /> Add FX Rate
              </button>
            </div>
          </PermissionGate>

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
                <label className="text-xs text-gray-500 block mb-1">Rate (to PKR) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" required value={fxForm.rate} onChange={e => setFxForm({ ...fxForm, rate: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" placeholder="280.00" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Effective Date <span className="text-red-500">*</span></label>
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
              <button type="submit" disabled={savingFx} className={btnPrimary}>{savingFx ? 'Saving…' : 'Save'}</button>
            </form>
          )}

          <FinanceTable title="FX Rate History" columns={fxColumns} data={fxRates}
            searchKeys={['from_currency']} exportFilename="fx-rates" loading={fxLoading} />

          {/* Month-end revaluation posts a journal: finance.post_journal. */}
          <PermissionGate module="finance" action="post_journal">
            <FxRevaluationPanel />
          </PermissionGate>
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

          <PermissionGate module="finance" action="confirm_payment">
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCrForm(!showCrForm)} data-action="add-commodity-rate" aria-expanded={showCrForm}
                className={showCrForm ? btnSecondary : btnPrimary}>
                <Plus size={14} /> Add Rate
              </button>
            </div>
          </PermissionGate>

          {showCrForm && (
            <form onSubmit={handleAddCommodityRate} className="bg-gray-50 rounded-xl border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rate Type <span className="text-red-500">*</span></label>
                <select value={crForm.rateType} onChange={e => setCrForm({ ...crForm, rateType: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" required>
                  <option value="">Select...</option>
                  <option value="raw_rice_purchase">Raw Rice Purchase</option><option value="finished_rice">Finished Rice</option>
                  <option value="broken_rice">Broken Rice</option>
                  <option value="milling_cost">Milling Cost</option><option value="packaging_rate">Packaging</option><option value="freight_rate">Freight</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Product</label>
                <select value={crForm.productId} onChange={e => setCrForm({ ...crForm, productId: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">Any product</option>
                  {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Grade <span className="text-gray-400">(by-products)</span></label>
                <select value={crForm.productType} onChange={e => setCrForm({ ...crForm, productType: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">All grades</option>
                  {BYPRODUCT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Unit <span className="text-red-500">*</span></label>
                <select value={crForm.unit} onChange={e => setCrForm({ ...crForm, unit: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" required>
                  <option value="per_kg">per KG</option>
                  <option value="per_mt">per MT (tonne)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rate ({crForm.currency}) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" required value={crForm.rateValue} onChange={e => setCrForm({ ...crForm, rateValue: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                  placeholder={crForm.unit === 'per_kg' ? '115.00' : '115000'} />
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {crForm.unit === 'per_kg' ? 'price for ONE kilo' : 'price for ONE tonne (1000 kg)'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Effective From <span className="text-red-500">*</span></label>
                <input type="date" required value={crForm.effectiveDate} onChange={e => setCrForm({ ...crForm, effectiveDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <button type="submit" disabled={savingCr} className={btnPrimary}>{savingCr ? 'Saving…' : 'Save'}</button>
            </form>
          )}

          <FinanceTable title="Commodity & Product Rates" columns={crColumns} data={commodityRates}
            searchKeys={['rateType', 'productType']} exportFilename="commodity-rates" loading={crLoading} />
        </>
      )}
    </div>
  );
}
