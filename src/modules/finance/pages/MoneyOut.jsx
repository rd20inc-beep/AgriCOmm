import { useState, useMemo } from 'react';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import { ArrowUpRight, AlertTriangle, CheckCircle, Eye, DollarSign, Users } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceFilterBar } from '../../../components/finance';
import ListCapHint from '../../../shared/components/ListCapHint';
import { usePayables } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import PartyLink from '../../../shared/components/PartyLink';
import { shortenRef } from '../utils/refs';
import { moneyOutTiles } from '../utils/moneyTiles';
import { isDerivedPayable, derivedPayableHint } from '../../../shared/utils/derivedPayables';
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { fmtAmt, totalsByCurrency } from '../drawers/drawerLogic';
import { PerCurrency } from '../drawers/drawerParts';
import { fmtDateTime } from '../../../shared/utils/format';

const docOf = (row) => ({ docKind: 'payable', row });
const eqStatus = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// Money Out ▸ Payables. A row opens its Document drawer (what is owed, every
// payment — each opens the Transaction drawer, where Reverse lives — and Pay);
// Pay opens the shared Payment form directly (WHT / discount / document on a
// PKR payable, as before). A cost-derived row (MC- / EC- / ME-) has no payable
// to settle, so it says where it is settled instead of offering Pay.
export default function MoneyOut() {
  const { companyProfileData } = useApp() || {};
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: payables = [], isLoading } = usePayables(rangeParams);
  const [entityFilter, setEntityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = useMemo(() => payables.filter((p) => {
    if (entityFilter !== 'All' && p.entity !== entityFilter.toLowerCase()) return false;
    if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
    if (statusFilter !== 'All' && !eqStatus(p.status, statusFilter)) return false;
    return true;
  }), [payables, entityFilter, categoryFilter, statusFilter]);

  const tiles = useMemo(() => moneyOutTiles(payables), [payables]);
  // Category chips — outstanding per category, per currency (never summed).
  const byCategory = useMemo(() => {
    const cats = {};
    payables.filter((p) => !eqStatus(p.status, 'Paid')).forEach((p) => {
      const cat = p.category || 'Other';
      (cats[cat] ||= []).push({ currency: p.currency || 'PKR', outstanding: p.outstanding });
    });
    return Object.entries(cats).map(([name, rows]) => ({ name, totals: totalsByCurrency(rows), n: rows.length }))
      .sort((a, b) => b.n - a.n);
  }, [payables]);

  const canPay = (row) => {
    const d = docOf(row);
    return isSettleable(d) && canRecordVariant(contextForDocument(d)?.variant, hasPermission);
  };

  const columns = [
    { key: 'payNo', label: 'Ref', sortable: true, width: '110px', render: (v) => (
      <span className="whitespace-nowrap" title={v || ''}>{shortenRef(v) || '—'}</span>
    )},
    { key: 'entity', label: 'Entity', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'mill' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
        {v === 'mill' ? 'Mill' : 'Export'}
      </span>
    )},
    { key: 'category', label: 'Category', sortable: true },
    { key: 'supplierName', label: 'Supplier / Transporter', sortable: true, render: (v, row) => (
      v
        ? <span className="block max-w-[14rem] truncate" title={v}><PartyLink type="supplier" id={row.supplierId} name={v} /></span>
        : (row.haulerName
            ? <span className="inline-flex items-center gap-1 text-gray-800 max-w-[16rem] min-w-0" title={row.haulerName}><span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">Transporter</span><span className="truncate">{row.haulerName}</span></span>
            : <span className="text-gray-400">—</span>)
    ) },
    { key: 'linkedRef', label: 'Linked To', sortable: true, render: (v) => {
      if (!v) return '—';
      const isEx = v.startsWith('EX-'), isMill = v.startsWith('M-');
      const href = isEx ? `/export/${v}` : isMill ? `/milling/${v}` : null;
      if (href) return <OrderRefLink to={href} module={isEx ? 'export_orders' : 'milling'} onClick={(e) => e.stopPropagation()}>{v}</OrderRefLink>;
      return <span className="text-gray-700 font-medium">{v}</span>;
    }},
    { key: 'originalAmount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => <span className="text-gray-900 tabular-nums">{fmtAmt(v, row.currency)}</span> },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v, row) => (
      (parseFloat(v) || 0) <= 0 ? <span className="text-gray-400">—</span>
        : <span className="text-red-600 font-medium tabular-nums">{fmtAmt(v, row.currency)}</span>
    )},
    { key: 'status', label: 'Status', sortable: true },
  ];

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  return (
    <div className="space-y-6">
      <div className="print-report space-y-6">
        <div className="hidden print:block">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between mb-4">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
              <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Money Out — Payables</div>
              <div className="text-xs text-gray-600">
                {payables.length} entries · Outstanding <PerCurrency totals={tiles.outstanding} /> · Overdue <PerCurrency totals={tiles.overdue} />
              </div>
            </div>
          </div>
        </div>

        {/* Tiles — one figure per currency, never summed across currencies */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <FinanceKPI icon={ArrowUpRight} title="Outstanding" value={<PerCurrency totals={tiles.outstanding} empty="Nothing owed" className="flex-col" />}
            subtitle={`${tiles.openCount} outstanding`} status="neutral" loading={isLoading} />
          <FinanceKPI icon={AlertTriangle} title="Overdue" value={<PerCurrency totals={tiles.overdue} empty="None" className="flex-col" />}
            subtitle="Past due date" status={Object.keys(tiles.overdue).length ? 'danger' : 'good'} loading={isLoading} />
          <FinanceKPI icon={CheckCircle} title="Paid" value={<PerCurrency totals={tiles.paid} empty="—" className="flex-col" />}
            subtitle="Paid so far" status="good" loading={isLoading} />
          <FinanceKPI icon={Users} title="Payees" value={String(tiles.payeeCount)}
            subtitle="Suppliers & transporters" status="info" loading={isLoading} />
        </div>

        {byCategory.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {byCategory.slice(0, 6).map((cat) => (
              <button key={cat.name} onClick={() => setCategoryFilter(cat.name === categoryFilter ? 'All' : cat.name)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  categoryFilter === cat.name ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {cat.name} <PerCurrency totals={cat.totals} className="font-semibold ml-1" />
              </button>
            ))}
            {categoryFilter !== 'All' && (
              <button onClick={() => setCategoryFilter('All')} className="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600">Clear</button>
            )}
          </div>
        )}

        <FinanceFilterBar
          filters={[
            { key: 'entity', value: entityFilter, onChange: setEntityFilter,
              options: [{ value: 'All', label: 'All Entities' }, { value: 'Mill', label: 'Mill' }, { value: 'Export', label: 'Export Ops' }] },
            { key: 'status', value: statusFilter, onChange: setStatusFilter,
              options: [{ value: 'All', label: 'All Status' }, { value: 'Pending', label: 'Pending' }, { value: 'Partial', label: 'Partial' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Paid', label: 'Paid' }] },
          ]}
          onReset={() => { setEntityFilter('All'); setCategoryFilter('All'); setStatusFilter('All'); }}
        />

        <ListCapHint rows={payables} />
        <FinanceTable
          columns={columns} data={filtered}
          searchKeys={['supplierName', 'haulerName', 'payNo', 'category', 'linkedRef']}
          onRowClick={(row) => drawers?.openDocument(docOf(row))} exportFilename="payables" emptyText="No payables found" loading={isLoading}
          actions={(row) => (
            <div className="inline-flex items-center gap-1.5">
              {row.status !== 'Paid' && parseFloat(row.outstanding) > 0 && isDerivedPayable(row) && (
                <span title={derivedPayableHint(row)}
                  className="px-2.5 py-1 bg-gray-50 text-gray-400 text-xs font-medium rounded inline-flex items-center gap-1 cursor-help">
                  <DollarSign size={12} /> Settled elsewhere
                </span>
              )}
              {canPay(row) && (
                <button onClick={(e) => { e.stopPropagation(); drawers?.openPayment(docOf(row)); }} data-action="pay"
                  className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                  <DollarSign size={12} /> Pay
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); drawers?.openDocument(docOf(row)); }} className="text-blue-600 hover:text-blue-800 p-1" title="View details" aria-label="View details"><Eye size={15} /></button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
