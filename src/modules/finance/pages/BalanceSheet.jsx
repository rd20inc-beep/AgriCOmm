// Accounting › Balance sheet — read-only over
// GET /api/accounting/statements/balance-sheet (Posted journals, as at the end
// of the selected period). PKR only. Current earnings = revenue − COGS −
// expenses not yet closed to equity, as the endpoint computes it.
import { useBalanceSheet } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useGlEntity, glParams, pkr } from '../utils/glStatements';
import {
  EntityFilter, PeriodLine, PeriodStatusBadge, StatementHeader, BalancedBadge, StateBox, AccountSection,
} from '../components/GlStatementParts';
import { ServerCsvButton } from '../../analytics/components/ReportChrome';

export default function BalanceSheet() {
  const { queryParams: range } = useFinanceDateRange();
  const { entity, setEntity, apiEntity } = useGlEntity();
  const params = glParams('asOf', range, apiEntity);
  const { data, isLoading, error, refetch } = useBalanceSheet(params);
  return <BalanceSheetView data={data} isLoading={isLoading} error={error} onRetry={refetch} entity={entity} onEntity={setEntity} asOf={range.to_date} csvParams={params} />;
}

export function BalanceSheetView({ data, isLoading, error, onRetry, entity, onEntity, asOf, csvParams }) {
  const assets = data?.assets || {};
  const liabilities = data?.liabilities || {};
  const equity = data?.equity || {};
  const totalAssets = Number(assets.total) || 0;
  const totalLE = Number(data?.totalLiabilitiesAndEquity) || 0;
  const empty = !(assets.accounts?.length || liabilities.accounts?.length || equity.accounts?.length);
  return (
    <div className="print-report space-y-4 pb-4">
      <StatementHeader title="Balance sheet">
        <PeriodLine mode="asOf" to={asOf} /> · PKR · Posted journals only{data?.periodStatus && <> · <PeriodStatusBadge status={data.periodStatus} /></>}
      </StatementHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EntityFilter entity={entity} onChange={onEntity} />
        <span className="inline-flex items-center gap-2">
          {!isLoading && !error && data && (
            <BalancedBadge balanced={!!data.isBalanced} difference={totalAssets - totalLE}
              label="Assets = Liabilities + Equity" />
          )}
          {csvParams && <ServerCsvButton endpoint="/api/accounting/statements/balance-sheet" params={csvParams} filename={`balance-sheet${asOf ? `_${asOf}` : ''}`} label="CSV" />}
        </span>
      </div>
      <StateBox isLoading={isLoading} error={error} onRetry={onRetry} empty={empty}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <AccountSection title="Assets" accounts={assets.accounts} valueKey="balance" total={totalAssets} />
          </div>
          <div className="space-y-3">
            <AccountSection title="Liabilities" accounts={liabilities.accounts} valueKey="balance" total={liabilities.total} />
            <AccountSection title="Equity" accounts={equity.accounts} valueKey="balance" total={equity.total} />
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm">
              <span>Current earnings (not yet closed to equity)</span>
              <span className="tabular-nums font-semibold">{pkr(data?.netIncome)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white border-2 border-gray-300 text-sm font-bold">
              <span>Total liabilities + equity</span>
              <span className="tabular-nums" data-testid="bs-le">{pkr(totalLE)}</span>
            </div>
          </div>
        </div>
      </StateBox>
    </div>
  );
}
