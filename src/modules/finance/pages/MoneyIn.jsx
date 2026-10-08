import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, DollarSign, AlertTriangle, CheckCircle, Clock, Eye } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceFilterBar } from '../../../components/finance';
import ListCapHint from '../../../shared/components/ListCapHint';
import { useReceivables } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import PartyLink from '../../../shared/components/PartyLink';
import { BUCKET_KEYS } from '../utils/aging';
import { moneyInTiles, agingByCurrency, curOf } from '../utils/moneyTiles';
import { shortenRef } from '../utils/refs';
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { fmtAmt } from '../drawers/drawerLogic';
import { PerCurrency } from '../drawers/drawerParts';
import { fmtDate, fmtDateTime } from '../../../shared/utils/format';

const eqStatus = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const docOf = (row) => ({ docKind: row.kind === 'local_sale' ? 'local_sale' : 'receivable', row });

// Money In ▸ Receivables. A row opens its Document drawer (what is owed,
// every receipt, Receive); Receive opens the shared Payment form directly —
// an export order's advance / balance is recorded for Finance to confirm,
// exactly as on the order. The button shows only to a role whose route
// guard would take the receipt.
export default function MoneyIn() {
  const { companyProfileData } = useApp() || {};
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: receivables = [], isLoading } = useReceivables(rangeParams);
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  const filtered = useMemo(() => receivables.filter((r) => {
    if (statusFilter !== 'All' && !eqStatus(r.status, statusFilter)) return false;
    if (typeFilter !== 'All' && r.type !== typeFilter) return false;
    return true;
  }).map((r) => ({ ...r, _highlight: eqStatus(r.status, 'Overdue') ? 'danger' : undefined })), [receivables, statusFilter, typeFilter]);

  const tiles = useMemo(() => moneyInTiles(receivables), [receivables]);
  const aging = useMemo(() => agingByCurrency(receivables), [receivables]);
  const canReceive = (row) => {
    const d = docOf(row);
    return isSettleable(d) && canRecordVariant(contextForDocument(d)?.variant, hasPermission);
  };

  const columns = [
    { key: 'recvNo', label: 'Ref', sortable: true, width: '110px', render: (v, row) => {
      const inner = <span title={v || ''}>{shortenRef(v) || '—'}</span>;
      if (row.orderId && hasPermission('export_orders', 'view')) return <Link to={`/export/${row.orderId}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{inner}</Link>;
      return inner;
    }},
    { key: 'customerName', label: 'Customer', sortable: true, render: (v, row) => <span className="block max-w-[14rem] truncate" title={v || ''}><PartyLink type="customer" id={row.customerId} name={v} /></span> },
    { key: 'type', label: 'Type', sortable: true, render: (v, row) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'Advance' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
        {v}{row.kind === 'local_sale' && row.lineCount > 1 ? ` · ${row.lineCount} items` : ''}
      </span>
    )},
    { key: 'expectedAmount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => <span className="text-gray-900 tabular-nums">{fmtAmt(v, curOf(row))}</span> },
    { key: 'receivedAmount', label: 'Received', sortable: true, align: 'right', render: (v, row) => <span className="text-emerald-600 tabular-nums">{fmtAmt(v, curOf(row))}</span> },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v, row) => (
      (parseFloat(v) || 0) <= 0 ? <span className="text-gray-400">—</span>
        : <span className="text-red-600 font-medium tabular-nums">{fmtAmt(v, curOf(row))}</span>
    )},
    { key: 'dueDate', label: 'Due', sortable: true, render: (v) => <span className="whitespace-nowrap">{fmtDate(v)}</span> },
    { key: 'status', label: 'Status', sortable: true },
  ];

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const agingCurrencies = Object.keys(aging);
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
              <div className="text-lg font-bold">Money In — Receivables</div>
              <div className="text-xs text-gray-600">
                {receivables.length} entries · Outstanding <PerCurrency totals={tiles.outstanding} /> · Overdue <PerCurrency totals={tiles.overdue} />
              </div>
            </div>
          </div>
        </div>

        {/* Tiles — one figure per currency, never summed across currencies */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <FinanceKPI icon={ArrowDownLeft} title="Outstanding" value={<PerCurrency totals={tiles.outstanding} empty="Nothing open" className="flex-col" />}
            subtitle={`${tiles.openCount} open`} status="info" loading={isLoading} />
          <FinanceKPI icon={AlertTriangle} title="Overdue" value={<PerCurrency totals={tiles.overdue} empty="None" className="flex-col" />}
            subtitle="Past due date" status={Object.keys(tiles.overdue).length ? 'danger' : 'good'} loading={isLoading} />
          <FinanceKPI icon={CheckCircle} title="Collected" value={<PerCurrency totals={tiles.collected} empty="—" className="flex-col" />}
            subtitle="Received so far" status="good" loading={isLoading} />
          <FinanceKPI icon={Clock} title="Pending" value={String(tiles.pendingCount)}
            subtitle="Awaiting payment" status={tiles.pendingCount > 0 ? 'warning' : 'good'} loading={isLoading} />
        </div>

        {/* Aging — days past due, one row per currency */}
        {agingCurrencies.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto" data-testid="aging-by-currency">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-4 py-2 font-medium">Aging</th>
                {BUCKET_KEYS.map((k) => <th key={k} className="text-right px-4 py-2 font-medium">{k} days</th>)}
              </tr></thead>
              <tbody>
                {agingCurrencies.map((c) => (
                  <tr key={c} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-700">{c}</td>
                    {BUCKET_KEYS.map((k) => <td key={k} className="px-4 py-2 text-right tabular-nums">{aging[c][k] ? fmtAmt(aging[c][k], c) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FinanceFilterBar
          filters={[
            { key: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter,
              options: [{ value: 'All', label: 'All Status' }, { value: 'Pending', label: 'Pending' }, { value: 'Credit', label: 'Credit' }, { value: 'Partial', label: 'Partial' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Paid', label: 'Paid' }] },
            { key: 'type', label: 'Type', value: typeFilter, onChange: setTypeFilter,
              options: [{ value: 'All', label: 'All Types' }, { value: 'Advance', label: 'Advance' }, { value: 'Balance', label: 'Balance' }, { value: 'Local Sale', label: 'Local sale' }] },
          ]}
          onReset={() => { setStatusFilter('All'); setTypeFilter('All'); }}
        />

        <ListCapHint rows={receivables} />
        <FinanceTable
          columns={columns}
          data={filtered}
          searchKeys={['customerName', 'recvNo', 'orderId']}
          onRowClick={(row) => drawers?.openDocument(docOf(row))}
          exportFilename="receivables"
          emptyText="No receivables found"
          loading={isLoading}
          actions={(row) => (
            <div className="inline-flex items-center gap-1.5">
              {canReceive(row) && (
                <button onClick={(e) => { e.stopPropagation(); drawers?.openPayment(docOf(row)); }} data-action="receive"
                  className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                  <DollarSign size={12} /> Receive
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); drawers?.openDocument(docOf(row)); }} className="text-blue-600 hover:text-blue-800 p-1" title="View details" aria-label="View details">
                <Eye size={15} />
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
