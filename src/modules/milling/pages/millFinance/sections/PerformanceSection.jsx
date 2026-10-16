import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Receipt, Factory, Package, Shield, Sparkles,
} from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import {
  useMillFinanceKpis, useMillFinanceKpiDetail, useProfitLoss, useHeldStockProfit, useMillExpenses,
} from '../../../../../api/queries';
import { fmtPKR, fmtNum, fmtPct, fmtKg, fmtDate } from '../../../../../shared/utils/format';
import AnomalyWatchCard from '../../../../ai/components/AnomalyWatchCard';
import Stat from '../components/Stat';
import { PKR, COMPACT_PKR } from '../constants';

const EFF_LIMIT = 500;

/**
 * Mill Finance ▸ Performance — how the period's profit is made (D-13), the
 * books (GL P&L), stock (working capital, held-stock profit), production,
 * expense mix, milling efficiency and loss & theft flags. Every figure is the
 * backend's (kpi/millFinance.js, docs/AGRIRICE_KPI_CONTRACTS.md).
 *
 * The AI anomaly scan is NOT run on load: it calls an LLM, so it only runs
 * when the user asks (P5-09).
 */
export default function PerformanceSection({ period, focus }) {
  const { millingBatches = [] } = useApp();
  const { data: kpiData } = useMillFinanceKpis({ period });
  const mk = useMemo(() => ({
    period: kpiData?.period || null,
    profit: kpiData?.profit || {},
    production: kpiData?.production || {},
    wc: kpiData?.workingCapital || {},
    loaded: !!kpiData,
  }), [kpiData]);
  // THE BOOKS — the ledger's own answer, so it agrees with the trial balance
  // and includes sales the batch figures cannot see.
  const { data: glPnl } = useProfitLoss({
    entity: 'mill',
    ...(mk.period?.from ? { period_start: mk.period.from } : {}),
    ...(mk.period?.to ? { period_end: mk.period.to } : {}),
  });
  const books = useMemo(() => ({
    revenue: parseFloat(glPnl?.revenue?.total) || 0,
    cogs: parseFloat(glPnl?.cogs?.total) || 0,
    expenses: parseFloat(glPnl?.expenses?.total) || 0,
    grossProfit: parseFloat(glPnl?.grossProfit) || 0,
    netProfit: parseFloat(glPnl?.netProfit) || 0,
    hasData: !!glPnl,
  }), [glPnl]);
  // Cost lives on the lot; the selling price comes from commodity_rate_master.
  const { data: valuation } = useHeldStockProfit({ entity: 'mill' });
  const heldProfit = useMemo(() => {
    const t = valuation?.summary?.total;
    return {
      marketValue: t?.marketValue || 0,
      profit: t?.profit || 0,
      pricedCostValue: t?.pricedCostValue || 0,
      unpricedCostValue: t?.unpricedCostValue || 0,
      unpricedLots: t?.unpricedLots || 0,
      ratesConfigured: valuation?.ratesConfigured || 0,
    };
  }, [valuation]);
  const { data: expData } = useMillExpenses();
  const expSummary = expData?.summary || [];
  const totalOverhead = expSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  // Efficiency: the period's completed company batches, from the server
  // (the rows behind yield.v1 / production_value.v1), not the newest 200.
  const { data: effDetail } = useMillFinanceKpiDetail({ part: 'batches', period, limit: EFF_LIMIT });
  const effBatches = effDetail?.rows || [];
  const margin = mk.profit.marginPct != null ? mk.profit.marginPct.toFixed(1) : '0.0';
  const periodLabel = mk.period?.label || '';

  const lossData = useMemo(() => millingBatches
    .filter((b) => b.status === 'Completed')
    .map((b) => {
      const expected = b.plannedFinishedMT || b.rawQtyMT * 0.65;
      const actual = b.actualFinishedMT;
      const variance = actual - expected;
      const variancePct = expected > 0 ? (variance / expected * 100).toFixed(1) : 0;
      const flagged = parseFloat(variancePct) < -3;
      return { ...b, expected, variance, variancePct, flagged };
    }).sort((a, b) => a.variancePct - b.variancePct), [millingBatches]);

  const [showAnomalies, setShowAnomalies] = useState(focus === 'anomalies');
  // Bring a deep-linked block into view (?focus=efficiency|loss|stock|anomalies).
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`mf-perf-${focus}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [focus]);

  return (
    <div className="space-y-5" data-testid="mf-performance">
      {/* Top KPI row — mill profit (D-13) and how it is made, for the
          period, from the backend (mill_profit.v1). PKR. */}
      <p className="text-[11px] text-gray-500">
        {periodLabel || '…'}{mk.period?.from ? ` (${fmtDate(mk.period.from)} – ${fmtDate(mk.period.to)})` : ''} · PKR · quantities in kg · stock as of {kpiData?.asOf ? fmtDate(kpiData.asOf) : '—'}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat tone={(mk.profit.netProfitPkr || 0) >= 0 ? 'green' : 'red'} icon={TrendingUp} label="Mill Profit (net)"
              value={PKR(mk.profit.netProfitPkr)} sub={`margin ${margin}% · sales − COGS − overheads`} />
        <Stat tone="blue"   icon={Receipt}      label="Sales of Mill Output" value={PKR(mk.profit.revenuePkr)}
              sub={`${mk.profit.saleCount || 0} sale(s) · ${mk.profit.transferCount || 0} transfer(s) to export`} />
        <Stat tone="red"    icon={TrendingDown} label="Cost of Those Sales" value={PKR(mk.profit.cogsPkr)} sub="COGS locked at sale / transfer" />
        <Stat tone="amber"  icon={DollarSign}   label="Mill Overheads"  value={PKR(mk.profit.overheadsPkr)}
              sub={`${mk.profit.overheadCount || 0} expense(s) not tied to a batch`} />
        <Stat tone="slate"  icon={Factory}      label="Batch Cost / kg" value={mk.production.batchCostPerKgPkr != null ? fmtPKR(mk.production.batchCostPerKgPkr, { decimals: 2 }) : '—'}
              sub="cost sheet ÷ sellable finished kg" />
        <Stat tone="purple" icon={Package}      label="Working Capital" value={PKR(mk.wc.totalPkr)} sub="mill stock at landed cost" />
      </div>
      {(mk.profit.uncostedCount > 0 || mk.profit.overheadsUnconvertedCount > 0) && (
        <p className="text-[11px] text-amber-700">
          {mk.profit.uncostedCount > 0 && `${mk.profit.uncostedCount} sale(s) / transfer(s) of mill output have no cost yet — ${PKR(mk.profit.uncostedRevenuePkr)} left out of the profit until costed. `}
          {mk.profit.overheadsUnconvertedCount > 0 && `${mk.profit.overheadsUnconvertedCount} foreign-currency overhead(s) have no PKR figure and are not counted.`}
        </p>
      )}

      {/* ── The books. Straight from the general ledger, so it agrees with the
           trial balance and includes sales the batch figures above cannot
           see (a sale posts revenue whether or not its batch is Completed). ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat tone="blue" icon={TrendingUp} label="Revenue (books)"
              value={books.hasData ? PKR(books.revenue) : '—'} sub="posted to the ledger" />
        <Stat tone="red" icon={TrendingDown} label="Cost of Goods Sold"
              value={books.hasData ? PKR(books.cogs) : '—'} sub="cost of what was sold" />
        <Stat tone={books.grossProfit >= 0 ? 'green' : 'red'} icon={DollarSign} label="Gross Profit"
              value={books.hasData ? PKR(books.grossProfit) : '—'}
              sub={books.revenue > 0 ? `${fmtPct(100 * books.grossProfit / books.revenue)} of revenue` : 'no sales yet'} />
        <Stat tone={books.netProfit >= 0 ? 'green' : 'red'} icon={TrendingUp} label="Net Profit (books)"
              value={books.hasData ? PKR(books.netProfit) : '—'}
              sub={`after ${COMPACT_PKR(books.expenses)} expenses`} />
      </div>

      <div id="mf-perf-stock" className="space-y-3 scroll-mt-4">
        {/* Working capital — mill company stock on hand × landed cost per kg
            (D-14, stock_value.v1), from the backend. No fallback prices. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat tone="amber"  label="Raw Rice"      value={PKR(mk.wc.rawPkr)} sub={fmtKg(mk.wc.rawKg || 0, { decimals: 2 })} />
          <Stat tone="green"  label="Finished Rice" value={PKR(mk.wc.finishedPkr)} sub={fmtKg(mk.wc.finishedKg || 0, { decimals: 2 })} />
          <Stat tone="purple" label="Byproducts"    value={PKR(mk.wc.byproductPkr)}  sub={fmtKg(mk.wc.byproductKg || 0, { decimals: 2 })} />
          <Stat tone="blue"   label="Working Cap."  value={PKR(mk.wc.totalPkr)}
                sub={mk.wc.unpricedLots ? `${mk.wc.unpricedLots} lot(s) have no cost — valued at 0` : `Locked in stock (landed cost × on hand)${mk.wc.committedToMillingPkr ? ` · ${COMPACT_PKR(mk.wc.committedToMillingPkr)} in milling` : ''}`} />
        </div>

        {/* Held-stock profit — what the stock on hand is worth at SELLING price,
            against what it cost. Only shown for stock that has a selling rate;
            unpriced stock is called out rather than valued at cost. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat tone="slate" label="Stock at Selling Price"
                value={heldProfit.ratesConfigured === 0 ? '—' : PKR(heldProfit.marketValue)}
                sub={heldProfit.ratesConfigured === 0
                  ? 'No selling rates set — Finance ▸ Rates'
                  : `${PKR(heldProfit.pricedCostValue)} at cost`} />
          <Stat tone={heldProfit.profit >= 0 ? 'green' : 'red'} label="Profit on Stock Held"
                value={heldProfit.ratesConfigured === 0 ? '—' : PKR(heldProfit.profit)}
                sub={heldProfit.ratesConfigured === 0
                  ? 'needs a price per grade / variety'
                  : (heldProfit.pricedCostValue > 0
                      ? `${fmtPct(100 * heldProfit.profit / heldProfit.pricedCostValue)} on priced stock`
                      : '—')} />
          <Stat tone="amber" label="Not Yet Priced"
                value={heldProfit.unpricedLots ? PKR(heldProfit.unpricedCostValue) : PKR(0)}
                sub={heldProfit.unpricedLots ? `${heldProfit.unpricedLots} lot(s) at cost — no selling rate` : 'every lot has a rate'} />
          <Stat tone="blue" label="Selling Rates Set" value={String(heldProfit.ratesConfigured)}
                sub="per grade / variety" />
        </div>
      </div>

      {/* Mill profit breakdown (mill_profit.v1) and, apart from it, the
          period's production (production_value.v1) — the secondary
          figure D-13 allows, labelled so it is never read as profit. */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Mill Profit (net) — how it is made</h3>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${(mk.profit.netProfitPkr || 0) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            Margin {margin}%
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-1.5">
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Sales of mill output</span><span className="tabular-nums text-emerald-600">{PKR(mk.profit.revenuePkr)}</span></div>
            <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Local sales</span><span className="tabular-nums">{PKR(mk.profit.localSalesRevenuePkr)}</span></div>
            <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Transfers to export (at transfer price)</span><span className="tabular-nums">{PKR(mk.profit.transferRevenuePkr)}</span></div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Costs</span><span className="tabular-nums text-red-600">{PKR((mk.profit.cogsPkr || 0) + (mk.profit.overheadsPkr || 0))}</span></div>
            <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Cost of goods sold</span><span className="tabular-nums">−{PKR(mk.profit.cogsPkr)}</span></div>
            <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Overheads (incl. paid payroll)</span><span className="tabular-nums">−{PKR(mk.profit.overheadsPkr)}</span></div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">Mill Profit (net)</span>
          <span className={`text-lg font-bold tabular-nums ${(mk.profit.netProfitPkr || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{PKR(mk.profit.netProfitPkr)}</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          Unsold output is stock (Working Capital above), not profit. A batch-linked expense is in that batch's cost, so it reaches profit through COGS — never twice.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Production this period <span className="text-xs font-normal text-gray-400">— secondary, not profit</span></h3>
          <span className="text-xs text-gray-500">{mk.production.batchCount || 0} completed batch(es)</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat tone="slate" label="Production value at selling price" value={PKR(mk.production.valueAtSellingPricePkr)}
                sub={`finished ${COMPACT_PKR(mk.production.finishedValuePkr)} · by-products ${COMPACT_PKR(mk.production.byproductValuePkr)}`} />
          <Stat tone="slate" label="Batch costs (cost sheet)" value={PKR(mk.production.batchCostPkr)}
                sub={`rice ${COMPACT_PKR(mk.production.rawCostPkr)} · bags ${COMPACT_PKR(mk.production.packagingCostPkr)} · other ${COMPACT_PKR(mk.production.otherCostPkr)}`} />
          <Stat tone="slate" label="Yield (weighted)" value={mk.production.yieldPct != null ? fmtPct(mk.production.yieldPct) : '—'}
                sub={`${fmtKg(mk.production.finishedKg || 0)} finished of ${fmtKg(mk.production.rawKg || 0)} raw`} />
          <Stat tone="slate" label="Sellable finished" value={fmtKg(mk.production.sellableFinishedKg || 0)}
                sub={mk.production.blendCount ? `${mk.production.blendCount} blend(s) — re-milled rice counted once` : 'not re-milled into a blend'} />
        </div>
        {mk.production.unpricedFinishedBatches > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            {mk.production.unpricedFinishedBatches} batch(es) have no finished-rice selling price — {fmtKg(mk.production.unpricedFinishedKg)} left out of the production value.
          </p>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          Each batch's output at its own recorded selling prices (by-products at what the yield booked). A measure of output, not revenue: nothing here is sold yet.
        </p>
      </div>

      {/* Expense mix (all recorded mill expenses, by head) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Expense Breakdown</h3>
            <span className="text-xs text-gray-400">Total {COMPACT_PKR(totalOverhead)}</span>
          </div>
          <div className="space-y-2">
            {expSummary.length === 0 ? (
              <p className="text-sm text-gray-400">No expenses recorded yet. Click <span className="font-medium text-gray-600">Add Expense</span> on the header.</p>
            ) : (
              expSummary.map(e => {
                const pct = totalOverhead > 0 ? (parseFloat(e.total) / totalOverhead * 100) : 0;
                return (
                  <div key={e.category}>
                    <div className="flex items-center justify-between text-sm mb-0.5">
                      <span className="capitalize text-gray-700">{e.category}</span>
                      <span className="font-medium text-gray-900 tabular-nums">{PKR(parseFloat(e.total))}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pct.toFixed(1)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {/* AI anomaly analysis — an LLM call, so only on request. */}
        <div id="mf-perf-anomalies" className="scroll-mt-4">
          {showAnomalies ? <AnomalyWatchCard /> : (
            <div className="bg-white rounded-xl border border-gray-100 p-5 h-full flex flex-col items-start gap-2">
              <h3 className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5"><Sparkles size={15} className="text-violet-500" aria-hidden="true" /> Anomaly analysis</h3>
              <p className="text-xs text-gray-500">Scans payroll, GL, stock and cash for anything unusual. Uses AI — runs only when you ask.</p>
              <button type="button" onClick={() => setShowAnomalies(true)} data-testid="run-anomaly-analysis"
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <Sparkles size={13} aria-hidden="true" /> Run anomaly analysis
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Efficiency ─── */}
      <section id="mf-perf-efficiency" className="space-y-4 scroll-mt-4" aria-labelledby="mf-eff-h">
        <h3 id="mf-eff-h" className="text-sm font-semibold text-gray-800">Milling efficiency <span className="text-xs font-normal text-gray-400">— {periodLabel || 'this period'}</span></h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* yield.v1 (D-14): Σ finished ÷ Σ raw over the period's completed
              company batches — weighted, service milling excluded. */}
          <Stat tone="green" icon={TrendingUp}    label="Recovery (weighted)" value={mk.production.yieldPct != null ? fmtPct(mk.production.yieldPct) : '—'} sub={`Σ finished ÷ Σ raw · ${periodLabel}`} />
          <Stat tone="red"   icon={AlertTriangle} label="Wastage (weighted)"  value={mk.production.wastagePct != null ? fmtPct(mk.production.wastagePct) : '—'}  sub="Σ waste ÷ Σ raw" />
          <Stat tone="blue"  icon={DollarSign}    label="Batch Cost / kg"     value={mk.production.batchCostPerKgPkr != null ? fmtPKR(mk.production.batchCostPerKgPkr, { decimals: 2 }) : '—'} sub="cost sheet ÷ sellable finished kg" />
          <Stat tone="slate" icon={Factory}       label="Batches"             value={mk.production.batchCount || 0} sub={`${fmtKg(mk.production.rawKg || 0)} processed`} />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Batch</th>
                <th className="text-right px-4 py-3 font-medium">Raw kg</th>
                <th className="text-right px-4 py-3 font-medium">Finished kg</th>
                <th className="text-right px-4 py-3 font-medium">Yield %</th>
                <th className="text-right px-4 py-3 font-medium">Wastage %</th>
                <th className="text-right px-4 py-3 font-medium">Cost/KG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {effBatches.map(b => {
                const raw = parseFloat(b.raw_qty_kg) || 0;
                const fin = parseFloat(b.actual_finished_kg) || 0;
                const costKg = fin > 0 ? (parseFloat(b.batch_cost_pkr) || 0) / fin : 0;
                const yieldPct = raw > 0 ? (fin / raw) * 100 : 0;
                const wastePct = raw > 0 ? ((parseFloat(b.wastage_kg) || 0) / raw) * 100 : 0;
                return (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td data-label="Batch" className="px-4 py-3 font-medium"><Link to={`/milling/${b.batch_no}`} className="text-blue-600">{b.batch_no}</Link></td>
                    <td data-label="Raw kg" className="mob-hide px-4 py-3 text-right tabular-nums">{fmtNum(Math.round(raw))}</td>
                    <td data-label="Finished kg" className="px-4 py-3 text-right tabular-nums">{fmtNum(Math.round(fin))}</td>
                    <td data-label="Yield %" className="px-4 py-3 text-right font-medium tabular-nums">{fmtPct(yieldPct)}</td>
                    <td data-label="Wastage %" className="px-4 py-3 text-right text-red-600 tabular-nums">{fmtPct(wastePct)}</td>
                    <td data-label="Cost/KG" className="px-4 py-3 text-right tabular-nums">{fmtPKR(costKg, { decimals: 2 })}</td>
                  </tr>
                );
              })}
              {effBatches.length === 0 && (
                <tr><td colSpan={6} className="colspan-empty px-4 py-10 text-center text-gray-400">No completed batches in {periodLabel || 'this period'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {effDetail && effDetail.total > effBatches.length && (
          <p className="text-[11px] text-amber-700">Showing the first {effBatches.length} of {effDetail.total} batches — the figures above cover all {effDetail.total}.</p>
        )}
      </section>

      {/* ─── Loss & theft ─── */}
      <section id="mf-perf-loss" className="space-y-4 scroll-mt-4" aria-labelledby="mf-loss-h">
        <h3 id="mf-loss-h" className="text-sm font-semibold text-gray-800">Loss &amp; theft flags</h3>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
          <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Batches flagged when actual output is more than 3% below expected. May indicate loss, theft, or measurement errors.</span>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Batch</th>
                <th className="text-right px-4 py-3 font-medium">Raw kg</th>
                <th className="text-right px-4 py-3 font-medium">Expected</th>
                <th className="text-right px-4 py-3 font-medium">Actual</th>
                <th className="text-right px-4 py-3 font-medium">Var kg</th>
                <th className="text-right px-4 py-3 font-medium">Var %</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lossData.map(b => (
                <tr key={b.id} className={`hover:bg-gray-50 ${b.flagged ? 'bg-red-50/50' : ''}`}>
                  <td data-label="Batch" className="px-4 py-3 font-medium"><Link to={`/milling/${b.id}`} className="text-blue-600">{b.id}</Link></td>
                  <td data-label="Raw kg" className="mob-hide px-4 py-3 text-right tabular-nums">{fmtNum(Math.round(b.rawQtyKg))}</td>
                  <td data-label="Expected" className="px-4 py-3 text-right tabular-nums">{fmtNum(Math.round(b.expected * 1000))}</td>
                  <td data-label="Actual" className="px-4 py-3 text-right tabular-nums">{fmtNum(Math.round(b.actualFinishedKg))}</td>
                  <td data-label="Var kg" className={`px-4 py-3 text-right font-medium tabular-nums ${b.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{b.variance > 0 ? '+' : ''}{fmtNum(Math.round(b.variance * 1000))}</td>
                  <td data-label="Var %" className={`px-4 py-3 text-right font-medium tabular-nums ${parseFloat(b.variancePct) < -3 ? 'text-red-600' : 'text-gray-600'}`}>{b.variancePct}%</td>
                  <td data-label="Status" className="px-4 py-3 text-center">
                    {b.flagged
                      ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[11px] font-medium">Investigate</span>
                      : <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[11px] font-medium">Normal</span>}
                  </td>
                </tr>
              ))}
              {lossData.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No completed batches yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
