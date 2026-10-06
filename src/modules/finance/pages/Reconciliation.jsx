import { useMemo } from 'react';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import { CheckCircle, AlertTriangle, Clock, DollarSign, ArrowRight, XCircle } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useReceivables, usePayables } from '../../../api/queries';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtUSD, fmtPct, toNumber } from '../../../shared/utils/format';

// Export contracts are USD; missing values read as $0.00 like before.
const usd = (v) => fmtUSD(toNumber(v) ?? 0);

function getDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const diff = Math.floor((new Date() - new Date(dueDate)) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export default function Reconciliation() {
  const { exportOrders } = useApp();
  const { data: receivables = [] } = useReceivables();
  const { data: payables = [] } = usePayables();

  // Receivable reconciliation: match orders with payments
  const reconciliation = useMemo(() => {
    return exportOrders.map(order => {
      const totalExpected = order.contractValue || 0;
      const advanceExpected = order.advanceExpected || 0;
      const advanceReceived = order.advanceReceived || 0;
      const balanceExpected = order.balanceExpected || 0;
      const balanceReceived = order.balanceReceived || 0;
      const totalReceived = advanceReceived + balanceReceived;
      const outstanding = totalExpected - totalReceived;

      // Match status
      let matchStatus = 'pending';
      if (totalReceived >= totalExpected && totalExpected > 0) matchStatus = 'fully_matched';
      else if (totalReceived > 0 && totalReceived < totalExpected) matchStatus = 'partial';
      else if (totalExpected === 0) matchStatus = 'no_payment_expected';

      return {
        orderId: order.id,
        customer: order.customerName,
        country: order.country,
        status: order.status,
        contractValue: totalExpected,
        advanceExpected,
        advanceReceived,
        balanceExpected,
        balanceReceived,
        totalReceived,
        outstanding,
        matchStatus,
        advanceMatched: advanceReceived >= advanceExpected && advanceExpected > 0,
        balanceMatched: balanceReceived >= balanceExpected && balanceExpected > 0,
      };
    });
  }, [exportOrders]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const fullyMatched = reconciliation.filter(r => r.matchStatus === 'fully_matched').length;
    const partial = reconciliation.filter(r => r.matchStatus === 'partial').length;
    const pending = reconciliation.filter(r => r.matchStatus === 'pending').length;
    const totalOutstanding = reconciliation.reduce((s, r) => s + Math.max(0, parseFloat(r.outstanding) || 0), 0);
    const totalReceived = reconciliation.reduce((s, r) => s + (parseFloat(r.totalReceived) || 0), 0);
    const totalExpected = reconciliation.reduce((s, r) => s + (parseFloat(r.contractValue) || 0), 0);
    const collectionRate = totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0;

    // Overdue receivables
    const overdueReceivables = receivables.filter(r =>
      (r.status === 'Overdue' || r.status === 'overdue') && (parseFloat(r.outstanding) || 0) > 0
    );
    const overdueAmount = overdueReceivables.reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);

    // Overdue payables
    const overduePayables = payables.filter(p =>
      (p.status === 'Overdue' || p.status === 'overdue') && (parseFloat(p.outstanding) || 0) > 0
    );
    const overduePayableAmount = overduePayables.reduce((s, p) => s + (parseFloat(p.outstanding) || 0), 0);

    return {
      fullyMatched, partial, pending, totalOutstanding, collectionRate,
      overdueReceivableCount: overdueReceivables.length, overdueAmount,
      overduePayableCount: overduePayables.length, overduePayableAmount,
    };
  }, [reconciliation, receivables, payables]);

  // Aging buckets
  const agingBuckets = useMemo(() => {
    const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    receivables.forEach(r => {
      if ((parseFloat(r.outstanding) || 0) <= 0) return;
      const days = getDaysOverdue(r.dueDate);
      if (days === 0) buckets.current += r.outstanding;
      else if (days <= 30) buckets['1-30'] += r.outstanding;
      else if (days <= 60) buckets['31-60'] += r.outstanding;
      else if (days <= 90) buckets['61-90'] += r.outstanding;
      else buckets['90+'] += r.outstanding;
    });
    return buckets;
  }, [receivables]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Financial Reconciliation</h1>
        <p className="text-sm text-gray-500 mt-0.5">Receivable vs payment matching and aging analysis</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <p className="text-xs font-medium text-gray-500">Fully Matched</p>
          </div>
          <p className="text-xl font-bold text-emerald-600">{kpis.fullyMatched}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-medium text-gray-500">Partial</p>
          </div>
          <p className="text-xl font-bold text-amber-600">{kpis.partial}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-500" />
            <p className="text-xs font-medium text-gray-500">Pending</p>
          </div>
          <p className="text-xl font-bold text-red-600">{kpis.pending}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-blue-500" />
            <p className="text-xs font-medium text-gray-500">Outstanding</p>
          </div>
          <p className="text-xl font-bold text-gray-900">{usd(kpis.totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Collection Rate</p>
          <p className="text-xl font-bold text-emerald-600">{fmtPct(kpis.collectionRate)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <p className="text-xs font-medium text-gray-500">Overdue</p>
          </div>
          <p className="text-xl font-bold text-red-600">{usd(kpis.overdueAmount)}</p>
          <p className="text-xs text-gray-400">{kpis.overdueReceivableCount} items</p>
        </div>
      </div>

      {/* Aging Analysis */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Receivables Aging</h2>
        <div className="flex rounded-lg overflow-hidden h-10 mb-3">
          {Object.entries(agingBuckets).map(([bucket, amount]) => {
            const total = Object.values(agingBuckets).reduce((s, v) => s + v, 0);
            const pct = total > 0 ? (amount / total) * 100 : 0;
            if (pct === 0) return null;
            const colors = { current: '#22c55e', '1-30': '#eab308', '31-60': '#f97316', '61-90': '#ef4444', '90+': '#991b1b' };
            return (
              <div key={bucket} style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: colors[bucket] }}
                className="flex items-center justify-center text-white text-xs font-bold">
                {pct > 10 ? bucket : ''}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(agingBuckets).map(([bucket, amount]) => (
            <div key={bucket} className="text-center">
              <p className="text-xs font-medium text-gray-500">{bucket === 'current' ? 'Current' : `${bucket} days`}</p>
              <p className="text-sm font-bold text-gray-900">{usd(Math.round(amount))}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Order Payment Matching */}
      <div className="table-container">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Order Payment Matching</h2>
        </div>
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Order</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Contract</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Adv Expected</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Adv Received</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Bal Expected</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Bal Received</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Outstanding</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reconciliation.map(r => (
                <tr key={r.orderId} className={`hover:bg-gray-50 ${r.matchStatus === 'pending' ? 'bg-red-50/30' : ''}`}>
                  <td data-label="Order" className="px-4 py-3">
                    <OrderRefLink to={`/export/${r.orderId}`} module="export_orders" className="font-medium text-blue-600 hover:text-blue-800">{r.orderId}</OrderRefLink>
                  </td>
                  <td data-label="Customer" className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={r.customer}>{r.customer}</td>
                  <td data-label="Contract" className="px-4 py-3 text-right font-medium text-gray-900">{usd(r.contractValue)}</td>
                  <td data-label="Adv Expected" className="mob-hide px-4 py-3 text-right text-gray-600">{usd(r.advanceExpected)}</td>
                  <td data-label="Adv Received" className="px-4 py-3 text-right">
                    <span className={r.advanceMatched ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
                      {usd(r.advanceReceived)}
                    </span>
                  </td>
                  <td data-label="Bal Expected" className="mob-hide px-4 py-3 text-right text-gray-600">{usd(r.balanceExpected)}</td>
                  <td data-label="Bal Received" className="px-4 py-3 text-right">
                    <span className={r.balanceMatched ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
                      {usd(r.balanceReceived)}
                    </span>
                  </td>
                  <td data-label="Outstanding" className={`px-4 py-3 text-right font-semibold ${r.outstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {usd(r.outstanding)}
                  </td>
                  <td data-label="Match" className="px-4 py-3 text-center">
                    {r.matchStatus === 'fully_matched' && <StatusBadge status="Matched" />}
                    {r.matchStatus === 'partial' && <StatusBadge status="Partial" />}
                    {r.matchStatus === 'pending' && <StatusBadge status="Pending" />}
                    {r.matchStatus === 'no_payment_expected' && (
                      <span className="text-xs text-gray-400">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
