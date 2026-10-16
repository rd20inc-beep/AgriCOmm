import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Wallet, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMillCashFlow } from '../../../../../api/queries';
import { fmtDate, fmtMoney } from '../../../../../shared/utils/format';
import Stat from '../components/Stat';
import CashEntryDrawer from '../drawers/CashEntryDrawer';
import { PKR, COMPACT_PKR } from '../constants';
import { mfHref } from '../urlState';
import { historyRows, filterHistory, HISTORY_PAGE_SIZE } from './history';
import { useCompanyProfile } from '../../../../../shared/hooks/useMasterData';

const DIRS = [['all', 'All'], ['in', 'Money in'], ['out', 'Money out'], ['transfers', 'Transfers']];
const STATUSES = [['all', 'Any status'], ['settled', 'Settled'], ['pending', 'Uncleared / pending'], ['not_counted', 'Reversed / bounced']];

/**
 * Unified mill transaction history — every receipt, payment and Head Office ⇄
 * Mill transfer in the period, with entity, amount, currency, status, who
 * recorded it and who approved it, and the reference. Click a row for its
 * voucher / receipt.
 *
 * Source: the mill cash-flow ledger (GET /milling/cash-flow, mill_cash_flow.v1)
 * for the period — the same rows the totals are built from. It is filtered and
 * paged in the browser: there is no server-paged, searchable mill transaction
 * endpoint yet (noted in P5-09).
 */
export default function HistoryView({ period, go }) {
  const companyProfileData = useCompanyProfile();
  const [params] = useSearchParams();
  const dir = params.get('dir') || 'all';
  const status = params.get('status') || 'all';
  const q = params.get('q') || '';
  const [qDraft, setQDraft] = useState(q);
  const [pageState, setPageState] = useState({ key: '', page: 0 });
  const [entry, setEntry] = useState(null);
  const { data: cashFlow, isLoading } = useMillCashFlow({ period });

  const all = useMemo(() => historyRows(cashFlow?.ledger || []), [cashFlow]);
  const rows = useMemo(() => filterHistory(all, { dir, status, q }), [all, dir, status, q]);
  const summary = cashFlow?.summary || { cashIn: 0, cashOut: 0, net: 0, count: 0 };

  // Page resets whenever a filter changes (keyed, not an effect).
  const filterKey = `${period}|${dir}|${status}|${q}`;
  const page = pageState.key === filterKey ? pageState.page : 0;
  const pages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE));
  const shown = rows.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE);
  const setPage = (p) => setPageState({ key: filterKey, page: Math.min(Math.max(0, p), pages - 1) });
  const unfiltered = dir === 'all' && status === 'all' && !q;

  return (
    <div className="space-y-4" data-testid="mf-history">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Cash in (received)" value={PKR(summary.cashIn)} tone="green" icon={ArrowDownRight}
          sub={summary.pendingChequesIn ? `+ ${COMPACT_PKR(summary.pendingChequesIn)} in uncleared cheques` : 'settled receipts'}
          to={mfHref({ section: 'transactions', view: 'history', dir: 'in' }, period)} />
        <Stat label="Cash out (paid)" value={PKR(summary.cashOut)} tone="red" icon={ArrowUpRight}
          sub={summary.pendingChequesOut ? `+ ${COMPACT_PKR(summary.pendingChequesOut)} in uncleared cheques` : 'settled payments'}
          to={mfHref({ section: 'transactions', view: 'history', dir: 'out' }, period)} />
        <Stat label="Net cash flow" value={PKR(summary.net)} tone={summary.net >= 0 ? 'green' : 'red'} icon={Wallet}
          sub={`${summary.count} transaction(s)${summary.notMoneyCount ? ` · ${summary.notMoneyCount} reversed / bounced not counted` : ''}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter transactions">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {DIRS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={dir === k} onClick={() => go({ dir: k === 'all' ? null : k }, { replace: true })}
              className={`px-2.5 py-1 text-xs rounded-md ${dir === k ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>
        <select aria-label="Status" value={status} onChange={(e) => go({ status: e.target.value === 'all' ? null : e.target.value }, { replace: true })}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
          {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <form className="relative" onSubmit={(e) => { e.preventDefault(); go({ q: qDraft.trim() || null }, { replace: true }); }}>
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input type="search" aria-label="Search party, reference or category" value={qDraft} onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => { if (qDraft.trim() !== q) go({ q: qDraft.trim() || null }, { replace: true }); }}
            placeholder="Party, reference, category…" className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-56" />
        </form>
        <span className="text-[11px] text-gray-400 ml-auto">{rows.length} of {all.length} in this period</span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        {isLoading ? <div className="p-6 text-center text-sm text-gray-400">Loading…</div> : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No transactions match{unfiltered ? ' in this period' : ' these filters'}.</div>
        ) : (
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Entity</th>
                <th className="text-left font-medium px-3 py-2">Party / description</th>
                <th className="text-left font-medium px-3 py-2">Reference</th>
                <th className="text-right font-medium px-3 py-2">Amount</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Recorded / approved</th>
                {unfiltered && <th className="text-right font-medium px-3 py-2">Balance</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => (
                <tr key={`${r.direction}-${r.id}`} onClick={() => setEntry(r)} className="hover:bg-gray-50/60 cursor-pointer" title="View voucher / receipt">
                  <td data-label="Date" className="px-3 py-1.5 whitespace-nowrap text-gray-600">{fmtDate(r.payment_date)}</td>
                  <td data-label="Entity" className="mob-hide px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.entityLabel}</td>
                  <td data-label="Party" className="px-3 py-1.5">
                    <span className="text-gray-800">{r.counterparty || '—'}</span>
                    <span className="block text-[10px] text-gray-400">{r.category}{r.payment_method ? ` · ${r.payment_method}` : ''}</span>
                  </td>
                  <td data-label="Reference" className="mob-hide px-3 py-1.5 text-gray-500 text-xs">{r.ref || r.payment_no || '—'}</td>
                  <td data-label="Amount" className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${r.counted ? (r.direction === 'in' ? 'text-emerald-600' : 'text-red-600') : 'text-gray-400 line-through'}`}>
                    {r.direction === 'in' ? '+' : '−'}{fmtMoney(r.amountOriginal, r.currency, { decimals: 2 })}
                    {r.currency !== 'PKR' && <span className="block text-[10px] text-gray-400 no-underline">{PKR(r.amount_pkr)}</span>}
                  </td>
                  <td data-label="Status" className="px-3 py-1.5 text-xs text-gray-600">{r.statusLabel}</td>
                  <td data-label="By" className="mob-hide px-3 py-1.5 text-xs text-gray-500">
                    {r.recorded_by || '—'}
                    {r.approved_by && <span className="block text-[10px] text-gray-400">approved {r.approved_by}</span>}
                  </td>
                  {unfiltered && <td data-label="Balance" className={`px-3 py-1.5 text-right tabular-nums ${r.balance < 0 ? 'text-red-700' : 'text-gray-800'}`}>{PKR(r.balance)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-gray-600" aria-label="Pages">
          <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page"
            className="p-1 rounded border border-gray-200 disabled:opacity-40"><ChevronLeft size={14} aria-hidden="true" /></button>
          <span>Page {page + 1} of {pages}</span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page"
            className="p-1 rounded border border-gray-200 disabled:opacity-40"><ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        Settled money only is counted: a reversed or bounced payment and an uncleared cheque are listed, struck through, and left out of the totals.
        The balance is the running mill cash position over this period's rows.
      </p>

      <CashEntryDrawer entry={entry} companyProfile={companyProfileData} onClose={() => setEntry(null)} />
    </div>
  );
}
