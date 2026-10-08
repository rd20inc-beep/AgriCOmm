import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '../../analytics/api/services';
import { useAuth } from '../../../context/AuthContext';
import NeedsAttention from '../components/NeedsAttention';
import RecentActivity from '../components/RecentActivity';
import {
  ArrowDownLeft, ArrowUpRight,
  TrendingUp, AlertTriangle,
  Clock, Lock, Wallet, Activity,
  Receipt, RefreshCw, ChevronRight,
  CheckCircle2, CalendarClock, Users,
} from 'lucide-react';
import {
  useReceivables, usePayables, useJournalEntries,
  useFinanceOverviewSummary, useUpcoming,
} from '../../../api/queries';
import { useFinanceDateRange, overviewSummaryParams } from '../hooks/useFinanceDateRange';
import { withRange, rangeLabel } from '../financeNav';
import {
  BUCKET_KEYS, BUCKET_COLORS, ageDays, ageBucket, bucketize, isOpenAR,
} from '../utils/aging';
import { useFxRate } from '../utils/fx';
import AnomalyWatchCard from '../../ai/components/AnomalyWatchCard';
import PurchaseRequirementsPanel from '../../purchaseRequirements/components/PurchaseRequirementsPanel';
import { fmtPKR, fmtUSD, fmtMoney, fmtDate, fmtPct } from '../../../shared/utils/format';
import {
  nativeTotals, receivablesTile, collectionTile, pkrEquivText, upcomingPkrEquiv,
} from '../utils/currencyTiles';
import { Section, HeadlineCard, TypeChip, EmptyLine, MoreSection, PkrEquivLine } from '../components/FinanceUI';
import { btnQuiet, kpiLabel, kpiValue, kpiSub, sectionTitle } from '../utils/uiClasses';

// Aging helpers + bucket palette moved to ../utils/aging so MoneyIn and
// any future caller render the same buckets. See useFxRate() too for
// the FX fallback used by mixed-currency receivables.

// ─── Page ─────────────────────────────────────────────────────────────
export default function FinanceOverview() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // Finance (payments-only) can't open Export/Mill pages — only navigate there if
  // the role actually has access, else keep the click on a finance destination so
  // it never lands on an "Access Denied" route.
  const { queryParams: rangeParams, rangeKey } = useFinanceDateRange();
  // Every finance link carries the period.
  const fl = (path) => withRange(path, rangeKey);
  const goExport = () => navigate(hasPermission('export_orders', 'view') ? '/export' : fl('/finance/money-in'));
  const goMill = () => navigate(hasPermission('milling', 'view') ? '/milling' : fl('/finance/money-in'));
  const { data: upcoming } = useUpcoming();
  // The summary endpoint reads start_date / end_date. Profit and the segment
  // cards honour them; receivables, payables, cash and collection rate are
  // point-in-time / all-time and are labelled so.
  const { data: summary = {}, isLoading, refetch } = useFinanceOverviewSummary(overviewSummaryParams(rangeParams));
  const { data: receivables = [] } = useReceivables(rangeParams);
  const { data: payables = [] } = usePayables(rangeParams);
  const { data: journalData = [] } = useJournalEntries(rangeParams);

  const exp = summary.export || {};
  const mill = summary.mill || {};
  const local = summary.local || {};
  const recv = summary.receivables || {};
  const pay = summary.payables || {};
  const cash = summary.cashPosition || {};
  const consolidated = summary.consolidated || {};
  // Receivables and collection rate per currency — USD and PKR shown side by
  // side, never added together.
  const recvSplit = receivablesTile(recv);
  const collection = collectionTile(summary);

  // ─── Aging analysis (FE-computed since backend hardcodes aging=0) ──
  const recvAging = useMemo(() => bucketize(receivables, { mode: 'mixed' }), [receivables]);
  const payAging  = useMemo(() => bucketize(payables,    { mode: 'pkr' }),    [payables]);

  // ─── Top counterparties by outstanding ─────────────────────────────
  const topOverdueRecv = useMemo(() =>
    onlyOpen(receivables)
      .filter(r => isOverdue(r))
      .sort((a, b) => (parseFloat(b.outstanding) || 0) - (parseFloat(a.outstanding) || 0))
      .slice(0, 5),
    [receivables]
  );
  const topOverduePay = useMemo(() =>
    onlyOpen(payables)
      .filter(p => isOverdue(p))
      .sort((a, b) => (parseFloat(b.outstanding) || 0) - (parseFloat(a.outstanding) || 0))
      .slice(0, 5),
    [payables]
  );

  const recentJournals = useMemo(() => (Array.isArray(journalData) ? journalData : []).slice(0, 6), [journalData]);

  if (isLoading) return <Skeleton />;

  // C1: the headline is the books — GL P&L net profit (Posted journals,
  // company-wide). The operational figures sit underneath, labelled so.
  const books = summary.books || {};
  const booksProfit = books.netProfitPkr || 0;
  const profitTone = booksProfit < 0 ? 'negative' : booksProfit > 0 ? 'positive' : 'neutral';
  const warnings = summary.warnings || [];
  // C5: a foreign bank balance has no booked PKR figure, so its equivalent is
  // at today's rate, dated.
  const cashForeign = Object.entries(cash.byCurrency || {}).some(([c, v]) => c !== 'PKR' && (v || 0) !== 0);
  const cashEquiv = cashForeign && cash.pkrEquiv
    ? pkrEquivText({ ...cash.pkrEquiv, foreign: true, missingCount: cash.pkrEquiv.unconvertedCount || 0 }) : null;
  const recvEquivSplit = (recvAging.native && Object.keys(recvAging.native).length > 0);

  return (
    <div className="space-y-5 pb-4">
      {/* ─── 1. POSITION STRIP — where the money stands ─────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="position-strip">
        <KpiTile
          icon={ArrowDownLeft}
          label="Receivables"
          basis="all open"
          primary={recvSplit.primary}
          secondary={recvSplit.secondary}
          equiv={recvSplit.equiv}
          hint={recvSplit.overdue || 'All current'}
          hintBad={!!recvSplit.overdue}
          onClick={() => navigate(fl('/finance/money-in'))}
        />
        <KpiTile
          icon={ArrowUpRight}
          label="Payables"
          basis="all open"
          primary={fmtPKR(pay.totalOutstandingPkr || 0)}
          secondary={`${pay.count || 0} outstanding`}
          hint={(pay.overdueAmountPkr || 0) > 0 ? `${fmtPKR(pay.overdueAmountPkr)} overdue` : 'All current'}
          hintBad={(pay.overdueAmountPkr || 0) > 0}
          onClick={() => navigate(fl('/finance/money-out'))}
        />
        <KpiTile
          icon={Wallet}
          label="Cash Position"
          basis="now"
          primary={fmtPKR(cash.bankBalancePkr || 0)}
          secondary={[
            (cash.bankBalanceUsd || 0) !== 0 ? `+ ${fmtUSD(cash.bankBalanceUsd, { decimals: 0 })}` : null,
            cash.accountCount ? `${cash.accountCount} accounts` : 'All bank accounts',
          ].filter(Boolean).join(' · ')}
          equiv={cashEquiv}
          hint={cash.bankBalancePkr > 0 ? 'Available' : 'Below zero'}
          hintBad={(cash.bankBalancePkr || 0) <= 0}
          onClick={() => navigate(fl('/finance/accounts'))}
        />
        <KpiTile
          icon={TrendingUp}
          label="Collection Rate"
          basis="due to date"
          primary={collection.primary}
          secondary={collection.secondary}
          hint={collection.hint}
          hintBad={collection.bad}
        />
      </div>

      {/* ─── 2. NEEDS ATTENTION — the actionable queue (replaces the alerts
           panel and the payroll-approvals card) ───────────────────────── */}
      <NeedsAttention summary={summary} rangeKey={rangeKey} />

      {/* ─── 3. PROFIT — the books lead (GL P&L net profit, Posted journals);
           the operational figures sit underneath, labelled. Only the figure
           carries the sign colour, and the word (profit / loss) says it too ── */}
      <HeadlineCard
        testId="profit-card"
        icon={Activity}
        label={<>Net profit (books) · {rangeKey ? rangeLabel(rangeKey) : 'All time'}</>}
        value={<span data-testid="books-net-profit">{fmtPKR(booksProfit)}{profitTone === 'negative' && <span className="ml-2 align-middle text-sm font-semibold">(loss)</span>}</span>}
        tone={profitTone}
        sub={<>
          Revenue {fmtPKR(books.revenuePkr || 0)} · COGS {fmtPKR(books.cogsPkr || 0)} · Expenses {fmtPKR(books.expensesPkr || 0)}
        </>}
        meta={<>
          General ledger, Posted journals, all entities ·{' '}
          <Link to={fl('/finance/accounting')} className="underline">Profit &amp; Loss</Link>
        </>}
        right={<>
          {summary.currentFxRate && <TypeChip>1 USD = {summary.currentFxRate} PKR</TypeChip>}
          <TypeChip>Base PKR</TypeChip>
          <button type="button" onClick={() => refetch()} className={btnQuiet}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </>}
      >
        <div className="mt-4 pt-3 border-t border-gray-100" data-testid="operational-profit">
          <p className={kpiLabel}>Operational (management view — not the books)</p>
          <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <OpFigure label="Booked" value={consolidated.bookedPkr ?? consolidated.profitPkr} sub="export booked + mill + local" testId="op-booked" />
            <OpFigure label="Realised" value={consolidated.realisedPkr} sub="export by shipment date + mill + local" testId="op-realised" />
            <OpFigure label="Mill (net)" value={mill.netProfit ?? mill.grossProfit} sub={`gross ${fmtPKR(mill.grossProfit || 0)} − overheads ${fmtPKR(mill.overheads || 0)}`} testId="op-mill" />
            <OpFigure label="Local other" value={local.grossProfit} sub="non-mill local sales" testId="op-local" />
          </dl>
          <p className="mt-2 text-xs text-gray-500">
            Export booked {fmtPKR(exp.bookedProfitPkr || 0)} · realised {fmtPKR(exp.realisedProfitPkr || 0)} · pipeline {fmtPKR(exp.pipelineProfitPkr || 0)} (booked, not yet shipped)
            {(exp.fxGainLossPkr || 0) !== 0 && (
              <> · FX realised {(exp.fxGainLossPkr || 0) >= 0 ? '+' : ''}{fmtPKR(exp.fxGainLossPkr || 0)} (not included)</>
            )}
            {(exp.unpricedCount || 0) > 0 && <> · {exp.unpricedCount} export order{exp.unpricedCount === 1 ? '' : 's'} not costed yet — excluded</>}
          </p>
        </div>
        {warnings.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5" data-testid="profit-warnings">
            {warnings.slice(0, 2).map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <WarningText text={w} ratesHref={fl('/finance/accounting/rates')} />
              </li>
            ))}
          </ul>
        )}
      </HeadlineCard>

      {/* ─── 4. RECENT ACTIVITY + JOURNALS ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentActivity rangeParams={rangeParams} />

        <Section
          title="Recent journal entries"
          icon={Clock}
          action={<ViewAll onClick={() => navigate(fl('/finance/accounting'))} />}
        >
          {recentJournals.length === 0 ? (
            <EmptyLine icon={Receipt}>No journal entries in this period.</EmptyLine>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentJournals.map((j, i) => (
                <li key={j.id || i} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate" title={j.description || j.narration || 'Journal entry'}>{j.description || j.narration || 'Journal entry'}</p>
                    {(j.journalNo || j.refNo) && (
                      <p className="text-xs text-gray-500 truncate">
                        {[j.journalNo, j.refNo].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums">{j.date ? fmtDate(j.date) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ─── 5. UPCOMING CHEQUES & DUES ──────────────────────────────── */}
      {((upcoming?.receiving?.length || 0) + (upcoming?.giving?.length || 0)) > 0 && (
        <Section title="Upcoming cheques & dues" icon={CalendarClock}
          action={<Link to={fl('/finance/accounts/cheques')} className={btnQuiet}>View all <ChevronRight size={14} aria-hidden="true" /></Link>}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 flex items-center gap-1"><ArrowDownLeft size={12} className="text-emerald-600" aria-hidden="true" /> Receiving</p>
              <p className="text-lg font-bold text-gray-900 tabular-nums break-words">{nativeTotals(upcoming?.receiving)}</p>
              <PkrEquivLine text={pkrEquivText(upcomingPkrEquiv(upcoming?.receiving, { rateDate: upcoming?.todayRateDate }))} />
              <p className="text-xs text-gray-500">{upcoming?.receiving?.length || 0} cheque(s) / due(s)</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 flex items-center gap-1"><ArrowUpRight size={12} className="text-red-600" aria-hidden="true" /> Giving</p>
              <p className="text-lg font-bold text-gray-900 tabular-nums break-words">{nativeTotals(upcoming?.giving)}</p>
              <PkrEquivLine text={pkrEquivText(upcomingPkrEquiv(upcoming?.giving, { rateDate: upcoming?.todayRateDate }))} />
              <p className="text-xs text-gray-500">{upcoming?.giving?.length || 0} cheque(s) / due(s)</p>
            </div>
          </div>
        </Section>
      )}

      {/* ─── 6. BUSINESS SEGMENTS ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <SegmentCard
          title="Export Operations"
          subtitle={`${exp.activeOrders || 0} active · ${exp.totalOrders || 0} total`}
          revenueLabel="Revenue (PKR)"
          revenue={fmtPKR(exp.revenuePkrBooked || 0)}
          revenueSub={`${fmtUSD(exp.revenueForeign || 0)} foreign`}
          profitLabel="Booked Profit"
          profit={fmtPKR(exp.bookedProfitPkr || 0)}
          profitSub={[
            `Realised ${fmtPKR(exp.realisedProfitPkr || 0)} (by shipment date)`,
            `Pipeline ${fmtPKR(exp.pipelineProfitPkr || 0)} (not yet shipped)`,
            (exp.estimatedCount || 0) > 0 ? `${exp.estimatedCount} estimated` : null,
            (exp.unpricedCount || 0) > 0 ? `${exp.unpricedCount} not costed (excluded)` : null,
          ].filter(Boolean).join(' · ')}
          marginPct={exp.marginPct}
          onClick={goExport}
        />
        <SegmentCard
          title="Mill Operations"
          subtitle={`Sales of mill output (local sales + transfers to export) · ${mill.batchCount || 0} batches completed`}
          revenueLabel="Sales (PKR)"
          revenue={fmtPKR(mill.revenue || 0)}
          revenueSub={`COGS ${fmtPKR(mill.cogs || 0)} · unsold stock at cost ${fmtPKR(mill.unsoldStockAtCostPkr || 0)}`}
          profitLabel="Realised Profit (net)"
          profit={fmtPKR(mill.netProfit ?? mill.grossProfit ?? 0)}
          profitSub={[
            `Gross ${fmtPKR(mill.grossProfit || 0)} − overheads ${fmtPKR(mill.overheads || 0)}`,
            (mill.uncostedCount || 0) > 0 ? `${mill.uncostedCount} sale(s) without COGS excluded` : null,
          ].filter(Boolean).join(' · ')}
          marginPct={mill.marginPct}
          onClick={goMill}
        />
        <SegmentCard
          title="Local Sales (other)"
          subtitle={`${local.completedCount || 0} completed · ${local.saleCount || 0} total${(local.outstanding || 0) > 0 ? ` · ${fmtPKR(local.outstanding)} due` : ''} · profit excludes mill-output sales (in Mill)`}
          revenueLabel="Revenue (PKR)"
          revenue={fmtPKR(local.revenue || 0)}
          revenueSub={`Collected ${fmtPKR(local.collected || 0)}`}
          profitLabel="Gross Profit"
          profit={fmtPKR(local.grossProfit || 0)}
          marginPct={local.marginPct}
          onClick={() => navigate(fl('/finance/money-in/local-sales'))}
        />
      </div>

      {/* ─── 7. PAYROLL SUMMARY (consolidated from mill payroll) ──────── */}
      <PayrollSummaryStrip navigate={navigate} fmtPKR={fmtPKR} />

      {/* ─── 8. AGING ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgingPanel
          title="Receivables aging"
          icon={ArrowDownLeft}
          data={recvAging}
          totalLabel={recvEquivSplit ? nativeLine(recvAging.native) : fmtPKR(0)}
          equiv={recvAging.foreign ? pkrEquivText({ pkr: recvAging.totalPkr, basis: 'booked', missingCount: recvAging.missingCount, foreign: true }) : null}
          showNative
          onClickAll={() => navigate(fl('/finance/money-in'))}
        />
        <AgingPanel
          title="Payables aging"
          icon={ArrowUpRight}
          data={payAging}
          totalLabel={fmtPKR(payAging.totalPkr)}
          onClickAll={() => navigate(fl('/finance/money-out'))}
        />
      </div>

      {/* ─── 9. TOP COUNTERPARTIES ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CounterpartyList
          title="Top overdue customers"
          empty="No overdue receivables"
          rows={topOverdueRecv}
          itemLabel={(r) => r.customerName || r.party || `#${r.id}`}
          itemAmount={(r) => fmtMoney(parseFloat(r.outstanding) || 0, (r.currency || 'PKR').toUpperCase())}
          itemAge={(r) => ageDays(r.dueDate || r.due_date)}
          itemHref={(r) => r.orderId ? `/export/${r.orderId}` : fl('/finance/money-in')}
        />
        <CounterpartyList
          title="Top overdue suppliers"
          empty="No overdue payables"
          rows={topOverduePay}
          itemLabel={(p) => p.supplierName || p.supplier_name || p.party || p.linkedRef || p.linked_ref || `#${p.id}`}
          itemAmount={(p) => fmtPKR(parseFloat(p.outstanding) || 0)}
          itemAge={(p) => ageDays(p.dueDate || p.due_date)}
          itemHref={() => fl('/finance/money-out')}
        />
      </div>

      {/* ─── 10. MORE INSIGHTS — lower-priority blocks, collapsed and quieter.
           Everything still renders (and fetches) as before; it is only
           folded away so the queue above stays the focus. ─────────────── */}
      <MoreSection
        testId="more-insights"
        title="More insights"
        summary={[
          'AI anomaly watch',
          'purchase requests',
          exp.cogsStatus && (exp.cogsStatus.preShipment > 0 || exp.cogsStatus.shippedMissingCogs > 0) ? 'export COGS lifecycle' : null,
        ].filter(Boolean).join(' · ')}
      >
        <AnomalyWatchCard />
        {/* Approved material buys awaiting payment */}
        <PurchaseRequirementsPanel embedded />
        {exp.cogsStatus && (exp.cogsStatus.preShipment > 0 || exp.cogsStatus.shippedMissingCogs > 0) && (
          <CogsLifecyclePanel data={exp.cogsStatus} />
        )}
      </MoreSection>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="h-40 bg-gray-100 rounded-xl" />
      <div className="h-32 bg-gray-100 rounded-xl" />
    </div>
  );
}

// "View all" — the quiet link every Home section uses.
function ViewAll({ onClick }) {
  return (
    <button type="button" onClick={onClick} className={btnQuiet}>
      View all <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}

// ─── KPI Tile ──────────────────────────────────────────────────────────
// Same anatomy as FinanceKPI: small label · big figure · small sub-line. The
// hint carries a symbol and words as well as its colour.
function KpiTile({ icon: Icon, label, basis, primary, secondary, equiv, hint, hintBad, onClick }) {
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full min-w-0 bg-white rounded-xl border border-gray-200 p-4 text-left transition-colors ${onClick ? 'hover:border-gray-300 hover:bg-gray-50/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`${kpiLabel} min-w-0`}>
          {label}{basis && <span className="normal-case tracking-normal font-normal text-gray-500"> · {basis}</span>}
        </span>
        {Icon && <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50 text-gray-500" aria-hidden="true"><Icon size={16} /></span>}
      </div>
      <div className={`${kpiValue} break-words`}>{primary}</div>
      {secondary && <div className={`${kpiSub} mt-1`}>{secondary}</div>}
      <PkrEquivLine text={equiv} className="mt-0.5" />
      {hint && (
        <div className={`text-xs mt-2 font-medium ${hintBad ? 'text-red-700' : 'text-emerald-700'}`}>
          <span aria-hidden="true">{hintBad ? '● ' : '✓ '}</span>{hint}
        </div>
      )}
    </Cmp>
  );
}

// ─── Segment card (Export / Mill / Local Sales) ───────────────────────
function SegmentCard({ title, subtitle, revenueLabel, revenue, revenueSub, profitLabel, profit, profitSub, marginPct, onClick }) {
  const margin = parseFloat(marginPct) || 0;
  const profitNum = typeof profit === 'string' ? parseFloat(profit.replace(/[^0-9.-]/g, '')) : profit;
  const profitColor = profitNum >= 0 ? 'text-emerald-700' : 'text-red-700';
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-5 text-left transition-colors ${onClick ? 'hover:border-gray-300 hover:bg-gray-50/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className={sectionTitle}>{title}</h3>
        {margin !== 0 && (
          <span className="text-xs font-medium text-gray-600 tabular-nums">{fmtPct(margin)} margin</span>
        )}
      </div>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
        <div className="min-w-0">
          <p className={kpiLabel}>{revenueLabel}</p>
          <p className="text-base font-bold text-gray-900 mt-0.5 tabular-nums break-words">{revenue}</p>
          {revenueSub && <p className="text-xs text-gray-500 mt-0.5">{revenueSub}</p>}
        </div>
        <div className="min-w-0">
          <p className={kpiLabel}>{profitLabel}</p>
          <p className={`text-base font-bold mt-0.5 tabular-nums break-words ${profitColor}`}>{profit}</p>
          {profitSub && <p className="text-xs text-gray-500 mt-0.5">{profitSub}</p>}
        </div>
      </div>
    </Cmp>
  );
}

// ─── Operational figure (under the books headline) ────────────────────
function OpFigure({ label, value, sub, testId }) {
  const v = Number(value) || 0;
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums break-words ${v < 0 ? 'text-red-700' : 'text-gray-900'}`}>{fmtPKR(v)}</dd>
      {sub && <dd className="text-[11px] text-gray-500">{sub}</dd>}
    </div>
  );
}

// Each currency's own total, USD first ("$3,000.00 · Rs 821,395"), never summed.
function nativeLine(native = {}) {
  const order = ['USD', 'PKR', ...Object.keys(native).filter((c) => c !== 'USD' && c !== 'PKR').sort()];
  const parts = order.filter((c) => Math.abs(native[c] || 0) > 0.004).map((c) => fmtMoney(native[c], c, { decimals: c === 'PKR' ? 0 : 2 }));
  return parts.length ? parts.join(' · ') : '—';
}

// ─── Aging panel ───────────────────────────────────────────────────────
function AgingPanel({ title, icon, data, totalLabel, totalSubLabel, equiv, showNative = false, onClickAll }) {
  const total = data.totalPkr || 0;
  return (
    <Section title={title} icon={icon} action={<ViewAll onClick={onClickAll} />}>
      <div className="mb-3">
        <div className="text-2xl font-bold text-gray-900 tabular-nums">{totalLabel}</div>
        {totalSubLabel && <div className="text-xs text-gray-500 mt-0.5 tabular-nums">{totalSubLabel}</div>}
        <PkrEquivLine text={equiv} className="mt-0.5" />
      </div>

      {/* Stacked bar */}
      {total === 0 ? (
        <EmptyLine icon={CheckCircle2} className="!py-4">No outstanding balances</EmptyLine>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
            {BUCKET_KEYS.map(k => {
              const pct = total > 0 ? (data[k].totalPkr / total) * 100 : 0;
              if (pct === 0) return null;
              return <div key={k} className={BUCKET_COLORS[k].bar} style={{ width: `${pct}%` }} title={`${k}: ${pct.toFixed(0)}%`} />;
            })}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3">
            {BUCKET_KEYS.map(k => (
              <div key={k} className={`text-center px-1.5 py-2 rounded-md ${BUCKET_COLORS[k].tag}`}>
                <div className="text-[11px] uppercase tracking-wider font-medium">{k} days</div>
                <div className="text-sm font-bold mt-0.5 tabular-nums">{data[k].count}</div>
                {showNative ? (
                  <div className="text-[11px] mt-0.5 tabular-nums break-words" title={nativeLine(data[k].native)}>{nativeLine(data[k].native)}</div>
                ) : (
                  <div className="text-[11px] mt-0.5 truncate tabular-nums" title={fmtPKR(data[k].totalPkr)}>{fmtPKR(data[k].totalPkr)}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ─── Counterparty list ────────────────────────────────────────────────
function CounterpartyList({ title, rows, itemLabel, itemAmount, itemAge, itemHref, empty }) {
  return (
    <Section title={title} icon={AlertTriangle}>
      {rows.length === 0 ? (
        <EmptyLine icon={CheckCircle2}>{empty}</EmptyLine>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r, i) => {
            const days = itemAge(r);
            return (
              <li key={r.id || i}>
                <Link to={itemHref(r)} className="flex items-center gap-3 py-2.5 min-h-11 rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <span className="w-6 text-xs font-semibold text-gray-400 text-center tabular-nums flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate" title={itemLabel(r)}>{itemLabel(r)}</div>
                    {days != null && <div className="text-xs text-red-700">{days} days overdue</div>}
                  </div>
                  <span className="text-sm font-semibold text-gray-900 flex-shrink-0 tabular-nums">{itemAmount(r)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ─── COGS lifecycle panel ─────────────────────────────────────────────
function CogsLifecyclePanel({ data }) {
  return (
    <Section title="Export COGS lifecycle" icon={Lock}
      action={<span className="text-xs text-gray-500">COGS locks at dispatch</span>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <CogsCell label="Pre-shipment" value={data.preShipment || 0} sub="Operational margin only" />
        <CogsCell label="Shipped (with COGS)" value={Math.max(0, (data.shipped || 0) - (data.shippedMissingCogs || 0))} sub="Exact profit available" />
        <CogsCell bad={data.shippedMissingCogs > 0} label="Shipped (missing COGS)" value={data.shippedMissingCogs || 0} sub={data.shippedMissingCogs > 0 ? 'Needs investigation' : 'All clear'} />
      </div>
    </Section>
  );
}
function CogsCell({ bad = false, label, value, sub }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
      <p className={kpiLabel}>{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${bad ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      <p className={`text-xs mt-1 ${bad ? 'text-red-700' : 'text-gray-500'}`}>{sub}</p>
    </div>
  );
}
// ─── Helpers ──────────────────────────────────────────────────────────
function onlyOpen(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => {
      const status = (r.status || '').toLowerCase();
      const out = parseFloat(r.outstanding) || 0;
      return out > 0 && status !== 'paid' && status !== 'void' && status !== 'cancelled';
    });
}
function isOverdue(r) {
  const status = (r.status || '').toLowerCase();
  if (status === 'overdue') return true;
  const due = r.dueDate || r.due_date;
  if (!due) return false;
  const days = ageDays(due);
  return days != null && days > 0 && (parseFloat(r.outstanding) || 0) > 0;
}

// bucketize / ageDays / ageBucket / BUCKET_KEYS / BUCKET_COLORS now
// live in ../utils/aging.js — shared with MoneyIn.

// Consolidated payroll KPIs for the Head-Office Finance dashboard. Reads the
// existing mill payroll data (reports.view) — creates no payroll data, and the
// operational payroll stays in Mill Finance. Hidden if the endpoint is denied.
function PayrollSummaryStrip({ navigate, fmtPKR }) {
  const month = new Date().toISOString().slice(0, 7);
  const { data, isError } = useQuery({
    queryKey: ['payroll-overview', month],
    queryFn: async () => { const res = await reportingApi.payrollOverview({ month }); return res?.period ? res : (res?.data || res); },
    retry: false,
  });
  if (isError || !data) return null;
  const cards = [
    { label: 'Payroll this month', value: fmtPKR(data.paidThisMonth || 0), sub: `${data.runsThisMonth || 0} run(s)` },
    { label: 'Advance recovered', value: fmtPKR(data.advanceRecoveredThisMonth || 0), sub: 'this month', tone: 'amber' },
    { label: 'Advances outstanding', value: fmtPKR(data.advancesOutstanding || 0), sub: 'to recover', tone: 'amber' },
    { label: 'Active mill staff', value: String(data.activeWorkers || 0), sub: 'on payroll' },
    { label: 'Payroll % of expenses', value: `${data.payrollPctOfExpenses || 0}%`, sub: 'this month' },
  ];
  return (
    <Section title={`Payroll summary · ${month}`} icon={Users}
      action={(
        <div className="flex items-center gap-1">
          <Link to="/reports/payroll-analytics" className={btnQuiet}>Analytics</Link>
          <Link to="/reports/payroll" className={btnQuiet}>Ledger <ChevronRight size={14} aria-hidden="true" /></Link>
        </div>
      )}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {cards.map((c, i) => (
          <button key={i} type="button" onClick={() => navigate('/reports/payroll')}
            className="min-w-0 text-left rounded-lg border border-gray-100 bg-gray-50 p-3 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <p className={kpiLabel}>{c.label}</p>
            <p className={`text-base font-bold tabular-nums break-words ${c.tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{c.value}</p>
            <p className="text-xs text-gray-500">{c.sub}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-3">Operational payroll (employees, attendance, runs, advances) lives in Mill Finance → Payroll.</p>
    </Section>
  );
}

// The server's warning text still says "Finance → Rates"; point it at the
// Rates view instead of leaving the reader to find it.
function WarningText({ text, ratesHref }) {
  const marker = 'Finance → Rates';
  const at = String(text).indexOf(marker);
  if (at < 0) return <span className="opacity-95">{text}</span>;
  return (
    <span className="opacity-95">
      {text.slice(0, at)}
      <Link to={ratesHref} className="underline font-semibold">Accounting › Rates</Link>
      {text.slice(at + marker.length)}
    </span>
  );
}
