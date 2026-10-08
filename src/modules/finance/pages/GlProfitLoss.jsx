// Accounting › P&L — the company profit & loss from the general ledger,
// read-only over GET /api/accounting/statements/profit-loss (Posted journals
// dated inside the selected period). PKR only. This is the GL figure; the
// operational "Profit" view (orders / batches) is a separate screen.
import { useProfitLoss } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useGlEntity, glParams, pkr } from '../utils/glStatements';
import {
  EntityFilter, PeriodLine, StatementHeader, StateBox, AccountSection,
} from '../components/GlStatementParts';

export default function GlProfitLoss() {
  const { queryParams: range } = useFinanceDateRange();
  const { entity, setEntity, apiEntity } = useGlEntity();
  const { data, isLoading, error } = useProfitLoss(glParams('period', range, apiEntity));
  return <ProfitLossView data={data} isLoading={isLoading} error={error} entity={entity} onEntity={setEntity} from={range.from_date} to={range.to_date} />;
}

export function ProfitLossView({ data, isLoading, error, entity, onEntity, from, to }) {
  const revenue = data?.revenue || {};
  const cogs = data?.cogs || {};
  const expenses = data?.expenses || {};
  const empty = !(revenue.accounts?.length || cogs.accounts?.length || expenses.accounts?.length);
  const net = Number(data?.netProfit) || 0;
  return (
    <div className="print-report space-y-4 pb-4">
      <StatementHeader title="Profit & loss (general ledger)">
        <PeriodLine mode="period" from={from} to={to} /> · PKR · Posted journals only
      </StatementHeader>
      <EntityFilter entity={entity} onChange={onEntity} />
      <StateBox isLoading={isLoading} error={error} empty={empty}>
        <div className="space-y-3 max-w-3xl">
          <AccountSection title="Revenue" accounts={revenue.accounts} valueKey="amount" total={revenue.total} />
          <AccountSection title="Cost of goods sold" accounts={cogs.accounts} valueKey="amount" total={cogs.total} />
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm font-semibold">
            <span>Gross profit</span>
            <span className="tabular-nums" data-testid="pnl-gross">{pkr(data?.grossProfit)}</span>
          </div>
          <AccountSection title="Expenses" accounts={expenses.accounts} valueKey="amount" total={expenses.total} />
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-base font-bold ${net >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <span>{net >= 0 ? 'Net profit' : 'Net loss'}</span>
            <span className="tabular-nums" data-testid="pnl-net">{pkr(net)}</span>
          </div>
        </div>
      </StateBox>
    </div>
  );
}
