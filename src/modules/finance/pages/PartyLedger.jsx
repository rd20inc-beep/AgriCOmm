import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, BookUser, Scale, ArrowDownLeft, ArrowUpRight, Printer, FileText, Wallet, HandCoins } from 'lucide-react';
import { FinanceKPI } from '../../../components/finance';
import StatementPayDrawer from '../components/StatementPayDrawer';
import SearchSelect from '../../../shared/components/SearchSelect';
import LedgerTypeCounts from '../../milling/components/LedgerTypeCounts';
import PartyAllocationLedger from '../../milling/components/PartyAllocationLedger';
import OpenItemsPanel from '../../milling/components/OpenItemsPanel';
import { accountingApi } from '../../accounting/api/services';
import { useCustomers, useSuppliers } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';

// Statements are shown in the party's transaction currency (export parties are
// USD; mill/local are PKR), as returned by the backend's `currency` field.
function curSymbol(cur) {
  const c = (cur || 'PKR').toUpperCase();
  return c === 'PKR' ? 'Rs ' : c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'AED' ? 'AED ' : `${c} `;
}
function fmtCur(v, cur) {
  const n = parseFloat(v) || 0;
  return `${curSymbol(cur)}${Math.round(n).toLocaleString()}`;
}
function fmtCurSigned(v, cur) {
  const n = parseFloat(v) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}${curSymbol(cur)}${Math.round(Math.abs(n)).toLocaleString()}`;
}
function fmtCurCompact(v, cur) {
  const n = parseFloat(v) || 0;
  const s = curSymbol(cur);
  if ((cur || 'PKR').toUpperCase() === 'PKR') {
    // Pakistani Crore / Lakh shorthand for the base currency.
    if (Math.abs(n) >= 10_000_000) return `${s}${(n / 10_000_000).toFixed(2)}Cr`;
    if (Math.abs(n) >= 100_000) return `${s}${(n / 100_000).toFixed(2)}L`;
    if (Math.abs(n) >= 1_000) return `${s}${(n / 1_000).toFixed(0)}K`;
    return `${s}${Math.round(n).toLocaleString()}`;
  }
  if (Math.abs(n) >= 1_000_000) return `${s}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${s}${(n / 1_000).toFixed(1)}K`;
  return `${s}${Math.round(n).toLocaleString()}`;
}

const refLink = (refNo) => {
  if (!refNo) return null;
  if (refNo.startsWith('EX-')) return `/export/${refNo}`;
  if (refNo.startsWith('M-')) return `/milling/${refNo}`;
  return null;
};

export default function PartyLedger() {
  const { companyProfileData } = useApp();
  const { queryParams: rangeParams } = useFinanceDateRange();
  // Mode + selected party live in the URL (?type=customer|supplier&id=123)
  // so other pages can deep-link straight to a party's ledger.
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('type') === 'supplier' ? 'supplier' : 'customer';
  const partyId = searchParams.get('id') || '';
  // When the mill links in with ?scope=local, the customer dropdown is limited
  // to local-sales customers (export buyers stay hidden from the mill).
  const scope = searchParams.get('scope') === 'local' ? 'local' : null;
  const [payOpen, setPayOpen] = useState(false);
  const [view, setView] = useState('statement'); // 'statement' | 'allocation'

  // Merge a patch into the query string, preserving unrelated params
  // (e.g. FinanceLayout's ?range=). Null/'' values delete the key.
  const updateParams = (patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v) next.set(k, v); else next.delete(k);
      });
      return next;
    }, { replace: true });
  };

  const { data: customers = [], isLoading: custLoading } = useCustomers(scope === 'local' ? { type: 'local' } : {});
  const { data: suppliers = [], isLoading: suppLoading } = useSuppliers();
  const parties = mode === 'customer' ? customers : suppliers;
  const partiesLoading = mode === 'customer' ? custLoading : suppLoading;
  const selectedParty = parties.find((p) => String(p.id) === String(partyId));
  // Options for the searchable picker — country/location shown as the sub-label
  // so it's searchable too.
  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, sub: p.country || p.location || '' })),
    [parties],
  );

  // date_from / date_to come from the shared finance date-range selector
  const stmtParams = useMemo(() => {
    const p = {};
    if (rangeParams?.from_date) p.date_from = rangeParams.from_date;
    if (rangeParams?.to_date) p.date_to = rangeParams.to_date;
    return p;
  }, [rangeParams]);

  const { data: statement, isLoading: stmtLoading, isError, error } = useQuery({
    queryKey: ['party-statement', mode, partyId, stmtParams],
    enabled: !!partyId,
    queryFn: async () => {
      const fn = mode === 'customer' ? accountingApi.customerStatement : accountingApi.supplierStatement;
      const res = await fn(partyId, stmtParams);
      return res?.data ?? res;
    },
  });

  const transactions = statement?.transactions || [];
  const cur = statement?.currency || 'PKR';
  // Ledger is shown in PKR base (primary) with the USD equivalent on a
  // sub-line under every amount. usdRate is the rate used for PKR→USD.
  const usdRate = parseFloat(statement?.usd_rate) || 0;
  const showUsd = usdRate > 0;
  const opening = parseFloat(statement?.opening_balance) || 0;
  const closing = parseFloat(statement?.closing_balance) || 0;
  const closingUsd = parseFloat(statement?.closing_balance_usd) || 0;
  const openingUsd = parseFloat(statement?.opening_balance_usd) || 0;
  // For a customer (receivable) a positive balance means they owe us; for a
  // supplier (payable) a positive balance means we owe them.
  const totalDebit = transactions.reduce((s, t) => s + (parseFloat(t.debit) || 0), 0);
  const totalCredit = transactions.reduce((s, t) => s + (parseFloat(t.credit) || 0), 0);
  const totalDebitUsd = transactions.reduce((s, t) => s + (parseFloat(t.debit_usd) || 0), 0);
  const totalCreditUsd = transactions.reduce((s, t) => s + (parseFloat(t.credit_usd) || 0), 0);
  const balanceLabel = mode === 'customer' ? 'They owe' : 'We owe';

  function switchMode(next) {
    updateParams({ type: next, id: null });
  }

  function handlePrint() {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Controls ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 no-print">
        {/* Customer / Supplier toggle */}
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => switchMode('customer')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === 'customer' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Users size={15} /> Customer
          </button>
          <button
            onClick={() => switchMode('supplier')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === 'supplier' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Truck size={15} /> Supplier
          </button>
        </div>

        {/* Party picker — searchable (53 customers / 170+ suppliers) */}
        <div className="flex-1 min-w-0 max-w-sm">
          <label className="text-xs text-gray-500 block mb-1">
            Select {mode === 'customer' ? 'customer' : 'supplier'}
          </label>
          <SearchSelect
            value={partyId}
            onChange={(v) => updateParams({ id: v })}
            options={partyOptions}
            placeholder={partiesLoading ? 'Loading…' : `Search ${mode}…`}
          />
        </div>

        {partyId && (
          <div className="flex items-center gap-2">
            <button onClick={() => setPayOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm">
              {mode === 'customer' ? <Wallet size={14} /> : <HandCoins size={14} />}
              {mode === 'customer' ? 'Record Receipt' : 'Record Payment'}
            </button>
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">
              <Printer size={14} /> Print
            </button>
          </div>
        )}
      </div>

      {/* ─── Empty state ────────────────────────────────────────── */}
      {!partyId && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-12 text-center">
          <BookUser size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            Pick a {mode} above to see its ledger — opening balance, every posted transaction, and the running balance.
          </p>
        </div>
      )}

      {/* ─── Statement ──────────────────────────────────────────── */}
      {partyId && (
        <div className="print-report space-y-5">
          {/* Print-only header */}
          <div className="hidden print:block mb-4">
            <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between">
              <div>
                <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
                <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{mode === 'customer' ? 'Customer' : 'Supplier'} Statement</div>
                <div className="text-xs text-gray-600">
                  {selectedParty?.name || '—'} · Closing {fmtCur(closing, cur)}
                </div>
              </div>
            </div>
          </div>

          {/* Hero band */}
          <div className="rounded-2xl bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden no-print">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
            <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
                  <BookUser size={14} /> {mode === 'customer' ? 'Customer' : 'Supplier'} ledger
                </div>
                <div className="text-2xl sm:text-3xl font-bold leading-tight truncate">{selectedParty?.name || '—'}</div>
                <div className="text-xs opacity-90 mt-1">
                  {transactions.length} {transactions.length === 1 ? 'transaction' : 'transactions'} in selected period
                </div>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <span className="text-[11px] uppercase tracking-wider opacity-80">{balanceLabel} (closing)</span>
                <span className="text-2xl font-bold tabular-nums">{fmtCurSigned(closing, cur)}</span>
                {showUsd && <span className="text-xs opacity-70 tabular-nums">≈ {fmtCurSigned(closingUsd, 'USD')}</span>}
              </div>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceKPI icon={Scale} title="Opening Balance" value={fmtCurCompact(opening, cur)}
              subtitle={showUsd ? `≈ ${fmtCurCompact(openingUsd, 'USD')}` : 'Before this period'} status="neutral" loading={stmtLoading} />
            <FinanceKPI icon={ArrowDownLeft} title="Total Debit" value={fmtCurCompact(totalDebit, cur)}
              subtitle={showUsd ? `≈ ${fmtCurCompact(totalDebitUsd, 'USD')}` : (mode === 'customer' ? 'Invoiced / charged' : 'Paid / settled')} status="info" loading={stmtLoading} />
            <FinanceKPI icon={ArrowUpRight} title="Total Credit" value={fmtCurCompact(totalCredit, cur)}
              subtitle={showUsd ? `≈ ${fmtCurCompact(totalCreditUsd, 'USD')}` : (mode === 'customer' ? 'Received' : 'Billed to us')} status="info" loading={stmtLoading} />
            <FinanceKPI icon={Scale} title="Closing Balance" value={fmtCurCompact(closing, cur)}
              subtitle={showUsd ? `${balanceLabel} · ≈ ${fmtCurCompact(closingUsd, 'USD')}` : balanceLabel} status={closing > 0 ? 'warning' : 'good'} loading={stmtLoading} />
          </div>

          {/* Section heading + Statement | Allocation toggle */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <FileText size={15} className="text-blue-500" />
              <span className="font-semibold">{view === 'allocation' ? 'Invoice allocation' : 'Transactions'}</span>
              <span className="text-xs text-gray-400 hidden sm:inline">
                {view === 'allocation' ? '— each invoice with the payments applied.' : '— posted journal lines, oldest first.'}
              </span>
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs no-print">
              <button onClick={() => setView('statement')} className={`px-2.5 py-1 rounded-md font-medium ${view === 'statement' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Statement</button>
              <button onClick={() => setView('allocation')} className={`px-2.5 py-1 rounded-md font-medium ${view === 'allocation' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Allocation</button>
            </div>
          </div>

          {view === 'allocation' ? (
            <PartyAllocationLedger partyType={mode} partyId={partyId} />
          ) : (
          <>
          {/* Ledger table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {stmtLoading ? (
              <div className="p-10 text-center text-sm text-gray-400">Loading statement…</div>
            ) : isError ? (
              <div className="p-10 text-center text-sm text-rose-500">
                Couldn’t load statement{error?.message ? ` — ${error.message}` : ''}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                      <th className="text-left py-2.5 px-3 font-semibold">Date</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Vch Type</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Vch No</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Description</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Debit</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Credit</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Opening balance row */}
                    <tr className="bg-gray-50/60 text-gray-500">
                      <td className="py-2 px-3 text-xs" colSpan={6}>Opening balance</td>
                      <td className="py-2 px-3 text-right font-medium tabular-nums">
                        {fmtCurSigned(opening, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCurSigned(openingUsd, 'USD')}</span>}
                      </td>
                    </tr>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-10 text-center text-sm text-gray-400">
                          No posted transactions for this {mode} in the selected period.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((t, i) => {
                        const href = refLink(t.ref_no);
                        const dr = parseFloat(t.debit) || 0;
                        const cr = parseFloat(t.credit) || 0;
                        return (
                          <tr key={`${t.journal_no || 'jl'}-${i}`} className="hover:bg-gray-50">
                            <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap text-xs">
                              {t.date ? new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{t.vch_type || '—'}</td>
                            <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                              {t.ref_no
                                ? (href
                                    ? <Link to={href} className="text-blue-600 hover:underline font-medium">{t.vch_no || t.ref_no}</Link>
                                    : <span className="text-gray-700">{t.vch_no || t.ref_no}</span>)
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-2.5 px-3 text-gray-700 min-w-[220px]" style={{ maxWidth: 420 }}>
                              <span className="block whitespace-normal break-words">{t.description || '—'}</span>
                              {t.account_name && <span className="block text-[10px] text-gray-400 whitespace-normal break-words">{t.account_code} · {t.account_name}</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                              {dr > 0 ? fmtCur(dr, cur) : '—'}
                              {showUsd && dr > 0 && <span className="block text-[10px] text-gray-400">{fmtCur(t.debit_usd, 'USD')}</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                              {cr > 0 ? fmtCur(cr, cur) : '—'}
                              {showUsd && cr > 0 && <span className="block text-[10px] text-gray-400">{fmtCur(t.credit_usd, 'USD')}</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right font-medium tabular-nums whitespace-nowrap">
                              {fmtCurSigned(t.running_balance, cur)}
                              {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCurSigned(t.running_balance_usd, 'USD')}</span>}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {/* Closing balance row */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td className="py-2.5 px-3 text-gray-600 uppercase text-[11px]" colSpan={4}>Closing balance</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCur(totalDebit, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">{fmtCur(totalDebitUsd, 'USD')}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCur(totalCredit, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">{fmtCur(totalCreditUsd, 'USD')}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCurSigned(closing, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCurSigned(closingUsd, 'USD')}</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Transaction-type-count footer (LedgerReport.pdf style) */}
          {transactions.length > 0 && <LedgerTypeCounts counts={statement?.type_counts} />}
          </>
          )}

          {/* Open items — outstanding receivables/payables (incl. ones not yet on
              the GL, e.g. export orders awaiting advance) so the statement isn't
              blank when Due Dates shows money owed. */}
          <OpenItemsPanel items={statement?.open_items} partyType={mode} />
        </div>
      )}

      {/* Slide-over to settle the party's balance straight from the statement */}
      {payOpen && selectedParty && (
        <StatementPayDrawer
          mode={mode}
          party={{ id: selectedParty.id, name: selectedParty.name }}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
