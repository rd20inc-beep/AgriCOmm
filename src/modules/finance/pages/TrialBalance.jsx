// Accounting › Trial balance — read-only view of
// GET /api/accounting/statements/trial-balance (Posted journals, cumulative to
// the end of the selected period). PKR only: the GL holds no other currency.
import { useTrialBalance } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useGlEntity, glParams, pkr } from '../utils/glStatements';
import {
  EntityFilter, PeriodLine, StatementHeader, BalancedBadge, StateBox,
} from '../components/GlStatementParts';
import { th, tdMoney } from '../utils/uiClasses';

/**
 * Every cash / bank account has its own GL account under 1000 Cash & Bank
 * (G-8). Show them as one group: a Cash & Bank subtotal row, then each
 * account indented (1000 itself, if it still carries lines, as "unassigned").
 * Pure; exported for tests.
 */
export function groupCashRows(accounts) {
  const isCash = (a) => a.parentCode === '1000' || a.code === '1000';
  const cash = accounts.filter(isCash);
  if (!cash.some((a) => a.parentCode === '1000')) return accounts.map((a) => ({ kind: 'row', a }));
  const sum = (k) => cash.reduce((t, a) => t + (Number(a[k]) || 0), 0);
  const group = { kind: 'group', code: '1000', name: 'Cash & Bank', debitTotal: sum('debitTotal'), creditTotal: sum('creditTotal'), balance: sum('balance') };
  const out = [];
  let placed = false;
  for (const a of accounts) {
    if (!isCash(a)) { out.push({ kind: 'row', a }); continue; }
    if (!placed) {
      out.push(group);
      for (const c of cash) out.push({ kind: 'row', a: c.code === '1000' ? { ...c, name: `${c.name} (unassigned)` } : c, child: true });
      placed = true;
    }
  }
  return out;
}

export default function TrialBalance() {
  const { queryParams: range } = useFinanceDateRange();
  const { entity, setEntity, apiEntity } = useGlEntity();
  const { data, isLoading, error, refetch } = useTrialBalance(glParams('asOf', range, apiEntity));
  return <TrialBalanceView data={data} isLoading={isLoading} error={error} onRetry={refetch} entity={entity} onEntity={setEntity} asOf={range.to_date} />;
}

export function TrialBalanceView({ data, isLoading, error, onRetry, entity, onEntity, asOf }) {
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
      <StateBox isLoading={isLoading} error={error} onRetry={onRetry} empty={accounts.length === 0}>
        {/* Cards on phones; on desktop the header row stays in view while the list scrolls. */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mobile-cards md:max-h-[75vh] md:overflow-y-auto" data-testid="tb-table">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[['Code', 'text-left'], ['Account', 'text-left'], ['Type', 'text-left'], ['Debit', 'text-right'], ['Credit', 'text-right'], ['Balance', 'text-right']].map(([label, align]) => (
                  <th key={label} className={`${th} ${align} md:sticky md:top-0 md:z-[1]`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {groupCashRows(accounts).map((r) => {
                if (r.kind === 'group') {
                  const gb = Number(r.balance) || 0;
                  return (
                    <tr key="group-1000" className="bg-gray-50 font-semibold" data-testid="tb-cash-group">
                      <td data-label="Code" className="px-4 py-2 text-gray-500 tabular-nums">{r.code}</td>
                      <td data-label="Account" className="px-4 py-2 text-gray-900">{r.name}</td>
                      <td data-label="Type" className="mob-hide px-4 py-2 text-gray-500">Asset</td>
                      <td data-label="Debit" className={`px-4 py-2 ${tdMoney}`}>{pkr(r.debitTotal)}</td>
                      <td data-label="Credit" className={`px-4 py-2 ${tdMoney}`}>{pkr(r.creditTotal)}</td>
                      <td data-label="Balance" className={`px-4 py-2 ${tdMoney} text-gray-900`}>
                        {pkr(Math.abs(gb))} <span className="text-xs text-gray-500">{gb >= 0 ? 'Dr' : 'Cr'}</span>
                      </td>
                    </tr>
                  );
                }
                const { a } = r;
                const bal = Number(a.balance) || 0;
                return (
                  <tr key={a.accountId || a.code}>
                    <td data-label="Code" className={`px-4 py-2 text-gray-500 tabular-nums${r.child ? ' md:pl-8' : ''}`}>{a.code}</td>
                    <td data-label="Account" className={`px-4 py-2 text-gray-800${r.child ? ' md:pl-8' : ''}`}>{a.name}</td>
                    <td data-label="Type" className="mob-hide px-4 py-2 text-gray-500">{a.type}</td>
                    <td data-label="Debit" className={`px-4 py-2 ${tdMoney}`}>{pkr(a.debitTotal)}</td>
                    <td data-label="Credit" className={`px-4 py-2 ${tdMoney}`}>{pkr(a.creditTotal)}</td>
                    <td data-label="Balance" className={`px-4 py-2 ${tdMoney} text-gray-900`}>
                      {pkr(Math.abs(bal))} <span className="text-xs text-gray-500">{bal >= 0 ? 'Dr' : 'Cr'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 font-semibold">
              <tr>
                <td className="px-4 py-2.5" colSpan={3}>Total</td>
                <td data-label="Total debit" className={`px-4 py-2.5 ${tdMoney}`} data-testid="tb-debit">{pkr(grandDebit)}</td>
                <td data-label="Total credit" className={`px-4 py-2.5 ${tdMoney}`} data-testid="tb-credit">{pkr(grandCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </StateBox>
    </div>
  );
}
