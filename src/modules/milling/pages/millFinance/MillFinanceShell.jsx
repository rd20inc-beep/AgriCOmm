import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign, Wallet, Users, TrendingUp, Plus, Banknote, HandCoins, ArrowLeftRight, ShoppingCart,
  UserPlus, RefreshCw, Sparkles, Printer, FileText, BookOpen, ArrowLeft, ChevronRight,
} from 'lucide-react';
import NewPurchaseDrawer from '../../../../components/NewPurchaseDrawer';
import TransferFundsDrawer from '../../../finance/components/TransferFundsDrawer';
import useMillFinanceLocation from './hooks/useMillFinanceLocation';
import useMillFinancePerms from './hooks/useMillFinancePerms';
import MoreActionsMenu from './components/MoreActionsMenu';
import ExpenseFormDrawer from './drawers/ExpenseFormDrawer';
import PartyPayPicker from './drawers/PartyPayPicker';
import OverviewSection from './sections/OverviewSection';
import TransactionsSection from './sections/TransactionsSection';
import PartiesSection from './sections/PartiesSection';
import PerformanceSection from './sections/PerformanceSection';
import PayrollWorkspace from './payroll/PayrollWorkspace';
import { PERIOD_OPTIONS } from './constants';
import { mfHref } from './urlState';

const SECTIONS = [
  { key: 'overview', label: 'Overview', icon: DollarSign },
  { key: 'transactions', label: 'Transactions', icon: Wallet },
  { key: 'parties', label: 'Parties', icon: Users },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
];

function printPage() {
  // Same mask pattern as FinanceLayout — body.app-print-mask makes the global
  // @media print rule unhide only .print-report.
  document.body.classList.add('app-print-mask');
  const cleanup = () => {
    document.body.classList.remove('app-print-mask');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60_000);
  window.print();
}

function PeriodControl({ period, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 w-fit no-print" role="group" aria-label="Period" data-testid="mf-period">
      {PERIOD_OPTIONS.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={period === k}
          className={`px-2.5 py-1 text-xs rounded-md ${period === k ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
      ))}
    </div>
  );
}

/**
 * Mill Finance (P5-09) — split by job into four sections, URL-backed:
 * Overview · Transactions · Parties · Performance. Payroll is its own
 * workspace. Four primary actions, each permission-gated and each opening the
 * existing drawer / payment engine; the rest live under More actions.
 */
export default function MillFinanceShell() {
  const loc = useMillFinanceLocation();
  const perms = useMillFinancePerms();
  const [action, setAction] = useState(null); // expense | paySupplier | receive | transfer | storePurchase
  const close = () => setAction(null);

  if (loc.workspace === 'payroll') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm no-print">
          <Link to={mfHref({ section: 'overview' }, loc.period)} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
            <ArrowLeft size={14} aria-hidden="true" /> Mill Finance
          </Link>
          <ChevronRight size={14} className="text-gray-300" aria-hidden="true" />
          <span className="font-medium text-gray-800">Payroll</span>
        </div>
        {perms.canViewPayroll
          ? <PayrollWorkspace defaultEntity="mill" />
          : <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500" data-testid="payroll-no-access">Payroll needs the payroll view permission.</p>}
      </div>
    );
  }

  const moreItems = [
    perms.canStorePurchase && { key: 'store-purchase', label: 'Store purchase (bags, fuel…)', icon: ShoppingCart, onClick: () => setAction('storePurchase') },
    perms.canPreparePayroll && { key: 'add-employee', label: 'Add employee', icon: UserPlus, to: '/milling/finance?workspace=payroll&add=employee' },
    perms.canViewPayroll && { key: 'payroll', label: 'Payroll workspace', icon: Users, to: mfHref({ workspace: 'payroll' }) },
    { key: 'recurring', label: 'Post due recurring expenses', icon: RefreshCw, to: mfHref({ section: 'transactions', view: 'recurring' }, loc.period) },
    { key: 'anomalies', label: 'Anomaly analysis (AI)', icon: Sparkles, to: mfHref({ section: 'performance', focus: 'anomalies' }, loc.period) },
    { key: 'rice-purchases', label: 'Rice purchases ledger', icon: BookOpen, to: '/milling/rice-purchases' },
    perms.canViewReports && { key: 'reports', label: 'Detailed reports', icon: FileText, to: '/reports' },
    perms.canFinance && { key: 'finance', label: 'Finance dashboard', icon: Wallet, to: '/finance' },
    { key: 'print', label: 'Print this page', icon: Printer, onClick: printPage },
  ].filter(Boolean);

  const primary = [
    perms.canRecordExpense && { key: 'record-expense', label: 'Record Expense', icon: Plus, onClick: () => setAction('expense') },
    perms.canPay && { key: 'pay-supplier', label: 'Pay Supplier', icon: Banknote, onClick: () => setAction('paySupplier') },
    perms.canPay && { key: 'receive-money', label: 'Receive Money', icon: HandCoins, onClick: () => setAction('receive') },
    perms.canTransfer && { key: 'transfer-funds', label: 'Transfer Funds', icon: ArrowLeftRight, onClick: () => setAction('transfer'), title: 'Send money from the Mill to Head Office' },
  ].filter(Boolean);

  return (
    <div className="space-y-5 pb-4 print-report" data-testid="mill-finance">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div className="space-y-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Mill Finance</h1>
            <p className="text-xs text-gray-500">The mill's money. Head Office balances and transfers are shown separately — never merged.</p>
          </div>
          <PeriodControl period={loc.period} onChange={loc.setPeriod} />
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print" data-testid="mf-primary-actions">
          {primary.map((a, i) => {
            const Icon = a.icon;
            return (
              <button key={a.key} type="button" onClick={a.onClick} title={a.title} data-testid={`action-${a.key}`}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${i === 0 ? 'bg-gray-900 text-white hover:bg-gray-700' : 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'}`}>
                {Icon && <Icon size={14} aria-hidden="true" />} {a.label}
              </button>
            );
          })}
          <MoreActionsMenu items={moreItems} />
        </div>
      </header>

      <nav className="flex items-center justify-between gap-2 border-b border-gray-200 no-print" aria-label="Mill Finance sections">
        <div className="flex flex-wrap items-center gap-1" role="tablist">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = loc.section === s.key;
            return (
              <button key={s.key} type="button" role="tab" aria-selected={active} data-testid={`section-${s.key}`}
                onClick={() => loc.go({ section: s.key })}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {Icon && <Icon className="w-4 h-4" aria-hidden="true" />} {s.label}
              </button>
            );
          })}
        </div>
        {perms.canViewPayroll && (
          <Link to={mfHref({ workspace: 'payroll' })} data-testid="payroll-workspace-link"
            className="inline-flex items-center gap-1 px-3 py-1.5 mb-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
            <Users size={13} aria-hidden="true" /> Payroll <ChevronRight size={12} aria-hidden="true" />
          </Link>
        )}
      </nav>

      <div role="tabpanel" aria-label={SECTIONS.find((s) => s.key === loc.section)?.label}>
        {loc.section === 'overview' && <OverviewSection period={loc.period} />}
        {loc.section === 'transactions' && <TransactionsSection view={loc.view} cat={loc.cat} period={loc.period} go={loc.go} />}
        {loc.section === 'parties' && <PartiesSection party={loc.party} supplierId={loc.supplier} customerId={loc.customer} go={loc.go} />}
        {loc.section === 'performance' && <PerformanceSection period={loc.period} focus={loc.focus} />}
      </div>

      {action === 'expense' && <ExpenseFormDrawer onClose={close} />}
      {action === 'paySupplier' && <PartyPayPicker mode="supplier" onClose={close} />}
      {action === 'receive' && <PartyPayPicker mode="customer" onClose={close} />}
      {action === 'transfer' && <TransferFundsDrawer open onClose={close} lockDirection="mill_to_ho" />}
      {action === 'storePurchase' && <NewPurchaseDrawer open onClose={close} />}
    </div>
  );
}
