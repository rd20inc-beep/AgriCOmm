import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Clock, DollarSign, ArrowRight, XCircle } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useReceivables, usePayables } from '../../../api/queries';

function formatCurrency(value, currency = 'USD') {
  if (!value || isNaN(value)) return '$0';
  if (currency === 'PKR') return 'Rs ' + Math.round(value).toLocaleString('en-PK');
  return '$' + parseFloat(value).toLocaleString('en-US');
}

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
    const collectionRate = totalExpected > 0 ? ((totalReceived / totalExpected) * 100).toFixed(1) : '0.0';

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
            <CheckCircle className="w-4 h-4 text-green-500" />
            <p className="text-xs font-medium text-gray-500">Fully Matched</p>
          </div>
          <p className="text-xl font-bold text-green-600">{kpis.fullyMatched}</p>
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
          <p className="text-xl font-bold text-gray-900">{formatCurrency(kpis.totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Collection Rate</p>
          <p className="text-xl font-bold text-green-600">{kpis.collectionRate}%</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <p className="text-xs font-medium text-gray-500">Overdue</p>
          </div>
          <p className="text-xl font-bold text-red-600">{formatCurrency(kpis.overdueAmount)}</p>
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
              <p className="text-sm font-bold text-gray-900">{formatCurrency(Math.round(amount))}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Order Payment Matching */}
      <div className="table-container">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Order Payment Matching</h2>
        </div>
        <div className="overflow-x-auto">
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
                  <td className="px-4 py-3">
                    <Link to={`/export/${r.orderId}`} className="font-medium text-blue-600 hover:text-blue-800">{r.orderId}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.customer}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(r.contractValue)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(r.advanceExpected)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={r.advanceMatched ? 'text-green-600 font-medium' : 'text-amber-600'}>
                      {formatCurrency(r.advanceReceived)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(r.balanceExpected)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={r.balanceMatched ? 'text-green-600 font-medium' : 'text-amber-600'}>
                      {formatCurrency(r.balanceReceived)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(r.outstanding)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.matchStatus === 'fully_matched' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3" /> Matched
                      </span>
                    )}
                    {r.matchStatus === 'partial' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <Clock className="w-3 h-3" /> Partial
                      </span>
                    )}
                    {r.matchStatus === 'pending' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        <XCircle className="w-3 h-3" /> Pending
                      </span>
                    )}
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
