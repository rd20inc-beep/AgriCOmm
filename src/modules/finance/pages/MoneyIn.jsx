import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, DollarSign, AlertTriangle, CheckCircle, Clock, Eye, X, Printer } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart, FinanceFilterBar } from '../../../components/finance';
import { useReceivables, useRecordPayment, useBankAccounts, useReceivableReceipts, useAcceptLocalSalePayment } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import TransactionDocument from '../../../components/TransactionDocument';
import StatusBadge from '../../../components/StatusBadge';
import PartyLink from '../../../shared/components/PartyLink';
import { toPkr } from '../utils/fx';
import { bucketize, BUCKET_KEYS } from '../utils/aging';
import { shortenRef } from '../utils/refs';

// Currency-aware formatter — picks $ / Rs / € / £ from the row's currency.
function fmtCur(n, currency = 'USD') {
  const symbol = currency === 'PKR' ? 'Rs '
    : currency === 'EUR' ? '€'
    : currency === 'GBP' ? '£'
    : currency === 'AED' ? 'AED '
    : '$';
  if (n == null || isNaN(n)) return `${symbol}0`;
  if (Math.abs(n) >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 100_000) return `${symbol}${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}K`;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}
// PKR equivalent of any row — prefers locked base_amount_pkr, falls back
// to amount × fx_rate, finally amount as-is for PKR rows. Falls back
// to DEFAULT_FX_RATE only when neither a stamped base PKR nor a row
// fx_rate is present.
function pkrOf(row, key = 'outstanding') {
  const amount = parseFloat(row?.[key]) || 0;
  if (!amount) return 0;
  if ((row?.currency || 'USD') === 'PKR') return amount;
  const base = parseFloat(row?.baseAmountPkr) || 0;
  if (base > 0 && key === 'expectedAmount') return base;
  return toPkr(amount, row?.currency, row?.fxRate);
}
// Backwards-compat helper kept for existing call sites that don't yet
// pass a currency (treats input as already-formatted number in PKR).
function fmt(n) { return fmtCur(n, 'USD'); }
// Human-readable payment method label.
function methodLabel(m) {
  const map = { bank_transfer: 'Bank Transfer / TT', cash: 'Cash', cheque: 'Cheque', lc: 'Letter of Credit', online: 'Online' };
  return map[m] || (m ? m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
}

export default function MoneyIn() {
  const { addToast, companyProfileData } = useApp();
  const qc = useQueryClient();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: receivables = [], isLoading } = useReceivables(rangeParams);
  const recordPaymentMut = useRecordPayment();
  const acceptLocalSaleMut = useAcceptLocalSalePayment();
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [drawer, setDrawer] = useState(null);

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

  // Status comparisons are case-insensitive — the CHECK constraint
  // forces capitalised values today, but Local Sales / future writers
  // could drift. eqStatus normalises the comparison.
  const eqStatus = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  const filtered = useMemo(() => {
    return receivables.filter(r => {
      if (statusFilter !== 'All' && !eqStatus(r.status, statusFilter)) return false;
      if (typeFilter !== 'All' && r.type !== typeFilter) return false;
      return true;
    }).map(r => ({
      ...r,
      _highlight: eqStatus(r.status, 'Overdue') ? 'danger' : undefined,
    }));
  }, [receivables, statusFilter, typeFilter]);

  // KPI calculations — totals in PKR so USD and local currency rows aggregate correctly
  const totalOutstandingPkr = receivables.filter(r => !eqStatus(r.status, 'Paid')).reduce((s, r) => s + pkrOf(r, 'outstanding'), 0);
  const overdueAmountPkr = receivables.filter(r => eqStatus(r.status, 'Overdue')).reduce((s, r) => s + pkrOf(r, 'outstanding'), 0);
  const collectedThisMonthPkr = receivables.reduce((s, r) => s + pkrOf(r, 'receivedAmount'), 0);
  const pendingCount = receivables.filter(r => eqStatus(r.status, 'Pending')).length;
  // Foreign-currency exposure (USD/EUR/GBP) for the "$ also" sub-line on KPIs
  const totalOutstandingForeign = receivables
    .filter(r => !eqStatus(r.status, 'Paid') && (r.currency || 'USD') !== 'PKR')
    .reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);

  // Aging data — bucket edges live in ../utils/aging so they can't
  // drift away from the Overview's aging chart.
  const agingData = useMemo(() => {
    // Bucket by real days-overdue (from due_date) via the shared helper — the
    // stored r.aging column is always 0, which put every receivable in "0-30".
    const b = bucketize(receivables, { mode: 'mixed' });
    return BUCKET_KEYS.map(name => ({ name, value: Math.round(b[name].totalPkr) }));
  }, [receivables]);

  const columns = [
    { key: 'recvNo', label: 'Ref', sortable: true, width: '110px', render: (v, row) => {
      const short = shortenRef(v);
      const inner = <span title={v || ''}>{short || '—'}</span>;
      if (row.orderId) return <Link to={`/export/${row.orderId}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline whitespace-nowrap" onClick={e => e.stopPropagation()}>{inner}</Link>;
      return inner;
    }},
    { key: 'customerName', label: 'Customer', sortable: true, render: (v, row) => <PartyLink type="customer" id={row.customerId} name={v} /> },
    { key: 'type', label: 'Type', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'Advance' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{v}</span>
    )},
    { key: 'expectedAmount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => (
      <div className="flex flex-col items-end">
        <span className="text-gray-900">{fmtCur(v, row.currency)}</span>
        {(row.currency || 'USD') !== 'PKR' && <span className="text-[10px] text-gray-400">{fmtCur(pkrOf(row, 'expectedAmount'), 'PKR')}</span>}
      </div>
    )},
    { key: 'receivedAmount', label: 'Received', sortable: true, align: 'right', render: (v, row) => (
      <div className="flex flex-col items-end">
        <span className="text-emerald-600">{fmtCur(v, row.currency)}</span>
        {(row.currency || 'USD') !== 'PKR' && parseFloat(v) > 0 && <span className="text-[10px] text-gray-400">{fmtCur(pkrOf(row, 'receivedAmount'), 'PKR')}</span>}
      </div>
    )},
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v, row) => {
      const n = parseFloat(v) || 0;
      if (n <= 0) return <span className="text-gray-400">—</span>;
      return (
        <div className="flex flex-col items-end">
          <span className="text-red-600 font-medium">{fmtCur(v, row.currency)}</span>
          {(row.currency || 'USD') !== 'PKR' && <span className="text-[10px] text-gray-400">{fmtCur(pkrOf(row, 'outstanding'), 'PKR')}</span>}
        </div>
      );
    }},
    { key: 'dueDate', label: 'Due', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—' },
    { key: 'status', label: 'Status', sortable: true },
  ];

  const { data: bankAccounts = [] } = useBankAccounts();
  // Receipt history for the open drawer row — where/how each partial was received.
  const { data: receiptData, isLoading: receiptsLoading } = useReceivableReceipts(
    drawer?.id,
    drawer?.kind === 'local_sale' ? 'local_sale' : 'export',
    !!drawer,
  );
  const [recvForm, setRecvForm] = useState({ amount: '', bankAccountId: '', paymentMethod: 'bank_transfer', paymentDate: new Date().toISOString().split('T')[0], chequeNo: '', dueDate: '', notes: '' });

  function openDrawer(row) {
    setDrawer(row);
    setRecvForm({
      amount: String(parseFloat(row.outstanding) || 0),
      bankAccountId: '',
      paymentMethod: 'bank_transfer',
      paymentDate: new Date().toISOString().split('T')[0],
      chequeNo: '', dueDate: '',
      notes: '',
    });
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    const recv = drawer;
    const amount = parseFloat(recvForm.amount);
    if (!amount || amount <= 0) { addToast('Enter a valid amount', 'error'); return; }
    try {
      if (recv.kind === 'local_sale') {
        // Local-sale rows carry a local_sales id (NOT a receivables id), so they
        // settle via the local-sale accept-payment endpoint, not recordPayment.
        // (A derived receivable RCV-LS-N has type 'Local Sale' but kind
        // 'receivable' + a receivables id — it goes the recordPayment route.)
        await acceptLocalSaleMut.mutateAsync({
          saleId: recv.id,
          data: {
            amount,
            payment_method: recvForm.paymentMethod,
            payment_date: recvForm.paymentDate,
            bank_account_id: recvForm.bankAccountId || null,
            reference: recvForm.chequeNo || null,
            due_date: recvForm.dueDate || null,
          },
        });
      } else {
        await recordPaymentMut.mutateAsync({
          type: 'receipt', amount,
          currency: recv.currency || 'USD',
          payment_method: recvForm.paymentMethod,
          payment_date: recvForm.paymentDate,
          bank_account_id: recvForm.bankAccountId || null,
          bank_reference: recvForm.chequeNo || null,
          due_date: recvForm.dueDate || null,
          linked_receivable_id: recv.dbId || recv.id,
          notes: recvForm.notes || `Payment for ${recv.recvNo}`,
        });
      }
      addToast(`Payment of ${fmtCur(amount, recv.currency)} recorded for ${recv.recvNo}`, 'success');
      setDrawer(null);
      // Force the list (and Due Dates / overview) to refresh so a now-settled
      // row drops out immediately.
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['local-sales'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (err) {
      addToast(`Failed: ${err?.data?.message || err.message}`, 'error');
    }
  }

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  return (
    <div className="space-y-6">
      <div className="print-report space-y-6">
        {/* Print-only header */}
        <div className="hidden print:block">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between mb-4">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
              <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Money In — Receivables</div>
              <div className="text-xs text-gray-600">
                {receivables.length} entries · Outstanding {fmtCur(totalOutstandingPkr, 'PKR')} · Overdue {fmtCur(overdueAmountPkr, 'PKR')}
              </div>
            </div>
          </div>
        </div>

      {/* Summary KPIs — totals in PKR; foreign equivalent shown when present */}
      <div className="grid grid-cols-4 gap-3">
        <FinanceKPI icon={ArrowDownLeft} title="Total Receivables" value={fmtCur(totalOutstandingPkr, 'PKR')}
          subtitle={totalOutstandingForeign > 0 ? `${fmtCur(totalOutstandingForeign, 'USD')} · ${receivables.filter(r => r.status !== 'Paid').length} open` : `${receivables.filter(r => r.status !== 'Paid').length} open`} status="info" loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Overdue" value={fmtCur(overdueAmountPkr, 'PKR')}
          subtitle="Past due date" status={overdueAmountPkr > 0 ? 'danger' : 'good'} loading={isLoading} />
        <FinanceKPI icon={CheckCircle} title="Collected" value={fmtCur(collectedThisMonthPkr, 'PKR')}
          subtitle="Total received" status="good" loading={isLoading} />
        <FinanceKPI icon={Clock} title="Pending" value={String(pendingCount)}
          subtitle="Awaiting payment" status={pendingCount > 0 ? 'warning' : 'good'} loading={isLoading} />
      </div>

      {/* Aging Chart */}
      <FinanceChart title="Aging Breakdown" type="bar" data={agingData} xKey="name"
        series={[{ key: 'value', name: 'Outstanding', color: '#3b82f6' }]} height={200} loading={isLoading} />

      {/* Filters */}
      <FinanceFilterBar
        filters={[
          { key: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'All', label: 'All Status' }, { value: 'Pending', label: 'Pending' }, { value: 'Partial', label: 'Partial' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Paid', label: 'Paid' }] },
          { key: 'type', label: 'Type', value: typeFilter, onChange: setTypeFilter,
            options: [{ value: 'All', label: 'All Types' }, { value: 'Advance', label: 'Advance' }, { value: 'Balance', label: 'Balance' }] },
        ]}
        onReset={() => { setStatusFilter('All'); setTypeFilter('All'); }}
      />

      {/* Table */}
      <FinanceTable
        columns={columns}
        data={filtered}
        searchKeys={['customerName', 'recvNo', 'orderId']}
        onRowClick={openDrawer}
        exportFilename="receivables"
        emptyText="No receivables found"
        loading={isLoading}
        actions={(row) => (
          <div className="inline-flex items-center gap-1.5">
            {row.status !== 'Paid' && parseFloat(row.outstanding) > 0 && (
              <button onClick={(e) => { e.stopPropagation(); openDrawer(row); }}
                className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                <DollarSign size={12} /> Receive
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); openDrawer(row); }} className="text-blue-600 hover:text-blue-800 p-1" title="View details">
              <Eye size={15} />
            </button>
          </div>
        )}
      />
      </div>{/* /.print-report */}

      {/* Detail Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{drawer.recvNo}</h2>
                <p className="text-sm text-gray-500"><PartyLink type="customer" id={drawer.customerId} name={drawer.customerName} /> &middot; <StatusBadge status={drawer.status} /></p>
              </div>
              <button onClick={() => setDrawer(null)} className="p-2 rounded-md hover:bg-gray-200"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Expected</p>
                  <p className="text-sm font-semibold">{fmtCur(drawer.expectedAmount, drawer.currency)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-600">Received</p>
                  <p className="text-sm font-semibold text-emerald-700">{fmtCur(drawer.receivedAmount, drawer.currency)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Outstanding</p>
                  <p className="text-sm font-semibold text-red-700">{fmtCur(drawer.outstanding, drawer.currency)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Type</p><p>{drawer.type}</p></div>
                <div><p className="text-xs text-gray-500">Due Date</p><p>{drawer.dueDate ? new Date(drawer.dueDate).toLocaleDateString() : '—'}</p></div>
                <div><p className="text-xs text-gray-500">Currency</p><p>{drawer.currency || 'USD'}</p></div>
                <div><p className="text-xs text-gray-500">Order</p>{drawer.orderId ? <Link to={`/export/${drawer.orderId}`} className="text-blue-600 hover:underline font-medium">View Order →</Link> : <p>—</p>}</div>
              </div>

              {/* Receipts received — where & how each partial payment came in. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Receipts Received</h3>
                  {receiptData?.collectionLocation && (
                    <span className="text-xs text-gray-500">Collection: <span className="font-medium text-gray-700 capitalize">{receiptData.collectionLocation}</span></span>
                  )}
                </div>
                {receiptsLoading ? (
                  <p className="text-xs text-gray-400 py-2">Loading receipts…</p>
                ) : (receiptData?.payments?.length ? (
                  <div className="space-y-2">
                    {receiptData.payments.map((p) => {
                      let into = [p.accountName, p.bankName].filter(Boolean).join(' · ');
                      if (!into) into = p.paymentMethod === 'cash' ? 'Cash (in hand)' : '—';
                      return (
                        <div key={p.id} className="border border-gray-200 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-emerald-700">{fmtCur(p.amount, p.currency || drawer.currency)}</span>
                            <span className="text-xs text-gray-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            <span>Method: <span className="font-medium text-gray-700">{methodLabel(p.paymentMethod)}</span></span>
                            <span>Into: <span className="font-medium text-gray-700">{into || '—'}</span></span>
                            {p.bankReference && <span>Ref/Cheque: <span className="font-medium text-gray-700">{p.bankReference}</span></span>}
                          </div>
                          {p.notes && <p className="mt-0.5 text-[11px] text-gray-400 truncate" title={p.notes}>{p.notes}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-2">No receipts recorded yet.</p>
                ))}
              </div>

              {/* Downloadable / printable payment receipt */}
              <div className="pt-2 border-t border-gray-100">
                <TransactionDocument kind="receipt" data={drawer} companyProfile={companyProfileData} />
              </div>
            </div>
            {drawer.status !== 'Paid' && parseFloat(drawer.outstanding) > 0 && (
              <form onSubmit={handleRecordPayment} className="px-6 py-4 border-t border-gray-200 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Record Receipt</h3>

                {/* Payment Method — first; it drives whether an account is needed. */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Payment Method</label>
                  <select value={recvForm.paymentMethod}
                    onChange={e => { const m = e.target.value; setRecvForm({ ...recvForm, paymentMethod: m, bankAccountId: (m === 'cash' || m === 'cheque') ? '' : recvForm.bankAccountId }); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="bank_transfer">Bank Transfer / TT</option>
                    <option value="lc">Letter of Credit</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                  </select>
                </div>

                {/* Cheque details — number (optional) + the date it clears, so
                    Due Dates knows when to expect the money. No account picked. */}
                {recvForm.paymentMethod === 'cheque' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Cheque # <span className="text-gray-300">(optional)</span></label>
                      <input type="text" value={recvForm.chequeNo} onChange={e => setRecvForm({ ...recvForm, chequeNo: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 004512" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Cheque date</label>
                      <input type="date" value={recvForm.dueDate} onChange={e => setRecvForm({ ...recvForm, dueDate: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                )}

                {/* Receive Into Account — only for account-based methods; Cash &
                    Cheque don't need one. */}
                {recvForm.paymentMethod !== 'cash' && recvForm.paymentMethod !== 'cheque' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Receive Into Account</label>
                    <select value={recvForm.bankAccountId} onChange={e => setRecvForm({ ...recvForm, bankAccountId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select bank account...</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.bankName || ''} ({a.currency || 'PKR'} {Math.round(parseFloat(a.currentBalance) || 0).toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Amount + Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Amount ({drawer.currency || 'USD'})</label>
                    <input type="number" step="0.01" required value={recvForm.amount}
                      onChange={e => setRecvForm({ ...recvForm, amount: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Date</label>
                    <input type="date" required value={recvForm.paymentDate}
                      onChange={e => setRecvForm({ ...recvForm, paymentDate: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notes</label>
                  <input type="text" value={recvForm.notes} onChange={e => setRecvForm({ ...recvForm, notes: e.target.value })}
                    placeholder={`Receipt for ${drawer.recvNo}`}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Quick amounts */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setRecvForm({ ...recvForm, amount: String(parseFloat(drawer.outstanding)) })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Full Amount</button>
                  <button type="button" onClick={() => setRecvForm({ ...recvForm, amount: String(Math.round(parseFloat(drawer.outstanding) / 2)) })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Half</button>
                  <button type="button" onClick={() => setRecvForm({ ...recvForm, amount: '' })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Custom</button>
                </div>

                <button type="submit" disabled={recordPaymentMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm disabled:opacity-50">
                  <CheckCircle size={16} />
                  {recordPaymentMut.isPending ? 'Processing...' : `Record Receipt — ${fmtCur(parseFloat(recvForm.amount) || 0, drawer.currency)}`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
