import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Store, TrendingUp, CheckCircle2, Clock, AlertCircle,
  Search, Download, ExternalLink,
} from 'lucide-react';
import { FinanceKPI } from '../../../components/finance';
import { useLocalSales, useLocalSalesSummary } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { downloadCSV } from '../../../utils/csvExport';

function fmtPKR(n) {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 10_000_000) return `Rs ${(v / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100_000) return `Rs ${(v / 100_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(v).toLocaleString()}`;
}
const fmtFull = (n) => `Rs ${Math.round(parseFloat(n) || 0).toLocaleString()}`;
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const STATUS_TONE = {
  Paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  Partial:  'bg-amber-50 text-amber-700 border-amber-200',
  Pending:  'bg-gray-50 text-gray-600 border-gray-200',
  Credit:   'bg-blue-50 text-blue-700 border-blue-200',
  Refunded: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function LocalSalesFinance() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: sales = [], isLoading } = useLocalSales(rangeParams);
  const { data: summary = {} } = useLocalSalesSummary();
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    return sales.filter(s => {
      if (statusFilter !== 'All' && String(s.paymentStatus || '').toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        if (!(
          (s.saleNo || '').toLowerCase().includes(t) ||
          (s.buyerName || '').toLowerCase().includes(t) ||
          (s.itemName || '').toLowerCase().includes(t) ||
          (s.lotNo || '').toLowerCase().includes(t)
        )) return false;
      }
      return true;
    });
  }, [sales, statusFilter, searchTerm]);

  const filteredTotals = useMemo(() => {
    const out = { revenue: 0, collected: 0, outstanding: 0, profit: 0, count: filtered.length };
    for (const s of filtered) {
      const total = parseFloat(s.totalAmount) || 0;
      const paid  = parseFloat(s.paidAmount) || 0;
      out.revenue     += total;
      out.collected   += paid;
      out.outstanding += Math.max(0, total - paid);
      out.profit      += parseFloat(s.grossProfit || s.grossProfitPkr) || 0;
    }
    return out;
  }, [filtered]);

  const marginPct = filteredTotals.revenue > 0
    ? (filteredTotals.profit / filteredTotals.revenue) * 100
    : null;

  const heroGradient = filteredTotals.profit >= 0
    ? 'from-purple-700 via-fuchsia-600 to-pink-500'
    : 'from-red-700 via-red-600 to-rose-500';

  function exportCsv() {
    const rows = filtered.map(s => ({
      Sale_No: s.saleNo || '',
      Date: s.saleDate || '',
      Buyer: s.buyerName || '',
      Lot: s.lotNo || '',
      Item: s.itemName || '',
      Qty_KG: s.quantityKg || '',
      Total_PKR: Math.round(parseFloat(s.totalAmount) || 0),
      Paid_PKR: Math.round(parseFloat(s.paidAmount) || 0),
      Due_PKR: Math.round(parseFloat(s.dueAmount) || 0),
      Status: s.paymentStatus || '',
      Profit_PKR: Math.round(parseFloat(s.grossProfit || s.grossProfitPkr) || 0),
    }));
    downloadCSV(rows, `local-sales-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 25% 30%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Store size={14} /> Local sales — Booked profit
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPKR(filteredTotals.profit)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              Revenue {fmtPKR(filteredTotals.revenue)} · Collected {fmtPKR(filteredTotals.collected)}
              {filteredTotals.outstanding > 0 && <> · Outstanding {fmtPKR(filteredTotals.outstanding)}</>}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/30">
              <TrendingUp size={12} /> Margin {marginPct == null ? '—' : `${marginPct.toFixed(1)}%`}
            </span>
            <div className="opacity-80 text-right">
              {filteredTotals.count} {filteredTotals.count === 1 ? 'sale' : 'sales'} in view
            </div>
          </div>
        </div>
      </div>

      {/* ─── KPIs ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Store} title="Revenue" value={fmtPKR(filteredTotals.revenue)}
          subtitle={`This month: ${fmtPKR(summary?.month?.total || 0)}`} status="info" loading={isLoading} />
        <FinanceKPI icon={CheckCircle2} title="Collected" value={fmtPKR(filteredTotals.collected)}
          subtitle={filteredTotals.revenue > 0 ? `${Math.round(filteredTotals.collected / filteredTotals.revenue * 100)}% of revenue` : '—'}
          status="good" loading={isLoading} />
        <FinanceKPI icon={Clock} title="Outstanding" value={fmtPKR(filteredTotals.outstanding)}
          subtitle={filteredTotals.outstanding > 0 ? 'Pending / Partial / Credit' : 'Fully collected'}
          status={filteredTotals.outstanding > 0 ? 'warning' : 'good'} loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Gross Profit" value={fmtPKR(filteredTotals.profit)}
          subtitle={marginPct == null ? '—' : `${marginPct.toFixed(1)}% margin`}
          status={filteredTotals.profit >= 0 ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* ─── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search sale no / buyer / lot / item…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-900"
          />
        </div>
        <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
          {['All', 'Paid', 'Partial', 'Pending', 'Credit', 'Refunded'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{filtered.length} of {sales.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <Download size={14} /> CSV
          </button>
          <Link to="/local-sales"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            New sale <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* ─── Table ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Item / Lot</th>
                <th className="px-4 py-3 text-right">Qty (kg)</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">Loading sales…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">
                  {sales.length === 0 ? 'No local sales recorded yet.' : 'No sales match the current filters.'}
                </td></tr>
              ) : filtered.map(s => {
                const tone = STATUS_TONE[s.paymentStatus] || STATUS_TONE.Pending;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      <Link to={`/local-sales/${s.id}`} className="text-blue-600 hover:underline">{s.saleNo}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(s.saleDate)}</td>
                    <td className="px-4 py-2.5 text-gray-700 truncate max-w-[180px]">{s.buyerName || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="font-medium text-gray-900">{s.itemName || '—'}</div>
                      {s.lotNo && <div className="text-gray-400">{s.lotNo}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{Math.round(parseFloat(s.quantityKg) || 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900">{fmtFull(s.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{fmtFull(s.paidAmount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={(parseFloat(s.grossProfit || s.grossProfitPkr) || 0) >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                        {fmtFull(s.grossProfit || s.grossProfitPkr)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${tone}`}>
                        {s.paymentStatus || 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
