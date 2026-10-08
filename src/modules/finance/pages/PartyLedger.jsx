import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, BookUser, Scale, ArrowDownLeft, ArrowUpRight, Printer, FileText, Wallet, HandCoins, Sparkles } from 'lucide-react';
import DraftEmailDrawer from '../../ai/components/DraftEmailDrawer';
import { FinanceKPI } from '../../../components/finance';
import StatementPayDrawer from '../components/StatementPayDrawer';
import SearchSelect from '../../../shared/components/SearchSelect';
import LedgerTypeCounts from '../../milling/components/LedgerTypeCounts';
import PartyAllocationLedger from '../../milling/components/PartyAllocationLedger';
import OpenItemsPanel from '../../milling/components/OpenItemsPanel';
import { accountingApi } from '../../accounting/api/services';
import { useCustomers, useSuppliers } from '../../../api/queries';
import { favStar } from '../../../shared/utils/favorites';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useFinanceDrawers } from '../drawers/drawersContext';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtMoney, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { EmptyLine, InlineError } from '../components/FinanceUI';
import { btnPrimary, btnSecondary, th } from '../utils/uiClasses';

// Statements are shown in the party's transaction currency (export parties are
// USD; mill/local are PKR), as returned by the backend's `currency` field.
// fmtMoney prints the sign in front of the symbol ("-Rs 1,234.00"), exact.
const fmtCur = (v, cur) => fmtMoney(v, cur || 'PKR', { decimals: 2 });

const refLink = (refNo) => {
  if (!refNo) return null;
  if (refNo.startsWith('EX-')) return `/export/${refNo}`;
  if (refNo.startsWith('M-')) return `/milling/${refNo}`;
  return null;
};

// Per-row tint + pill so a sale/bill row reads Paid / Partial / Unpaid at a glance.
const STATUS_ROW = { Paid: 'bg-emerald-50', Partial: 'bg-amber-50', Unpaid: 'bg-red-50' };

export default function PartyLedger() {
  const { companyProfileData } = useApp();
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const canPay = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit');
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
  const [draftOpen, setDraftOpen] = useState(false);
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
    () => parties.map((p) => ({ value: p.id, label: `${favStar(p)}${p.name}`, sub: p.country || p.location || '' })),
    [parties],
  );

  // date_from / date_to come from the shared finance date-range selector
  const stmtParams = useMemo(() => {
    const p = {};
    if (rangeParams?.from_date) p.date_from = rangeParams.from_date;
    if (rangeParams?.to_date) p.date_to = rangeParams.to_date;
    return p;
  }, [rangeParams]);

  const { data: statement, isLoading: stmtLoading, isError, error, refetch: refetchStatement } = useQuery({
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
        <div className="inline-flex self-start rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Party type">
          <button
            type="button" aria-pressed={mode === 'customer'}
            onClick={() => switchMode('customer')}
            className={`inline-flex items-center gap-1.5 px-3 min-h-10 sm:min-h-9 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              mode === 'customer' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Users size={15} aria-hidden="true" /> Customer
          </button>
          <button
            type="button" aria-pressed={mode === 'supplier'}
            onClick={() => switchMode('supplier')}
            className={`inline-flex items-center gap-1.5 px-3 min-h-10 sm:min-h-9 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              mode === 'supplier' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Truck size={15} aria-hidden="true" /> Supplier
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
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {/* Secondary actions first, the one primary (Record) at the right. */}
            <button type="button" onClick={() => setDraftOpen(true)} className={`${btnSecondary} no-print`}>
              <Sparkles size={14} aria-hidden="true" /> Draft Email
            </button>
            <button type="button" onClick={handlePrint} className={btnSecondary}>
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            {/* The allocator records one payment per open invoice through
                POST /finance/payments — finance.confirm_payment or milling.edit. */}
            {canPay && (
              <button type="button" onClick={() => setPayOpen(true)} data-action={mode === 'customer' ? 'receive' : 'pay'} className={btnPrimary}>
                {mode === 'customer' ? <Wallet size={14} aria-hidden="true" /> : <HandCoins size={14} aria-hidden="true" />}
                {mode === 'customer' ? 'Record Receipt' : 'Record Payment'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Empty state ────────────────────────────────────────── */}
      {!partyId && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white">
          <EmptyLine icon={BookUser}>
            Pick a {mode} above to see its ledger — opening balance, every posted transaction, and the running balance.
          </EmptyLine>
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
                <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{mode === 'customer' ? 'Customer' : 'Supplier'} Statement</div>
                <div className="text-xs text-gray-600">
                  {selectedParty?.name || '—'} · Closing {fmtCur(closing, cur)}
                </div>
              </div>
            </div>
          </div>

          {/* Whose ledger this is — a plain heading; the closing balance is the last tile below */}
          <div className="no-print min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <BookUser size={14} className="text-gray-400" aria-hidden="true" /> {mode === 'customer' ? 'Customer' : 'Supplier'} ledger
            </p>
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 truncate" title={selectedParty?.name || ''}>{selectedParty?.name || '—'}</h2>
            <p className="text-sm text-gray-500">
              {transactions.length} {transactions.length === 1 ? 'transaction' : 'transactions'} in selected period
            </p>
          </div>

          {/* KPI tiles — screen only, excluded from the printed ledger */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 no-print">
            <FinanceKPI icon={Scale} title="Opening Balance" value={fmtCur(opening, cur)}
              subtitle={showUsd ? `≈ ${fmtCur(openingUsd, 'USD')}` : 'Before this period'} status="neutral" loading={stmtLoading} />
            <FinanceKPI icon={ArrowDownLeft} title="Total Debit" value={fmtCur(totalDebit, cur)}
              subtitle={showUsd ? `≈ ${fmtCur(totalDebitUsd, 'USD')}` : (mode === 'customer' ? 'Invoiced / charged' : 'Paid / settled')} status="info" loading={stmtLoading} />
            <FinanceKPI icon={ArrowUpRight} title="Total Credit" value={fmtCur(totalCredit, cur)}
              subtitle={showUsd ? `≈ ${fmtCur(totalCreditUsd, 'USD')}` : (mode === 'customer' ? 'Received' : 'Billed to us')} status="info" loading={stmtLoading} />
            <FinanceKPI icon={Scale} title="Closing Balance" value={fmtCur(closing, cur)}
              subtitle={showUsd ? `${balanceLabel} · ≈ ${fmtCur(closingUsd, 'USD')}` : balanceLabel} status={closing > 0 ? 'warning' : 'good'} loading={stmtLoading} />
          </div>

          {/* Section heading + Statement | Allocation toggle */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
              <FileText size={16} className="text-gray-400 shrink-0" aria-hidden="true" />
              <h3 className="font-semibold text-gray-900">{view === 'allocation' ? 'Invoice allocation' : 'Transactions'}</h3>
              <span className="text-xs text-gray-500 hidden sm:inline">
                {view === 'allocation' ? '— each invoice with the payments applied.' : '— posted journal lines, oldest first.'}
              </span>
            </div>
            <div className="inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs no-print" role="group" aria-label="Ledger view">
              <button type="button" aria-pressed={view === 'statement'} onClick={() => setView('statement')} className={`px-3 min-h-10 sm:min-h-8 rounded-md font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === 'statement' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Statement</button>
              <button type="button" aria-pressed={view === 'allocation'} onClick={() => setView('allocation')} className={`px-3 min-h-10 sm:min-h-8 rounded-md font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === 'allocation' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Allocation</button>
            </div>
          </div>

          {view === 'allocation' ? (
            <PartyAllocationLedger partyType={mode} partyId={partyId} />
          ) : (
          <>
          {/* Ledger table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {stmtLoading ? (
              <div className="p-4 space-y-2 animate-pulse" aria-busy="true">
                <span className="sr-only">Loading statement…</span>
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 bg-gray-100 rounded" />)}
              </div>
            ) : isError ? (
              <div className="p-4">
                <InlineError message={`Couldn’t load statement${error?.message ? ` — ${error.message}` : ''}.`} onRetry={refetchStatement} />
              </div>
            ) : (
              <div className={`overflow-x-auto mobile-cards ${transactions.length > 15 ? 'md:max-h-[75vh] md:overflow-y-auto' : ''}`}>
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr>
                      {[['Date'], ['Type'], ['Voucher No.'], ['Description'], ['Debit', 'text-right'], ['Credit', 'text-right'], ['Balance', 'text-right']].map(([label, align = 'text-left']) => (
                        <th key={label} className={`${th} ${align} md:sticky md:top-0 md:z-[1]`}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Opening balance row */}
                    <tr className="bg-gray-50/60 text-gray-500">
                      <td className="mob-full py-2 px-3 text-xs" colSpan={6}>Opening balance</td>
                      <td data-label="Opening balance" className="py-2 px-3 text-right font-medium tabular-nums">
                        {fmtCur(opening, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCur(openingUsd, 'USD')}</span>}
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
                          <tr key={`${t.journal_no || 'jl'}-${i}`} className={STATUS_ROW[t.status] || 'hover:bg-gray-50'}>
                            <td data-label="Date" className="py-2.5 px-3 text-gray-600 whitespace-nowrap text-xs">
                              {fmtDate(t.date)}
                            </td>
                            <td data-label="Type" className="mob-hide py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{t.vch_type || '—'}</td>
                            <td data-label="Voucher No." className="py-2.5 px-3 text-xs whitespace-nowrap">
                              {t.ref_no
                                ? (/^PAY-/i.test(t.ref_no) && drawers?.openTransaction
                                    // A payment line opens its Transaction drawer.
                                    ? <button type="button" onClick={() => drawers.openTransaction('payment', t.ref_no)} className="text-blue-600 hover:underline font-medium">{t.ref_no}</button>
                                    : href
                                    ? <Link to={href} className="text-blue-600 hover:underline font-medium">{t.ref_no}</Link>
                                    : <span className="text-gray-700">{t.ref_no}</span>)
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td data-label="Description" className="py-2.5 px-3 text-gray-700 min-w-[220px]" style={{ maxWidth: 420 }}>
                              <span className="block whitespace-normal break-words">
                                {t.status && <span className="mr-1.5 align-middle"><StatusBadge status={t.status} /></span>}
                                {t.description || '—'}
                              </span>
                              {t.account_name && <span className="block text-[10px] text-gray-400 whitespace-normal break-words">{t.account_code} · {t.account_name}</span>}
                            </td>
                            <td data-label="Debit" className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                              {dr > 0 ? fmtCur(dr, cur) : '—'}
                              {showUsd && dr > 0 && <span className="block text-[10px] text-gray-400">{fmtCur(t.debit_usd, 'USD')}</span>}
                            </td>
                            <td data-label="Credit" className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                              {cr > 0 ? fmtCur(cr, cur) : '—'}
                              {showUsd && cr > 0 && <span className="block text-[10px] text-gray-400">{fmtCur(t.credit_usd, 'USD')}</span>}
                            </td>
                            <td data-label="Balance" className="py-2.5 px-3 text-right font-medium tabular-nums whitespace-nowrap">
                              {fmtCur(t.running_balance, cur)}
                              {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCur(t.running_balance_usd, 'USD')}</span>}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {/* Closing balance row */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td className="mob-full py-2.5 px-3 text-gray-600 uppercase text-[11px]" colSpan={4}>Closing balance</td>
                      <td data-label="Total debit" className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCur(totalDebit, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">{fmtCur(totalDebitUsd, 'USD')}</span>}
                      </td>
                      <td data-label="Total credit" className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCur(totalCredit, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">{fmtCur(totalCreditUsd, 'USD')}</span>}
                      </td>
                      <td data-label="Closing balance" className="py-2.5 px-3 text-right tabular-nums">
                        {fmtCur(closing, cur)}
                        {showUsd && <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtCur(closingUsd, 'USD')}</span>}
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

      {/* AI-drafted email from this party's ledger */}
      {draftOpen && selectedParty && (
        <DraftEmailDrawer
          partyType={mode}
          partyId={selectedParty.id}
          partyName={selectedParty.name}
          onClose={() => setDraftOpen(false)}
        />
      )}
    </div>
  );
}
