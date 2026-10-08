import { Activity, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { usePayments } from '../../../api/queries';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { fmtAmt } from '../drawers/drawerLogic';
import { Section, EmptyLine, InlineError } from './FinanceUI';
import { errorText } from '../utils/uiClasses';

/**
 * Home ▸ Recent activity — the last money movements (GET /finance/payments,
 * newest first), each in its own currency; a row opens the Transaction drawer.
 * Direction shows as an arrow and a word ("In" / "Out") as well as colour.
 */
export default function RecentActivity({ rangeParams = {} }) {
  const drawers = useFinanceDrawers();
  const { data, isLoading, error, refetch } = usePayments({ ...rangeParams, limit: 8 });
  const rows = (data?.payments || []).slice(0, 8);
  return (
    <Section title="Recent activity" icon={Activity} testId="recent-activity">
      {isLoading ? (
        <div className="space-y-2 animate-pulse" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-gray-100 rounded-lg" />)}
        </div>
      ) : error ? <InlineError message={errorText(error, 'Recent activity')} onRetry={refetch} />
        : !rows.length ? <EmptyLine icon={Activity}>No money has moved in this period.</EmptyLine>
        : (
          <ul className="divide-y divide-gray-100">
            {rows.map((p) => {
              const isIn = p.type === 'receipt';
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => drawers?.openTransaction?.('payment', p.id)}
                    className="w-full py-2.5 min-h-11 flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isIn ? 'bg-emerald-50' : 'bg-red-50'}`} aria-hidden="true">
                      {isIn ? <ArrowDownLeft size={14} className="text-emerald-600" /> : <ArrowUpRight size={14} className="text-red-600" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-800 truncate">{p.counterparty || '—'}</span>
                      <span className="block text-xs text-gray-500 truncate">{isIn ? 'In' : 'Out'} · {p.paymentNo}{p.sourceRef ? ` · ${p.sourceRef}` : ''} · {fmtDate(p.paymentDate)}</span>
                    </span>
                    {p.status === 'Reversed' ? <StatusBadge status="Reversed" />
                      : p.cleared === false ? <StatusBadge status="Uncleared" /> : null}
                    <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>{fmtAmt(p.amount, p.currency)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </Section>
  );
}
