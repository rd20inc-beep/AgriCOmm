import { useState, useMemo } from 'react';
import {
  FlaskConical, Play, DollarSign, TrendingUp, TrendingDown,
  ArrowRightLeft, Wheat, Globe, Calculator, RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useRunScenario, useCostPredict } from '../api/queries';

function formatCurrency(v, cur = 'USD') {
  if (!v && v !== 0) return '—';
  if (cur === 'PKR') return 'Rs ' + Math.round(v).toLocaleString();
  return '$' + parseFloat(v).toLocaleString();
}

function ResultCard({ label, value, subtitle, positive }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
      <p className={`text-xl font-bold mt-1 ${positive === true ? 'text-emerald-600' : positive === false ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function CostSimulator() {
  const { productsList, settings } = useApp();
  const [productId, setProductId] = useState('');
  const { data: prediction = {}, isLoading } = useCostPredict(productId || null);

  const [overrides, setOverrides] = useState({ rice: 0, bags: 0, freight: 0, misc: 0 });

  const baseCosts = prediction.costBreakdown || prediction.breakdown || {};
  const adjustedCosts = useMemo(() => {
    const result = {};
    Object.entries(baseCosts).forEach(([k, v]) => {
      const pctChange = overrides[k] || 0;
      result[k] = v * (1 + pctChange / 100);
    });
    return result;
  }, [baseCosts, overrides]);

  const totalBase = Object.values(baseCosts).reduce((s, v) => s + v, 0);
  const totalAdjusted = Object.values(adjustedCosts).reduce((s, v) => s + v, 0);
  const impact = totalAdjusted - totalBase;

  return (
    <div className="space-y-5">
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Product</label>
          <select value={productId} onChange={e => setProductId(e.target.value)} className="form-input">
            <option value="">Select product...</option>
            {productsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {productId && (
        <>
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Adjust Cost Categories (%)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['rice', 'bags', 'freight', 'misc'].map(cat => (
                <div key={cat} className="form-group">
                  <label className="form-label capitalize">{cat}</label>
                  <div className="flex items-center gap-2">
                    <input type="range" min={-30} max={30} value={overrides[cat] || 0}
                      onChange={e => setOverrides(prev => ({ ...prev, [cat]: parseInt(e.target.value) }))}
                      className="flex-1" />
                    <span className={`text-sm font-semibold w-12 text-right ${overrides[cat] > 0 ? 'text-red-600' : overrides[cat] < 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                      {overrides[cat] > 0 ? '+' : ''}{overrides[cat]}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ResultCard label="Base Cost/MT" value={formatCurrency(totalBase)} />
            <ResultCard label="Adjusted Cost/MT" value={formatCurrency(totalAdjusted)} />
            <ResultCard label="Impact" value={formatCurrency(Math.abs(impact))} subtitle={impact > 0 ? 'Increase' : impact < 0 ? 'Decrease' : 'No change'} positive={impact <= 0} />
            <ResultCard label="Confidence" value={prediction.confidence ? prediction.confidence + '%' : '—'} />
          </div>
        </>
      )}
    </div>
  );
}

function FxSimulator() {
  const { exportOrders, settings } = useApp();
  const [fxRate, setFxRate] = useState(settings?.pkrRate || 280);
  const baseRate = settings?.pkrRate || 280;

  const impact = useMemo(() => {
    const totalContractUSD = exportOrders.reduce((s, o) => s + (o.contractValue || 0), 0);
    const totalMillCostsPKR = 0; // would come from batches
    const basePKREquiv = totalContractUSD * baseRate;
    const newPKREquiv = totalContractUSD * fxRate;
    const gainLoss = newPKREquiv - basePKREquiv;
    return { totalContractUSD, basePKREquiv, newPKREquiv, gainLoss, rateChange: ((fxRate - baseRate) / baseRate * 100).toFixed(1) };
  }, [exportOrders, fxRate, baseRate]);

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">USD/PKR Exchange Rate</h3>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">Rs {baseRate - 30}</span>
          <input type="range" min={baseRate - 30} max={baseRate + 30} step={1}
            value={fxRate} onChange={e => setFxRate(parseInt(e.target.value))}
            className="flex-1" />
          <span className="text-sm text-gray-500">Rs {baseRate + 30}</span>
        </div>
        <div className="flex items-center justify-center mt-3 gap-4">
          <span className="text-sm text-gray-500">Base: Rs {baseRate}</span>
          <span className="text-lg font-bold text-blue-600">Rs {fxRate}</span>
          <span className={`text-sm font-medium ${impact.rateChange > 0 ? 'text-emerald-600' : impact.rateChange < 0 ? 'text-red-600' : 'text-gray-500'}`}>
            {impact.rateChange > 0 ? '+' : ''}{impact.rateChange}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ResultCard label="Total Export (USD)" value={formatCurrency(impact.totalContractUSD)} />
        <ResultCard label="Base PKR Equiv" value={formatCurrency(impact.basePKREquiv, 'PKR')} />
        <ResultCard label="New PKR Equiv" value={formatCurrency(impact.newPKREquiv, 'PKR')} />
        <ResultCard label="FX Gain/Loss" value={formatCurrency(Math.abs(impact.gainLoss), 'PKR')}
          subtitle={impact.gainLoss >= 0 ? 'Favorable' : 'Unfavorable'}
          positive={impact.gainLoss >= 0} />
      </div>
    </div>
  );
}

function YieldSimulator() {
  const { millingBatches, settings } = useApp();
  const [yieldPct, setYieldPct] = useState(75);
  const [brokenPct, setBrokenPct] = useState(10);

  const analysis = useMemo(() => {
    const completedBatches = millingBatches.filter(b => b.status === 'Completed');
    const avgYield = completedBatches.length > 0
      ? completedBatches.reduce((s, b) => s + (b.yieldPct || 0), 0) / completedBatches.length
      : 75;
    const avgBroken = completedBatches.length > 0
      ? completedBatches.reduce((s, b) => s + ((b.brokenMT || 0) / Math.max(b.rawQtyMT, 1) * 100), 0) / completedBatches.length
      : 10;

    const totalRawMT = millingBatches.reduce((s, b) => s + (b.rawQtyMT || 0), 0);
    const finishedMTAtSimulated = totalRawMT * (yieldPct / 100);
    const finishedMTAtAvg = totalRawMT * (avgYield / 100);
    const yieldDiff = finishedMTAtSimulated - finishedMTAtAvg;

    const finishedPricePerMT = 72800;
    const brokenPricePerMT = 42000;
    const revenueSimulated = finishedMTAtSimulated * finishedPricePerMT + (totalRawMT * brokenPct / 100) * brokenPricePerMT;
    const revenueAvg = finishedMTAtAvg * finishedPricePerMT + (totalRawMT * avgBroken / 100) * brokenPricePerMT;

    return { avgYield: avgYield.toFixed(1), avgBroken: avgBroken.toFixed(1), totalRawMT, finishedMTAtSimulated, yieldDiff, revenueSimulated, revenueAvg, revenueDiff: revenueSimulated - revenueAvg };
  }, [millingBatches, yieldPct, brokenPct]);

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Finished Rice Yield %</label>
            <span className="text-sm font-bold text-blue-600">{yieldPct}%</span>
          </div>
          <input type="range" min={60} max={85} step={0.5} value={yieldPct}
            onChange={e => setYieldPct(parseFloat(e.target.value))} className="w-full" />
          <p className="text-xs text-gray-400 mt-1">Historical average: {analysis.avgYield}%</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Broken Rice %</label>
            <span className="text-sm font-bold text-amber-600">{brokenPct}%</span>
          </div>
          <input type="range" min={3} max={25} step={0.5} value={brokenPct}
            onChange={e => setBrokenPct(parseFloat(e.target.value))} className="w-full" />
          <p className="text-xs text-gray-400 mt-1">Historical average: {analysis.avgBroken}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ResultCard label="Total Raw (MT)" value={`${analysis.totalRawMT.toFixed(1)} MT`} />
        <ResultCard label="Simulated Output" value={`${analysis.finishedMTAtSimulated.toFixed(1)} MT`} />
        <ResultCard label="Output Diff" value={`${analysis.yieldDiff >= 0 ? '+' : ''}${analysis.yieldDiff.toFixed(1)} MT`}
          positive={analysis.yieldDiff >= 0} />
        <ResultCard label="Revenue Impact (PKR)" value={formatCurrency(Math.abs(analysis.revenueDiff), 'PKR')}
          subtitle={analysis.revenueDiff >= 0 ? 'Increase' : 'Decrease'} positive={analysis.revenueDiff >= 0} />
      </div>
    </div>
  );
}

function FullOrderSimulator() {
  const { customersList, productsList, settings } = useApp();
  const scenarioMutation = useRunScenario();
  const [form, setForm] = useState({
    customer_id: '', product_id: '', qty_mt: 50, incoterm: 'FOB', margin_target: 15,
  });
  const [result, setResult] = useState(null);

  async function handleSimulate() {
    try {
      const res = await scenarioMutation.mutateAsync({ type: 'full-order', data: form });
      setResult(res?.data?.scenario || res?.data || res || {});
    } catch (err) {
      // Compute locally as fallback
      const qty = parseFloat(form.qty_mt) || 50;
      const estCostPerMT = 380;
      const totalCost = qty * estCostPerMT;
      const targetMargin = parseFloat(form.margin_target) || 15;
      const minPrice = estCostPerMT / (1 - targetMargin / 100);
      setResult({
        estimatedCostPerMt: estCostPerMT, totalEstimatedCost: totalCost,
        minSellingPrice: Math.round(minPrice), targetMargin: targetMargin,
        recommendedPrice: Math.round(minPrice * 1.05),
        contractValue: qty * Math.round(minPrice * 1.05),
        estimatedProfit: qty * Math.round(minPrice * 1.05) - totalCost,
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Customer</label>
          <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className="form-input">
            <option value="">Select customer...</option>
            {customersList.slice(0, 100).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Product</label>
          <select value={form.product_id} onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))} className="form-input">
            <option value="">Select product...</option>
            {productsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Quantity (MT)</label>
          <input type="number" value={form.qty_mt} onChange={e => setForm(p => ({ ...p, qty_mt: e.target.value }))} className="form-input" />
        </div>
        <div className="form-group">
          <label className="form-label">Incoterm</label>
          <select value={form.incoterm} onChange={e => setForm(p => ({ ...p, incoterm: e.target.value }))} className="form-input">
            <option>FOB</option><option>CIF</option><option>CNF</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Target Margin %</label>
          <input type="number" value={form.margin_target} onChange={e => setForm(p => ({ ...p, margin_target: e.target.value }))} className="form-input" />
        </div>
        <div className="form-group flex items-end">
          <button onClick={handleSimulate} disabled={scenarioMutation.isPending} className="btn btn-primary w-full">
            <Calculator className="w-4 h-4" />
            {scenarioMutation.isPending ? 'Simulating...' : 'Simulate'}
          </button>
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <ResultCard label="Est. Cost/MT" value={formatCurrency(result.estimatedCostPerMt || result.costPerMt)} />
          <ResultCard label="Total Cost" value={formatCurrency(result.totalEstimatedCost || result.totalCost)} />
          <ResultCard label="Min Sell Price" value={formatCurrency(result.minSellingPrice || result.minPrice)} />
          <ResultCard label="Recommended" value={formatCurrency(result.recommendedPrice)} />
          <ResultCard label="Contract Value" value={formatCurrency(result.contractValue)} />
          <ResultCard label="Est. Profit" value={formatCurrency(result.estimatedProfit || result.profit)} positive={(result.estimatedProfit || result.profit) > 0} />
        </div>
      )}
    </div>
  );
}

const SCENARIO_TABS = [
  { key: 'cost', label: 'Cost Changes', icon: DollarSign },
  { key: 'fx', label: 'FX Impact', icon: Globe },
  { key: 'yield', label: 'Yield Impact', icon: Wheat },
  { key: 'order', label: 'Full Order', icon: Calculator },
];

export default function ScenarioSimulator() {
  const [activeScenario, setActiveScenario] = useState('cost');

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-indigo-600" />
            Scenario Simulator
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">What-if analysis for business decisions</p>
        </div>
      </div>

      {/* Scenario Type Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SCENARIO_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeScenario === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveScenario(tab.key)}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                isActive ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-gray-100 text-gray-600 hover:border-gray-200'
              }`}>
              <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
              <span className="text-sm font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scenario Content */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        {activeScenario === 'cost' && <CostSimulator />}
        {activeScenario === 'fx' && <FxSimulator />}
        {activeScenario === 'yield' && <YieldSimulator />}
        {activeScenario === 'order' && <FullOrderSimulator />}
      </div>
    </div>
  );
}
