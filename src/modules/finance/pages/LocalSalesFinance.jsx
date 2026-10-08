import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Store, TrendingUp, CheckCircle2, Clock, AlertCircle,
  Search, Download, ExternalLink, Eye, User, ShoppingCart, DollarSign, CheckCircle,
} from 'lucide-react';
import { FinanceKPI } from '../../../components/finance';
import { useLocalSales, useLocalSalesSummary, useReceivableReceipts } from '../../../api/queries';
import { useAuth } from '../../../context/AuthContext';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { canRecordVariant } from '../../../components/payments/paymentVariants';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { downloadCSV } from '../../../utils/csvExport';
import SlideDrawer from '../../../components/SlideDrawer';
import { paymentWord } from '../../localSales/utils/saleStatus';
import { todayLocalISO, fmtPKR, fmtKg, fmtNum, fmtPct, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import StatusBadge from '../../../shared/components/StatusBadge';
import { EmptyLine, InlineError } from '../components/FinanceUI';
import { btnPrimary, btnSecondary, btnIcon, th, tdMoney, errorText } from '../utils/uiClasses';

// Exact to the paisa — sale totals are reconciled line by line.
const fmtFull = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });
const methodLabel = (m) => ({ cash: 'Cash', bank_transfer: 'Bank Transfer', cheque: 'Cheque', lc: 'Letter of Credit', online: 'Online' }[m] || (m ? m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'));

export default function LocalSalesFinance() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: sales = [], isLoading, error, refetch } = useLocalSales(rangeParams);
  const { data: summary = {} } = useLocalSalesSummary();
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailSale, setDetailSale] = useState(null);
  // Where each payment was received (account/cash) + type, for the open sale.
  const { data: receiptData, isLoading: receiptsLoading } = useReceivableReceipts(detailSale?.id, 'local_sale', !!detailSale);
  // Receiving on one sale line is POST /local-sales/:id/payments through the
  // shared Payment form; the button asks what that route asks.
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const canReceive = canRecordVariant('receive_local_sale_line', hasPermission);

  function openDetail(s) { setDetailSale(s); }
  function receive(s) {
    drawers?.openPayment(null, {
      variant: 'receive_local_sale_line',
      ctx: {
        saleId: s.id, currency: 'PKR', outstanding: parseFloat(s.dueAmount) || 0,
        party: { type: 'customer', id: s.customerId, name: s.buyerName || s.customerName },
        ref: s.saleNo, collectionLocation: s.collectionLocation || 'Mill',
      },
      onDone: () => setDetailSale(null),
    });
  }

  const filtered = useMemo(() => {
    return sales.filter(s => {
      // Rejected (Cancelled) sales never happened — hidden unless asked for.
      if (statusFilter === 'Rejected') { if (s.status !== 'Cancelled') return false; }
      else if (s.status === 'Cancelled') return false;
      else if (statusFilter !== 'All' && paymentWord(s) !== statusFilter) return false;
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
      Status: paymentWord(s),
      Profit_PKR: Math.round(parseFloat(s.grossProfit || s.grossProfitPkr) || 0),
    }));
    downloadCSV(rows, `local-sales-${todayLocalISO()}.csv`);
  }

  return (
    <div className="space-y-5 pb-4">
      {/* ─── KPIs (the former hero repeated these four; its margin and
           sale count now sit under Gross Profit) ───────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Store} title="Revenue" value={fmtFull(filteredTotals.revenue)}
          subtitle={`This month: ${fmtFull(summary?.month?.total || 0)}`} status="info" loading={isLoading} />
        <FinanceKPI icon={CheckCircle2} title="Collected" value={fmtFull(filteredTotals.collected)}
          subtitle={filteredTotals.revenue > 0 ? `${Math.round(filteredTotals.collected / filteredTotals.revenue * 100)}% of revenue` : '—'}
          status="good" loading={isLoading} />
        <FinanceKPI icon={Clock} title="Outstanding" value={fmtFull(filteredTotals.outstanding)}
          subtitle={filteredTotals.outstanding > 0 ? 'Partial / Credit' : 'Fully collected'}
          status={filteredTotals.outstanding > 0 ? 'warning' : 'good'} loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Gross Profit (booked)" value={fmtFull(filteredTotals.profit)}
          subtitle={`${marginPct == null ? '—' : `${fmtPct(marginPct)} margin`} · ${filteredTotals.count} ${filteredTotals.count === 1 ? 'sale' : 'sales'} in view`}
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
        <div className="inline-flex flex-wrap bg-gray-100 rounded-lg p-0.5" role="group" aria-label="Payment status">
          {['All', 'Paid', 'Partial', 'Credit', 'Rejected'].map(s => (
            <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}
              className={`px-3 min-h-10 sm:min-h-8 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 tabular-nums">{filtered.length} of {sales.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={exportCsv} className={btnSecondary}>
            <Download size={14} aria-hidden="true" /> CSV
          </button>
          {/* Leaves Finance for the Local Sales module, so it is not this view's primary. */}
          <Link to="/local-sales" className={btnSecondary}>
            New sale <ExternalLink size={13} aria-label="leaves Finance" />
          </Link>
        </div>
      </div>

      {/* ─── Table ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className={`overflow-x-auto mobile-cards ${filtered.length > 15 ? 'md:max-h-[75vh] md:overflow-y-auto' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[['Sale'], ['Date'], ['Buyer'], ['Item / Lot'], ['Qty (kg)', 'text-right'], ['Revenue', 'text-right'], ['Collected', 'text-right'], ['Profit', 'text-right'], ['Status'], ['', 'w-10']].map(([label, extra = 'text-left'], i) => (
                  <th key={i} className={`${th} ${extra} md:sticky md:top-0 md:z-[1]`}>{label || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={10} className="px-4 py-4"><div className="space-y-2 animate-pulse" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 bg-gray-100 rounded" />)}</div></td></tr>
              ) : error ? (
                <tr><td colSpan={10} className="px-4 py-4"><InlineError message={errorText(error, 'Local sales')} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10}>
                  <EmptyLine icon={Store}>{sales.length === 0 ? 'No local sales recorded yet.' : 'No sales match the current filters.'}</EmptyLine>
                </td></tr>
              ) : filtered.map(s => {
                const word = paymentWord(s);
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td data-label="Sale" className="px-4 py-2.5 font-medium text-gray-900">
                      <Link to={`/local-sales/${s.id}`} className="text-blue-600 hover:underline">{s.saleNo}</Link>
                    </td>
                    <td data-label="Date" className="mob-hide px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(s.saleDate)}</td>
                    <td data-label="Buyer" className="px-4 py-2.5 text-gray-700 truncate max-w-[180px]" title={s.buyerName || undefined}>{s.buyerName || '—'}</td>
                    <td data-label="Item / Lot" className="px-4 py-2.5 text-xs">
                      <div className="font-medium text-gray-900">{s.itemName || '—'}</div>
                      {s.lotNo && <div className="text-gray-400">{s.lotNo}</div>}
                    </td>
                    <td data-label="Qty (kg)" className={`mob-hide px-4 py-2.5 ${tdMoney} text-gray-700`}>{fmtNum(Math.round(parseFloat(s.quantityKg) || 0))}</td>
                    <td data-label="Revenue" className={`px-4 py-2.5 ${tdMoney} font-medium text-gray-900`}>{fmtFull(s.totalAmount)}</td>
                    <td data-label="Collected" className={`mob-hide px-4 py-2.5 ${tdMoney} text-gray-700`}>{fmtFull(s.paidAmount)}</td>
                    <td data-label="Profit" className={`mob-hide px-4 py-2.5 ${tdMoney}`}>
                      <span className={(parseFloat(s.grossProfit || s.grossProfitPkr) || 0) >= 0 ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                        {fmtFull(s.grossProfit || s.grossProfitPkr)}
                      </span>
                    </td>
                    <td data-label="Status" className="px-4 py-2.5">
                      <StatusBadge status={word} />
                    </td>
                    <td data-label="Actions" className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => openDetail(s)} className={btnIcon} title="View details" aria-label={`View ${s.saleNo || 'sale'}`}>
                        <Eye size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale detail — right slide-over */}
      {detailSale && (() => {
        const s = detailSale;
        const due = parseFloat(s.dueAmount) || 0;
        const Row = ({ label, value }) => (
          <div className="flex justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-xs text-gray-500">{label}</span>
            <span className="text-sm font-medium text-gray-900 text-right">{value || '—'}</span>
          </div>
        );
        return (
          <SlideDrawer open={!!detailSale} onClose={() => setDetailSale(null)}
            title={s.saleNo || 'Sale'} subtitle={s.createdByName ? `Created by ${s.createdByName}` : undefined}
            icon={ShoppingCart} size="md"
            // Only a confirmed sale is owed anything — a Pending one takes its
            // receipt when confirmed, a Cancelled one never happened.
            footer={due > 0 && s.status === 'Completed' ? (
              canReceive ? (
                <div className="flex justify-end">
                  <button type="button" onClick={() => receive(s)} data-action="receive" className={`${btnPrimary} w-full sm:w-auto`}>
                    <DollarSign size={16} aria-hidden="true" /> Receive — {fmtFull(due)} due
                  </button>
                </div>
              ) : <p className="w-full text-center text-sm text-gray-500">{fmtFull(due)} due</p>
            ) : (
              <p className="w-full text-center text-sm text-gray-500 inline-flex items-center justify-center gap-1.5"><CheckCircle size={15} className="text-emerald-600" /> Paid in full</p>
            )}>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-lg p-2.5 text-center min-w-0"><p className="text-xs text-gray-500">Total</p><p className="text-sm font-bold text-gray-900 tabular-nums break-words">{fmtFull(s.totalAmount)}</p></div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center min-w-0"><p className="text-xs text-gray-500">Paid</p><p className="text-sm font-bold text-emerald-700 tabular-nums break-words">{fmtFull(s.paidAmount)}</p></div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center min-w-0"><p className="text-xs text-gray-500">Due</p><p className={`text-sm font-bold tabular-nums break-words ${due > 0 ? 'text-red-700' : 'text-gray-500'}`}>{fmtFull(due)}</p></div>
              </div>
              <div>
                <Row label="Date" value={fmtDate(s.saleDate)} />
                <Row label="Buyer" value={s.buyerName || s.customerName} />
                <Row label="Item" value={s.itemName} />
                {s.lotNo && <Row label="Lot" value={s.lotNo} />}
                <Row label="Qty" value={fmtKg(Math.round(parseFloat(s.quantityKg) || 0))} />
                <Row label="Rate" value={s.ratePerKg ? `${fmtFull(s.ratePerKg)}/kg` : '—'} />
                <Row label="Profit" value={fmtFull(s.grossProfit || s.grossProfitPkr)} />
                <Row label="Status" value={<StatusBadge status={paymentWord(s)} />} />
                <Row label="Created by" value={<span className="inline-flex items-center gap-1.5"><User size={13} className="text-gray-400" />{s.createdByName || '—'}</span>} />
                <Row label="Created at" value={fmtDateTime(s.createdAt)} />
              </div>

              {/* Payments received — where & how each came in. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Payments Received</h3>
                  {receiptData?.collectionLocation && (
                    <span className="text-xs text-gray-500">Collection: <span className="font-medium text-gray-700 capitalize">{receiptData.collectionLocation}</span></span>
                  )}
                </div>
                {receiptsLoading ? (
                  <p className="text-xs text-gray-400 py-1">Loading…</p>
                ) : (receiptData?.payments?.length ? (
                  <div className="space-y-2">
                    {receiptData.payments.map((p) => {
                      let into = [p.accountName, p.bankName].filter(Boolean).join(' · ');
                      if (!into) into = p.paymentMethod === 'cash' ? 'Cash (in hand)' : '—';
                      return (
                        <button type="button" key={p.id} onClick={() => drawers?.openTransaction?.('payment', p.id)} className="block w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:bg-blue-50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-emerald-700">{fmtFull(p.amount)}</span>
                            <span className="text-xs text-gray-500">{fmtDate(p.paymentDate)}</span>

                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            <span>Type: <span className="font-medium text-gray-700">{methodLabel(p.paymentMethod)}</span></span>
                            <span>Into: <span className="font-medium text-gray-700">{into}</span></span>
                            {p.bankReference && <span>Ref: <span className="font-medium text-gray-700">{p.bankReference}</span></span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-1">No payments recorded yet.</p>
                ))}
              </div>
            </div>
          </SlideDrawer>
        );
      })()}
    </div>
  );
}
