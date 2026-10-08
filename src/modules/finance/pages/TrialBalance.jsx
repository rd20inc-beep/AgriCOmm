// Accounting › Trial balance — read-only view of
// GET /api/accounting/statements/trial-balance (Posted journals, cumulative to
// the end of the selected period). PKR only: the GL holds no other currency.
import { useTrialBalance } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useGlEntity, glParams, pkr } from '../utils/glStatements';
import {
  EntityFilter, PeriodLine, StatementHeader, BalancedBadge, StateBox,
} from '../components/GlStatementParts';

export default function TrialBalance() {
  const { queryParams: range } = useFinanceDateRange();
  const { entity, setEntity, apiEntity } = useGlEntity();
  const { data, isLoading, error } = useTrialBalance(glParams('asOf', range, apiEntity));
  return <TrialBalanceView data={data} isLoading={isLoading} error={error} entity={entity} onEntity={setEntity} asOf={range.to_date} />;
}

export function TrialBalanceView({ data, isLoading, error, entity, onEntity, asOf }) {
  const accounts = data?.accounts || [];
  const grandDebit = Number(data?.grandDebit) || 0;
  const grandCredit = Number(data?.grandCredit) || 0;
  return (
    <div className="print-report space-y-4 pb-4">
      <StatementHeader title="Trial balance">
        <PeriodLine mode="asOf" to={asOf} /> · PKR · Posted journals only
      </StatementHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EntityFilter entity={entity} onChange={onEntity} />
        {!isLoading && !error && data && (
          <BalancedBadge balanced={!!data.isBalanced} difference={grandDebit - grandCredit} />
        )}
      </div>
      <StateBox isLoading={isLoading} error={error} empty={accounts.length === 0}>
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Account</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {accounts.map((a) => {
                const bal = Number(a.balance) || 0;
                return (
                  <tr key={a.accountId || a.code}>
                    <td className="px-4 py-2 text-gray-500 tabular-nums">{a.code}</td>
                    <td className="px-2 py-2 text-gray-800">{a.name}</td>
                    <td className="px-2 py-2 text-gray-500">{a.type}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pkr(a.debitTotal)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pkr(a.creditTotal)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {pkr(Math.abs(bal))} <span className="text-[10px] text-gray-400">{bal >= 0 ? 'Dr' : 'Cr'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 font-semibold">
              <tr>
                <td className="px-4 py-2.5" colSpan={3}>Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums" data-testid="tb-debit">{pkr(grandDebit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums" data-testid="tb-credit">{pkr(grandCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </StateBox>
    </div>
  );
}
