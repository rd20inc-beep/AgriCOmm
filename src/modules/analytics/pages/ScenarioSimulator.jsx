import { useState, useMemo } from 'react';
import {
  FlaskConical, Play, DollarSign, TrendingUp, TrendingDown,
  ArrowRightLeft, Wheat, Globe, Calculator, RefreshCw,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useRunScenario, useCostPredict } from '../../../api/queries';
import { useCommodityPrices } from '../../../modules/milling/hooks/useCommodityPrices';
import { INCOTERMS } from '../../../shared/constants/incoterms';
import { favStar } from '../../../shared/utils/favorites';

function formatCurrency(v, cur = 'USD') {
  if (!v && v !== 0) return '—';
  if (cur === 'PKR') return 'Rs ' + (v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Sellable yield categories (KG quantity field + per-KG-derived price field on the
// transformed batch). `rate` maps to a canonical commodity price (per-KG) used when a
// batch has no recorded price for the category. Bran/husk are excluded — no longer sold.
const YIELD_CATEGORIES = [
  { key: 'finished', label: 'Finished Rice', qty: 'actualFinishedMT', price: 'finishedPricePerMT', rate: 'finished' },
  { key: 'broken', label: 'Broken', qty: 'brokenMT', price: 'brokenPricePerMT', rate: 'broken' },
  { key: 'b1', label: 'B1', qty: 'b1MT', price: 'b1PricePerMT', rate: 'broken' },
  { key: 'b2', label: 'B2', qty: 'b2MT', price: 'b2PricePerMT', rate: 'broken' },
  { key: 'b3', label: 'B3', qty: 'b3MT', price: 'b3PricePerMT', rate: 'broken' },
  { key: 'csr', label: 'CSR', qty: 'csrMT', price: 'csrPricePerMT', rate: 'broken' },
  { key: 'shortGrain', label: 'Short Grain', qty: 'shortGrainMT', price: 'shortGrainPricePerMT', rate: 'broken' },
  { key: 'powder', label: 'Powder', qty: 'powderMT', price: 'powderPricePerMT', rate: null },
  { key: 'sweeping', label: 'S.W', qty: 'sweepingMT', price: 'sweepingPricePerMT', rate: null },
  { key: 'choba', label: 'Choba', qty: 'chobaMT', price: 'chobaPricePerMT', rate: null },
];

function YieldSimulator() {
  const { millingBatches } = useApp();
  const prices = useCommodityPrices(); // canonical per-MT rates (finished/broken/…)
  const [supplier, setSupplier] = useState('All');
  const [rawQtyKg, setRawQtyKg] = useState(50000);
  const [yieldPct, setYieldPct] = useState(null);   // null until ref loads → historical avg
  const [brokenPct, setBrokenPct] = useState(null);

  const suppliers = useMemo(
    () => [...new Set(millingBatches.filter(b => b.status === 'Completed' && b.supplierName).map(b => b.supplierName))].sort(),
    [millingBatches]
  );

  // Real reference profile derived from completed batches (optionally scoped to one supplier).
  const ref = useMemo(() => {
    const done = millingBatches.filter(b => b.status === 'Completed'
      && (supplier === 'All' || b.supplierName === supplier) && (b.rawQtyMT || 0) > 0);
    const totalRawKg = done.reduce((s, b) => s + (b.rawQtyMT || 0) * 1000, 0);

    // Per-category: historical share of raw + qty-weighted avg price/kg (price field is per-MT → /1000).
    const cats = YIELD_CATEGORIES.map(c => {
      let catKg = 0, valueWeightedPrice = 0, pricedKg = 0;
      done.forEach(b => {
        const kg = (b[c.qty] || 0) * 1000;
        const priceKg = (b[c.price] || 0) / 1000;
        catKg += kg;
        if (priceKg > 0) { valueWeightedPrice += priceKg * kg; pricedKg += kg; }
      });
      return {
        ...c,
        shareOfRaw: totalRawKg > 0 ? catKg / totalRawKg : 0,
        avgPriceKg: pricedKg > 0 ? valueWeightedPrice / pricedKg : 0,
      };
    });

    const avgYield = done.length ? done.reduce((s, b) => s + (b.yieldPct || 0), 0) / done.length : 0;
    const avgBroken = totalRawKg > 0
      ? (done.reduce((s, b) => s + (b.brokenMT || 0) * 1000, 0) / totalRawKg) * 100 : 0;

    // Real input cost per kg of raw: total raw cost ÷ raw kg, over ONLY the batches that
    // carry a raw cost (mixing in cost-less batches would understate the rate). Fall back
    // to raw-cost-per-finished-kg × yield where the total isn't stored.
    let costedRawKg = 0, costedRawTotal = 0;
    done.forEach(b => {
      const rawKg = (b.rawQtyMT || 0) * 1000;
      let rawCost = b.rawCostTotal || 0;
      if (!rawCost && b.rawCostPerKgFinished > 0) rawCost = b.rawCostPerKgFinished * (b.actualFinishedMT || 0) * 1000;
      if (rawCost > 0 && rawKg > 0) { costedRawTotal += rawCost; costedRawKg += rawKg; }
    });
    const rawRatePerKg = costedRawKg > 0 ? costedRawTotal / costedRawKg : 0;
    const millingFeePerKg = done.length
      ? done.reduce((s, b) => s + (b.millingFeePerKg || 0), 0) / done.length : 0;

    return { cats, avgYield, avgBroken, rawRatePerKg, millingFeePerKg, batchCount: done.length };
  }, [millingBatches, supplier]);

  const effYield = yieldPct != null ? yieldPct : Math.round((ref.avgYield || 65) * 10) / 10;
  const effBroken = brokenPct != null ? brokenPct : Math.round((ref.avgBroken || 8) * 10) / 10;

  // Project the output mix for the entered raw quantity: finished & broken from the
  // sliders, the remaining sellable categories from their historical share of raw.
  const sim = useMemo(() => {
    const raw = parseFloat(rawQtyKg) || 0;
    const rateKg = (c) => (c.rate && prices[c.rate] ? prices[c.rate] / 1000 : 0); // per-MT → per-KG
    const lines = ref.cats.map(c => {
      let outKg;
      if (c.key === 'finished') outKg = raw * (effYield / 100);
      else if (c.key === 'broken') outKg = raw * (effBroken / 100);
      else outKg = raw * c.shareOfRaw;
      // Prefer the batch-recorded price; fall back to the canonical commodity rate.
      const priceKg = c.avgPriceKg > 0 ? c.avgPriceKg : rateKg(c);
      return { ...c, outKg, priceKg, value: outKg * priceKg };
    }).filter(l => l.outKg > 0.01 || l.key === 'finished' || l.key === 'broken');

    const revenue = lines.reduce((s, l) => s + l.value, 0);
    const inputCost = raw * (ref.rawRatePerKg + ref.millingFeePerKg);
    const profit = revenue - inputCost;
    const sellableKg = lines.reduce((s, l) => s + l.outKg, 0);
    return { lines, revenue, inputCost, profit, raw, sellableKg, profitPerKg: raw > 0 ? profit / raw : 0 };
  }, [ref, rawQtyKg, effYield, effBroken]);

  const fmtKg = (kg) => `${Math.round(kg).toLocaleString()} kg`;

  if (ref.batchCount === 0) {
    return <div className="p-10 text-center text-sm text-gray-400">No completed milling batches yet — run a batch to seed the yield model.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Reference Batches</label>
          <select value={supplier} onChange={e => { setSupplier(e.target.value); setYieldPct(null); setBrokenPct(null); }} className="form-input">
            <option value="All">All suppliers ({ref.batchCount} batches)</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Raw Rice to Mill (kg)</label>
          <input type="number" min={0} step={1000} value={rawQtyKg}
            onChange={e => setRawQtyKg(e.target.value)} className="form-input" />
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Finished Rice Yield %</label>
            <span className="text-sm font-bold text-blue-600">{effYield}%</span>
          </div>
          <input type="range" min={50} max={85} step={0.5} value={effYield}
            onChange={e => setYieldPct(parseFloat(e.target.value))} className="w-full" />
          <p className="text-xs text-gray-400 mt-1">Historical average: {ref.avgYield.toFixed(1)}%</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Broken Rice %</label>
            <span className="text-sm font-bold text-amber-600">{effBroken}%</span>
          </div>
          <input type="range" min={0} max={30} step={0.5} value={effBroken}
            onChange={e => setBrokenPct(parseFloat(e.target.value))} className="w-full" />
          <p className="text-xs text-gray-400 mt-1">Historical average: {ref.avgBroken.toFixed(1)}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ResultCard label="Sellable Output" value={fmtKg(sim.sellableKg)} subtitle={`${(sim.raw ? sim.sellableKg / sim.raw * 100 : 0).toFixed(1)}% of raw`} />
        <ResultCard label="Est. Revenue" value={formatCurrency(sim.revenue, 'PKR')} />
        <ResultCard label="Input Cost" value={formatCurrency(sim.inputCost, 'PKR')}
          subtitle={ref.rawRatePerKg > 0 ? `raw Rs${ref.rawRatePerKg.toFixed(1)}/kg + milling` : 'milling only — raw cost not recorded'} />
        <ResultCard label="Est. Profit / Loss" value={formatCurrency(sim.profit, 'PKR')}
          subtitle={`${formatCurrency(sim.profitPerKg, 'PKR')}/kg raw`} positive={sim.profit >= 0} />
      </div>

      <div className="table-container mobile-cards">
        <div className="px-5 py-3 border-b border-gray-200"><h3 className="text-sm font-semibold text-gray-700 uppercase">Output Mix &amp; Value</h3></div>
        <div className="table-scroll">
          <table className="w-full">
            <thead><tr><th className="text-left">Category</th><th className="text-right">Output</th><th className="text-right">% of Raw</th><th className="text-right">Price / kg</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {sim.lines.map(l => (
                <tr key={l.key}>
                  <td data-label="Category" className="font-medium text-gray-900">{l.label}</td>
                  <td data-label="Output" className="text-right">{fmtKg(l.outKg)}</td>
                  <td data-label="% of Raw" className="text-right text-gray-500">{sim.raw > 0 ? (l.outKg / sim.raw * 100).toFixed(1) : '0.0'}%</td>
                  <td data-label="Price / kg" className="text-right">{l.priceKg > 0 ? formatCurrency(l.priceKg, 'PKR') : <span className="text-gray-300">—</span>}</td>
                  <td data-label="Value" className="text-right font-semibold">{l.value > 0 ? formatCurrency(l.value, 'PKR') : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-gray-200 font-semibold">
              <td className="text-gray-900">Total Revenue</td><td data-label="Total Revenue"></td><td></td><td></td>
              <td data-label="Value" className="text-right text-emerald-600">{formatCurrency(sim.revenue, 'PKR')}</td>
            </tr></tfoot>
          </table>
        </div>
        <p className="px-5 py-2 text-[11px] text-gray-400">Output mix from {ref.batchCount} completed batch{ref.batchCount === 1 ? '' : 'es'}; prices use batch-recorded selling prices where available, otherwise the commodity rate master ({prices.source}). Categories with no price show "—" and add no revenue.</p>
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
            {customersList.slice(0, 100).map(c => <option key={c.id} value={c.id}>{favStar(c)}{c.name}</option>)}
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
            {INCOTERMS.map(it => (
              <option key={it.code} value={it.code}>{it.code} — {it.name}</option>
            ))}
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
