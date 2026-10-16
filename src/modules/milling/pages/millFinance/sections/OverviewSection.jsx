import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Factory, Wallet, Receipt, ArrowLeftRight, Inbox, Check,
  AlertTriangle, Landmark, Building2, ChevronRight, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import {
  useMillFinanceKpis, useMillCashFlow, useBankAccounts, useRecurringExpenses, useAcceptFundTransfer,
} from '../../../../../api/queries';
import { fmtPKR, fmtDate, fmtMoney } from '../../../../../shared/utils/format';
import Stat from '../components/Stat';
import { PKR, COMPACT_PKR } from '../constants';
import { mfHref } from '../urlState';
import { groupBalances } from '../balances';
import useMillFinancePerms from '../hooks/useMillFinancePerms';

const money = (amount, currency) => fmtMoney(amount, currency, { decimals: 2 });

function PositionCard({ title, icon: Icon, groups, to, linkLabel, note, testId }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide inline-flex items-center gap-1.5">{Icon && <Icon size={14} className="text-gray-400" aria-hidden="true" />} {title}</h3>
        {to && <Link to={to} className="text-[11px] font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5">{linkLabel} <ChevronRight size={12} aria-hidden="true" /></Link>}
      </div>
      {groups.length === 0 ? <p className="text-sm text-gray-400">{note || 'No accounts.'}</p> : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.currency}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium text-gray-500">{g.currency} · {g.accounts.length} account(s)</span>
                <span className={`text-lg font-semibold tabular-nums ${g.total < 0 ? 'text-red-700' : 'text-gray-900'}`}>{money(g.total, g.currency)}</span>
              </div>
              {g.accounts.length <= 4 && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.accounts.map((a) => (
                    <li key={a.id} className="flex justify-between text-[11px] text-gray-500">
                      <span className="truncate">{a.name}{a.type === 'cash' ? ' (cash)' : ''}</span>
                      <span className={`tabular-nums ${a.currentBalance < 0 ? 'text-red-600' : ''}`}>{money(a.currentBalance, g.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {note && groups.length > 0 && <p className="mt-2 text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}

/**
 * Mill Finance ▸ Overview — what needs attention, for the chosen period.
 * Four queries, all existing authoritative endpoints (KPIs, mill cash flow,
 * accounts, recurring schedule); every figure links to the list behind it.
 * No AI call here — anomaly analysis is an explicit action under Performance.
 */
export default function OverviewSection({ period }) {
  const { addToast } = useApp();
  const perms = useMillFinancePerms();
  const { data: kpi } = useMillFinanceKpis({ period });
  const { data: cashFlow } = useMillCashFlow({ period });
  const { data: accounts = [] } = useBankAccounts({ millOnly: !perms.canFinance });
  const { data: recurringData } = useRecurringExpenses();
  const acceptMut = useAcceptFundTransfer();

  const profit = kpi?.profit || {};
  const production = kpi?.production || {};
  const wc = kpi?.workingCapital || {};
  const balances = useMemo(() => groupBalances(accounts), [accounts]);
  const streams = cashFlow?.moneyOutStreams || [];
  const payablesOutstanding = streams.reduce((s, r) => s + (r.outstanding || 0), 0);
  const topStream = streams.slice().sort((a, b) => b.outstanding - a.outstanding)[0];
  const moneyIn = cashFlow?.moneyInSummary || { billed: 0, collected: 0, outstanding: 0 };
  const pendingTransfers = cashFlow?.pendingTransfers || [];
  const pendingTransfersTotal = cashFlow?.pendingTransfersTotal || 0;
  const summary = cashFlow?.summary || {};
  const millCashBalance = cashFlow?.millCashBalance || 0;
  const recurringDue = (recurringData?.recurring || []).filter((r) => r.due).length;
  const margin = profit.marginPct != null ? profit.marginPct.toFixed(1) : '0.0';
  const href = (next) => mfHref(next, period);

  async function accept(t) {
    try { await acceptMut.mutateAsync(t.id); addToast(`Accepted ${PKR(t.amount)} from Head Office`, 'success'); }
    catch (e) { addToast(e?.response?.data?.message || e?.message || 'Could not accept the transfer.', 'error'); }
  }

  const exceptions = [
    pendingTransfers.length > 0 && { key: 'transfers', tone: 'amber', text: `${pendingTransfers.length} fund transfer(s) from Head Office awaiting acceptance — ${PKR(pendingTransfersTotal)}`, to: '#mf-pending-transfers', anchor: true },
    millCashBalance < 0 && { key: 'overdrawn', tone: 'red', text: `Mill Cash is overdrawn by ${PKR(-millCashBalance)} — Head Office needs to fund it`, to: href({ section: 'transactions', view: 'history' }) },
    profit.uncostedCount > 0 && { key: 'uncosted', tone: 'amber', text: `${profit.uncostedCount} sale(s) / transfer(s) of mill output have no cost yet — ${PKR(profit.uncostedRevenuePkr)} left out of profit`, to: href({ section: 'performance' }) },
    profit.overheadsUnconvertedCount > 0 && { key: 'fx', tone: 'amber', text: `${profit.overheadsUnconvertedCount} foreign-currency overhead(s) have no PKR figure and are not counted`, to: href({ section: 'transactions', view: 'expenses' }) },
    wc.unpricedLots > 0 && { key: 'unpriced', tone: 'amber', text: `${wc.unpricedLots} lot(s) have no cost — valued at 0 in working capital`, to: href({ section: 'performance' }) },
    recurringDue > 0 && { key: 'recurring', tone: 'amber', text: `${recurringDue} recurring expense(s) due to post`, to: href({ section: 'transactions', view: 'recurring' }) },
    summary.pendingChequeCount > 0 && { key: 'cheques', tone: 'slate', text: `${summary.pendingChequeCount} uncleared cheque(s) in this period — not yet money`, to: href({ section: 'transactions', view: 'history', status: 'pending' }) },
  ].filter(Boolean);

  return (
    <div className="space-y-5" data-testid="mf-overview">
      <p className="text-[11px] text-gray-500">
        {kpi?.period?.label || '…'}{kpi?.period?.from ? ` (${fmtDate(kpi.period.from)} – ${fmtDate(kpi.period.to)})` : ''} · PKR unless shown · stock as of {kpi?.asOf ? fmtDate(kpi.asOf) : '—'}
      </p>

      {/* Mill profit (net) — D-13 headline, mill_profit.v1, for the period. */}
      <Link to={href({ section: 'performance' })} data-testid="mill-profit-headline-tile"
        className="block rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-700 p-5 text-white shadow-sm hover:shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-80 mb-1">
          <Factory size={13} aria-hidden="true" /> Mill profit (net) · {kpi?.period?.label || '…'}
        </div>
        <div className="text-3xl font-bold leading-tight tabular-nums" data-testid="mill-profit-headline">
          {kpi ? COMPACT_PKR(profit.netProfitPkr) : '—'}
        </div>
        <div className="text-xs opacity-90 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            {(profit.netProfitPkr || 0) >= 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />} margin {margin}%
          </span>
          <span>Sales {COMPACT_PKR(profit.revenuePkr)}</span>
          <span>COGS {COMPACT_PKR(profit.cogsPkr)}</span>
          <span>Overheads {COMPACT_PKR(profit.overheadsPkr)}</span>
          <span className="ml-auto inline-flex items-center gap-0.5 font-medium">How it is made <ChevronRight size={12} aria-hidden="true" /></span>
        </div>
      </Link>

      {/* Cash & bank position — Mill and Head Office apart, one currency at a time. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PositionCard title="Mill — cash & bank" icon={Factory} groups={balances.mill} testId="mf-position-mill"
          to={href({ section: 'transactions', view: 'history' })} linkLabel="Transactions"
          note={pendingTransfers.length ? `${PKR(pendingTransfersTotal)} from Head Office not yet accepted — not in these balances.` : null} />
        {perms.canFinance ? (
          <PositionCard title="Head Office — cash & bank" icon={Building2} groups={balances.general} testId="mf-position-ho"
            to="/finance/accounts" linkLabel="Accounts" />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-sm text-gray-400" data-testid="mf-position-ho">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide inline-flex items-center gap-1.5 mb-1"><Building2 size={14} aria-hidden="true" /> Head Office</h3>
            Head Office balances are visible to Finance only.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat testId="tile-payables" tone="amber" icon={Wallet} label="Mill payables outstanding" value={PKR(payablesOutstanding)}
          sub={topStream ? `largest: ${topStream.stream} ${COMPACT_PKR(topStream.outstanding)}` : 'nothing owed'}
          to={href({ section: 'transactions', view: 'payables' })} />
        <Stat testId="tile-expenses" tone="red" icon={TrendingDown} label="Mill operating expenses" value={PKR(profit.overheadsPkr)}
          sub={`${profit.overheadCount || 0} expense(s) this period`}
          to={href({ section: 'transactions', view: 'expenses' })} />
        <Stat testId="tile-batch-cost" tone="slate" icon={Factory} label="Milling / batch cost" value={PKR(production.batchCostPkr)}
          sub={`${production.batchCount || 0} batch(es) · ${production.batchCostPerKgPkr != null ? `${fmtPKR(production.batchCostPerKgPkr, { decimals: 2 })}/kg` : '—/kg'}`}
          to={href({ section: 'performance', focus: 'efficiency' })} />
        <Stat testId="tile-receivables" tone="blue" icon={Receipt} label="Local-sale receivables" value={PKR(moneyIn.outstanding)}
          sub={`${COMPACT_PKR(moneyIn.collected)} collected of ${COMPACT_PKR(moneyIn.billed)} billed`}
          to={href({ section: 'parties', party: 'customers' })} />
        <Stat testId="tile-transfers" tone={pendingTransfers.length ? 'amber' : 'green'} icon={ArrowLeftRight} label="Transfers awaiting acceptance"
          value={pendingTransfers.length ? PKR(pendingTransfersTotal) : 'None'}
          sub={pendingTransfers.length ? `${pendingTransfers.length} from Head Office` : 'all transfers settled'}
          to={href({ section: 'transactions', view: 'history', dir: 'transfers' })} />
      </div>

      {/* Exceptions needing action */}
      <div className="rounded-xl border border-gray-200 bg-white" data-testid="mf-exceptions">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-500" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-gray-800">Needs action</h3>
          <span className="text-xs text-gray-400">{exceptions.length || 'nothing'}</span>
        </div>
        {exceptions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-emerald-700">Nothing needs attention for this period.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {exceptions.map((x) => (
              <li key={x.key}>
                {x.anchor
                  ? <a href={x.to} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-gray-50"><span className={x.tone === 'red' ? 'text-red-700' : 'text-gray-700'}>{x.text}</span><ChevronRight size={14} className="text-gray-400 shrink-0" aria-hidden="true" /></a>
                  : <Link to={x.to} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-gray-50"><span className={x.tone === 'red' ? 'text-red-700' : 'text-gray-700'}>{x.text}</span><ChevronRight size={14} className="text-gray-400 shrink-0" aria-hidden="true" /></Link>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingTransfers.length > 0 && (
        <div id="mf-pending-transfers" className="rounded-xl border border-amber-300 bg-amber-50 p-4 no-print">
          <div className="flex items-center gap-2 mb-3">
            <Inbox className="w-5 h-5 text-amber-600 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-amber-900">{pendingTransfers.length} fund transfer{pendingTransfers.length === 1 ? '' : 's'} from Head Office awaiting acceptance</p>
              <p className="text-xs text-amber-700">Total {PKR(pendingTransfersTotal)} — accepting adds it to Mill Cash.{!perms.canAcceptTransfer ? ' Accepting needs mill edit permission.' : ''}</p>
            </div>
          </div>
          <div className="space-y-2">
            {pendingTransfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2 flex-wrap">
                <div className="text-xs text-gray-700 min-w-0">
                  <span className="font-semibold text-gray-900">{t.transferNo}</span> · <span className="font-medium">{PKR(t.amount)}</span>
                  {t.date && <> · {fmtDate(t.date)}</>}
                  <span className="text-gray-400"> · from {t.fromAccount || 'Head Office'} → {t.toAccount || 'Mill Cash'}</span>
                  {t.reference && <span className="text-gray-400"> · Ref {t.reference}</span>}
                </div>
                {perms.canAcceptTransfer && (
                  <button onClick={() => accept(t)} disabled={acceptMut.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0">
                    <Check size={13} aria-hidden="true" /> {acceptMut.isPending ? 'Accepting…' : 'Accept funds'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat tone="green" icon={TrendingUp} label="Cash in (period)" value={PKR(summary.cashIn)} sub="settled receipts + accepted transfers"
          to={href({ section: 'transactions', view: 'history', dir: 'in' })} />
        <Stat tone="red" icon={TrendingDown} label="Cash out (period)" value={PKR(summary.cashOut)} sub="settled payments + transfers sent"
          to={href({ section: 'transactions', view: 'history', dir: 'out' })} />
        <Stat tone="purple" icon={Landmark} label="Working capital" value={PKR(wc.totalPkr)} sub="mill stock at landed cost"
          to={href({ section: 'performance', focus: 'stock' })} />
      </div>
    </div>
  );
}
