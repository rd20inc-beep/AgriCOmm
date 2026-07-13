import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, AlertTriangle, CheckCircle } from 'lucide-react';
import { useUpcoming, useClearCheque } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';

const fmtPKR = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Format an amount in its own currency (USD export receivables vs PKR dues).
const CUR_SYMBOL = { USD: '$', PKR: 'Rs', EUR: '€' };
const fmtMoney = (n, cur) => `${CUR_SYMBOL[(cur || 'PKR').toUpperCase()] || (cur + ' ')}${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const isOverdue = (s) => s && new Date(s) < new Date(new Date().toDateString());

function List({ title, icon: Icon, tone, items, total, onClear, clearing }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-5 py-3 border-b border-gray-100 flex items-center justify-between ${tone === 'in' ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <div className="flex items-center gap-2">
          <Icon size={16} className={tone === 'in' ? 'text-emerald-600' : 'text-red-600'} />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-500">({items.length})</span>
        </div>
        <span className={`text-sm font-bold ${tone === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(total)}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">Nothing upcoming.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-100">
              <th className="py-2 px-4">Due</th><th className="py-2 px-4">Party</th>
              <th className="py-2 px-4">Type</th><th className="py-2 px-4 text-right">Amount</th><th className="py-2 px-4"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((x, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${isOverdue(x.dueDate) ? 'bg-red-50/40' : ''}`}>
                  <td className="py-2 px-4 whitespace-nowrap">
                    <span className={isOverdue(x.dueDate) ? 'text-red-600 font-medium' : 'text-gray-700'}>{fmtDate(x.dueDate)}</span>
                    {isOverdue(x.dueDate) && <span className="ml-1.5 text-[10px] text-red-500 inline-flex items-center gap-0.5"><AlertTriangle size={10} /> overdue</span>}
                  </td>
                  <td className="py-2 px-4 text-gray-900">
                    {x.partyId ? (
                      <Link to={`/finance/statements?type=${x.partyType}&id=${x.partyId}`}
                        className="text-blue-600 hover:underline font-medium">{x.party}</Link>
                    ) : x.party}
                  </td>
                  <td className="py-2 px-4">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${x.kind === 'cheque' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{x.label}</span>
                    {x.reference && <span className="ml-1.5 text-[11px] text-gray-400 font-mono">{x.reference}</span>}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums font-medium text-gray-900">
                    {fmtMoney(x.amount, x.currency)}
                    {x.currency && x.currency !== 'PKR' && x.amountPkr ? <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtPKR(x.amountPkr)}</span> : null}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {x.paymentId && (
                      <button onClick={() => onClear(x)} disabled={clearing}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded hover:bg-emerald-100 disabled:opacity-50">
                        <CheckCircle size={12} /> Mark cleared
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DueDates() {
  const { data, isLoading } = useUpcoming();
  const { addToast } = useApp();
  const clearMut = useClearCheque();
  const receiving = data?.receiving || [];
  const giving = data?.giving || [];

  async function onClear(x) {
    try {
      await clearMut.mutateAsync({ id: x.paymentId });
      addToast?.(`Cheque cleared — ${fmtMoney(x.amount, x.currency)} applied`, 'success');
    } catch (err) {
      addToast?.(err?.data?.message || err.message || 'Failed to clear cheque', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CalendarClock size={20} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Due Dates</h1>
          <p className="text-sm text-gray-500">Post-dated cheques &amp; credit (udhaar) dues — when money is expected or due.</p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <List title="Receiving (money in)" icon={ArrowDownLeft} tone="in" items={receiving} total={data?.totalReceiving || 0} onClear={onClear} clearing={clearMut.isPending} />
          <List title="Giving (money out)" icon={ArrowUpRight} tone="out" items={giving} total={data?.totalGiving || 0} onClear={onClear} clearing={clearMut.isPending} />
        </div>
      )}
    </div>
  );
}
