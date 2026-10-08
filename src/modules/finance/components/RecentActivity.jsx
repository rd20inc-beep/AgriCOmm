import { Activity, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { usePayments } from '../../../api/queries';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { fmtAmt } from '../drawers/drawerLogic';

/**
 * Home ▸ Recent activity — the last money movements (GET /finance/payments,
 * newest first), each in its own currency; a row opens the Transaction drawer.
 */
export default function RecentActivity({ rangeParams = {} }) {
  const drawers = useFinanceDrawers();
  const { data, isLoading } = usePayments({ ...rangeParams, limit: 8 });
  const rows = (data?.payments || []).slice(0, 8);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="recent-activity">
      <div className="flex items-center gap-2 mb-3">
        <Activity size={16} className="text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-900">Recent activity</h3>
      </div>
      {isLoading ? <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        : !rows.length ? <p className="text-sm text-gray-400 text-center py-6">No money has moved yet.</p>
        : (
          <ul className="divide-y divide-gray-100">
            {rows.map((p) => {
              const isIn = p.type === 'receipt';
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => drawers?.openTransaction?.('payment', p.id)}
                    className="w-full py-2 flex items-center gap-2 text-left hover:bg-gray-50 rounded">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isIn ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      {isIn ? <ArrowDownLeft size={13} className="text-emerald-600" /> : <ArrowUpRight size={13} className="text-red-600" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-800 truncate">{p.counterparty || '—'}</span>
                      <span className="block text-[11px] text-gray-400 truncate">{p.paymentNo}{p.sourceRef ? ` · ${p.sourceRef}` : ''} · {fmtDate(p.paymentDate)}</span>
                    </span>
                    {p.status === 'Reversed' ? <StatusBadge status="Reversed" />
                      : p.cleared === false ? <StatusBadge status="Uncleared" /> : null}
                    <span className={`text-sm font-semibold tabular-nums ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>{fmtAmt(p.amount, p.currency)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
