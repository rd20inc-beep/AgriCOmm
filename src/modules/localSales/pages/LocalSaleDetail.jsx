import { Link, useParams, useNavigate } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  ArrowLeft, Store, Package, Truck, CreditCard, CheckCircle, Clock,
  AlertCircle, Receipt, User, Phone, FileText, Calendar,
} from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocalSale, useLocalSalePayments } from '../../../api/queries';
import { localSalesApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';

function fmtPkr(n) {
  return 'Rs ' + (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_TONE = {
  Paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  Partial:  'bg-amber-50 text-amber-700 border-amber-200',
  Pending:  'bg-gray-50 text-gray-600 border-gray-200',
  Credit:   'bg-blue-50 text-blue-700 border-blue-200',
  Refunded: 'bg-red-50 text-red-700 border-red-200',
};

export default function LocalSaleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: sale, isLoading, error, refetch } = useLocalSale(id);
  const { data: payments = [] } = useLocalSalePayments(id);
  const { addToast } = useApp();
  // A confirmed sale has already moved stock and posted its journals, so only
  // the presentation fields can change. While it is still Pending nothing
  // downstream exists, so quantity and rate are editable too.
  const [edit, setEdit] = useState(null);
  const saveMut = useMutation({
    mutationFn: (patch) => localSalesApi.update(id, patch),
    onSuccess: () => { addToast('Sale updated', 'success'); setEdit(null); refetch(); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Could not update the sale', 'error'),
  });

  if (isLoading) return <LoadingSpinner message="Loading sale…" />;
  if (error)     return <ErrorState message={error.message} onRetry={refetch} />;
  if (!sale)     return <div className="p-8 text-center text-gray-400 text-sm">Sale not found.</div>;

  const profitPkr = parseFloat(sale.grossProfit || sale.grossProfitPkr) || 0;
  const marginPct = parseFloat(sale.marginPct) || 0;
  const heroGradient = profitPkr >= 0
    ? 'from-purple-700 via-fuchsia-600 to-pink-500'
    : 'from-red-700 via-red-600 to-red-500';
  const statusTone = STATUS_TONE[sale.paymentStatus] || STATUS_TONE.Pending;

  return (
    <div className="space-y-5 pb-4">
      {/* Back button + Invoice 360 entry */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={15} /> Back
        </button>
        <Link to={`/local-sales/${id}/invoice`}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
          <FileText size={14} /> Open Invoice 360
        </Link>
      </div>

      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Store size={14} /> Local Sale · {sale.saleNo}
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPkr(sale.totalAmount)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {sale.buyerName || 'Walk-in'} · {Math.round(parseFloat(sale.quantityKg) || 0).toLocaleString()} kg
              {sale.quantityBags ? ` · ${sale.quantityBags} bags` : ''}
              {' · '}@ {fmtPkr(sale.ratePerKg)}/kg
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/30">
              {sale.paymentStatus === 'Paid' && <CheckCircle size={12} />}
              {sale.paymentStatus === 'Pending' && <Clock size={12} />}
              {(sale.paymentStatus === 'Partial' || sale.paymentStatus === 'Credit') && <AlertCircle size={12} />}
              {sale.paymentStatus || 'Pending'}
            </span>
            <div className="opacity-80 text-right">
              {profitPkr !== 0 && <>Profit {fmtPkr(profitPkr)} ({marginPct.toFixed(1)}%)</>}
            </div>
            <button onClick={() => setEdit({
              buyer_name: sale.buyerName || '', buyer_phone: sale.buyerPhone || '',
              buyer_address: sale.buyerAddress || '', vehicle_no: sale.vehicleNo || '',
              driver_name: sale.driverName || '', gate_pass_no: sale.gatePassNo || '',
              notes: sale.notes || '',
              quantity_input: sale.quantityInput ?? '', rate_input: sale.rateInput ?? '',
            })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 ring-1 ring-white/30 hover:bg-white/25 font-medium">
              Edit invoice
            </button>
          </div>
        </div>
      </div>

      {/* Edit. Presentation fields always; quantity and rate only while Pending,
          because a confirmed sale has posted its stock movement and journals. */}
      {edit && (
        <div className="bg-white rounded-xl border border-blue-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Edit {sale.saleNo}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${sale.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
              {sale.status === 'Pending' ? 'Pending — quantity and rate can still change' : 'Confirmed — details only'}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[['buyer_name', 'Buyer'], ['buyer_phone', 'Phone'], ['buyer_address', 'Address'],
              ['vehicle_no', 'Vehicle'], ['driver_name', 'Driver'], ['gate_pass_no', 'Gate pass']].map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-[11px] text-gray-500">{label}</span>
                <input value={edit[k]} onChange={(e) => setEdit(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
              </label>
            ))}
            {sale.status === 'Pending' && (
              <>
                <label className="block">
                  <span className="text-[11px] text-gray-500">Quantity ({sale.quantityUnit || 'kg'})</span>
                  <input type="number" min="0" step="0.01" value={edit.quantity_input}
                    onChange={(e) => setEdit(p => ({ ...p, quantity_input: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-500">Rate (per {sale.rateUnit || 'kg'})</span>
                  <input type="number" min="0" step="0.01" value={edit.rate_input}
                    onChange={(e) => setEdit(p => ({ ...p, rate_input: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums" />
                </label>
              </>
            )}
          </div>
          <label className="block">
            <span className="text-[11px] text-gray-500">Notes</span>
            <textarea rows={2} value={edit.notes} onChange={(e) => setEdit(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            <button disabled={saveMut.isPending}
              onClick={() => {
                const patch = { ...edit };
                // Don't send quantity/rate on a confirmed sale — the server would
                // refuse the whole request rather than saving the buyer's name.
                if (sale.status !== 'Pending') { delete patch.quantity_input; delete patch.rate_input; }
                saveMut.mutate(patch);
              }}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saveMut.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Key facts grid ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card icon={Calendar} label="Sale date" value={fmtDate(sale.saleDate)} />
        <Card icon={Package} label="Item / lot"
          value={sale.itemName || '—'}
          sub={sale.lotNo
            ? <Link to={`/lot-inventory/${sale.lotNo}`} className="text-blue-600 hover:underline">{sale.lotNo}</Link>
            : null} />
        <Card icon={User} label="Buyer" value={<PartyLink type="customer" id={sale.customerId} name={sale.buyerName || sale.customerName} fallback="Walk-in" />}
          sub={sale.buyerPhone ? <span className="inline-flex items-center gap-1"><Phone size={11} />{sale.buyerPhone}</span> : null} />
        <Card icon={CreditCard} label="Payment mode" value={(sale.paymentMode || '—').toString().replace(/_/g, ' ')} />
        <Card icon={Receipt} label="Collected" value={fmtPkr(sale.paidAmount)}
          sub={parseFloat(sale.dueAmount) > 0 ? `Due ${fmtPkr(sale.dueAmount)}` : 'Fully collected'} />
        <Card icon={Truck} label="Dispatch"
          value={sale.dispatched ? 'Dispatched' : 'Pending dispatch'}
          sub={sale.dispatchDate ? fmtDate(sale.dispatchDate) : null} />
      </div>

      {/* ─── Buyer details if extended ────────────────────────────── */}
      {(sale.buyerAddress || sale.vehicleNo || sale.driverName || sale.notes) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Additional details</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {sale.buyerAddress && <Detail label="Address" value={sale.buyerAddress} />}
            {sale.vehicleNo    && <Detail label="Vehicle" value={sale.vehicleNo} />}
            {sale.driverName   && <Detail label="Driver"  value={sale.driverName} />}
            {sale.paymentReference && <Detail label="Payment ref" value={sale.paymentReference} />}
            {sale.notes && <Detail label="Notes" value={sale.notes} full />}
          </dl>
        </div>
      )}

      {/* ─── Cost breakdown ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Profitability</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <Row label="Revenue (total sale)" value={fmtPkr(sale.totalAmount)} />
            <Row label="Cost of goods sold"  value={`(${fmtPkr(sale.cogsTotalPkr || sale.landedCostTotal)})`} />
            <Row label="Gross profit"        value={fmtPkr(profitPkr)} highlight />
            <Row label="Margin %"             value={`${marginPct.toFixed(1)}%`} />
            {parseFloat(sale.cogsPerKg) > 0 && <Row label="Cost per kg" value={fmtPkr(sale.cogsPerKg)} />}
            {parseFloat(sale.profitPerKg) !== 0 && <Row label="Profit per kg" value={fmtPkr(sale.profitPerKg)} />}
          </tbody>
        </table>
      </div>

      {/* ─── Payment history ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Payments</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${statusTone}`}>{sale.paymentStatus || 'Pending'}</span>
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {sale.paymentStatus === 'Paid' && parseFloat(sale.paidAmount) > 0
              ? 'Paid in full at sale time — no separate payment receipts recorded.'
              : 'No payments recorded against this sale yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map(p => (
                  <tr key={p.id}>
                    <td data-label="Date" className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(p.paymentDate || p.createdAt)}</td>
                    <td data-label="Method" className="px-3 py-2 text-gray-700 capitalize">{(p.paymentMethod || '—').replace(/_/g, ' ')}</td>
                    <td data-label="Reference" className="mob-hide px-3 py-2 text-gray-500 text-xs">{p.reference || p.notes || '—'}</td>
                    <td data-label="Amount" className="px-3 py-2 text-right font-medium text-emerald-700">{fmtPkr(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-[11px] text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-1">
        <Icon size={11} /> {label}
      </div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Detail({ label, value, full }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <tr className={highlight ? 'font-semibold bg-emerald-50/50' : ''}>
      <td className="px-3 py-2 text-gray-700">{label}</td>
      <td className="px-3 py-2 text-right text-gray-900 tabular-nums">{value}</td>
    </tr>
  );
}
