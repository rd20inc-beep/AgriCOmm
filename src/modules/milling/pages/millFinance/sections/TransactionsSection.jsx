import HistoryView from '../transactions/HistoryView';
import PayablesView from '../transactions/PayablesView';
import ExpensesView from '../transactions/ExpensesView';
import RecurringView from '../transactions/RecurringView';
import LotCostsView from '../transactions/LotCostsView';

const VIEWS = [
  ['history', 'History'],
  ['payables', 'Payables'],
  ['expenses', 'Expenses'],
  ['recurring', 'Recurring'],
  ['lotcosts', 'Lot costs'],
];

/**
 * Mill Finance ▸ Transactions — the money that moved (History) and the money
 * still owed (Payables), the expense register, recurring schedules and lot
 * additional costs. One view at a time, so only its query runs.
 */
export default function TransactionsSection({ view, cat, period, go }) {
  return (
    <div className="space-y-4" data-testid="mf-transactions">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Transaction views">
        {VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k}
            onClick={() => go({ view: k, cat: null, dir: null, status: null, q: null })}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${view === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {l}
          </button>
        ))}
      </div>
      {view === 'history' && <HistoryView period={period} go={go} />}
      {view === 'payables' && <PayablesView period={period} />}
      {view === 'expenses' && <ExpensesView period={period} cat={cat} />}
      {view === 'recurring' && <RecurringView />}
      {view === 'lotcosts' && <LotCostsView />}
    </div>
  );
}
