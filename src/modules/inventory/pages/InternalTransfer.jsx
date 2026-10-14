import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Calendar, CheckCircle, Clock, Truck, Loader2, ArrowDown, Info } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useInternalTransfers, useInternalTransfer, useConfirmTransferExport } from '../../../api/queries';

// Only finance / owner (management) see which export order a transfer is linked
// to; mill-side roles transfer to the export pool.
const ORDER_LINK_ROLES = ['Super Admin', 'Owner', 'Finance Manager'];
import StatusBadge from '../../../components/StatusBadge';
import SlideDrawer from '../../../components/SlideDrawer';
import { fmtPKR, fmtUSD, fmtNum, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { transferKg } from '../utils/stockMath';
import { perMtToPerKg } from '../../../shared/utils/unitConversion';

const formatPKR = (value) => fmtPKR(parseFloat(value) || 0, { decimals: 2 });
const formatUSD = (value) => fmtUSD(parseFloat(value) || 0);

// Read-only history of Mill → Export stock transfers. The old batch → order
// "New Transfer" form is retired (POST /api/finance/internal-transfers is 410
// Gone): it booked the export side in USD straight into the PKR ledger. New
// transfers are made per lot from Lot Detail → "Transfer to Export", which is
// lot-precise and still lands in this list.
export default function InternalTransfer() {
  const { user } = useAuth();
  const { data: transfers = [], isLoading: loading } = useInternalTransfers();
  const canLinkOrder = ORDER_LINK_ROLES.includes(user?.role);
  const [openId, setOpenId] = useState(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Transfer</h1>
          <p className="text-sm text-gray-500 mt-0.5">Mill-to-Export entity stock transfer history</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <ArrowRightLeft className="w-4 h-4" />
          Mill Finished Goods &rarr; Export Dispatch
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-medium">New transfers are made from the lot itself.</p>
          <p className="mt-0.5 text-blue-800">
            Open the finished-rice lot in <Link to="/lot-inventory" className="font-semibold underline">Lot Inventory</Link> and
            use <span className="font-semibold">Transfer to Export</span> on Lot Detail. It moves exactly that lot and shows up in this list.
          </p>
        </div>
      </div>


      {/* Recent Transfers Table */}
      <div className="table-container mobile-cards">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            Recent Transfers
            <span className="text-sm font-normal text-gray-400 ml-1">({transfers.length})</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Transfer ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Batch No</th>
                {canLinkOrder && <th className="text-left px-4 py-3 font-semibold text-gray-600">Export Order</th>}
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty kg</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Price/kg</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Amount</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Dispatch Date</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : transfers.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No transfers yet</td></tr>
              ) : (
                transfers.map(t => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className="hover:bg-blue-50/50 transition-colors cursor-pointer">
                    <td data-label="Transfer ID" className="px-4 py-3 font-medium text-blue-600 hover:underline">{t.transferNo}</td>
                    <td data-label="Batch No" className="px-4 py-3 text-gray-900">{t.batchNo || `B-${t.batchId}`}</td>
                    {canLinkOrder && <td data-label="Export Order" className="mob-hide px-4 py-3 text-gray-900">{t.exportOrderNo || `#${t.exportOrderId}`}</td>}
                    <td data-label="Product" className="px-4 py-3 text-gray-600 max-w-[14rem] truncate" title={t.productName || undefined}>{t.productName}</td>
                    <td data-label="Qty kg" className="px-4 py-3 text-right text-gray-900 font-medium">{fmtNum(Math.round(transferKg(t)))}</td>
                    <td data-label="Price/kg" className="mob-hide px-4 py-3 text-right text-gray-900">{formatPKR(perMtToPerKg(t.transferPricePkr))}</td>
                    <td data-label="Total" className="px-4 py-3 text-right text-gray-900 font-medium">{formatPKR(t.totalValuePkr)}</td>
                    <td data-label="Dispatch" className="mob-hide px-4 py-3 text-gray-600">{fmtDate(t.dispatchDate)}</td>
                    <td data-label="Status" className="px-4 py-3 text-center">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TransferDetailDrawer transferId={openId} onClose={() => setOpenId(null)} canLinkOrder={canLinkOrder} />
    </div>
  );
}

function TransferDetailDrawer({ transferId, onClose, canLinkOrder = true }) {
  const { addToast } = useApp();
  const { data, isLoading } = useInternalTransfer(transferId);
  const confirmMut = useConfirmTransferExport();

  const t = data?.transfer || null;
  const movements = data?.movements || [];
  const timeline = data?.timeline || [];
  const isExported = t && (t.status === 'Received' || !!t.confirmedAt);

  const handleConfirm = async () => {
    try {
      await confirmMut.mutateAsync(transferId);
      addToast('Transfer confirmed exported.', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to confirm transfer.', 'error');
    }
  };

  const footer = t && !isExported && t.status !== 'Cancelled' ? (
    <button onClick={handleConfirm} disabled={confirmMut.isPending}
      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg inline-flex items-center justify-center gap-2">
      {confirmMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={16} />}
      Confirm export
    </button>
  ) : null;

  return (
    <SlideDrawer open={!!transferId} onClose={onClose} title={t?.transferNo || 'Transfer'}
      subtitle={t ? `Mill Finished Goods → Export Dispatch` : ''} icon={ArrowRightLeft} size="lg" footer={footer}>
      {isLoading || !t ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="text-xs text-gray-500">{fmtNum(Math.round(transferKg(t)))} kg · {t.productName || 'Finished Rice'}</span>
          </div>

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Batch" value={t.batchNo || (t.batchId ? `B-${t.batchId}` : '—')} />
            {canLinkOrder && <Fact label="Export order" value={t.exportOrderNo || (t.exportOrderId ? `#${t.exportOrderId}` : '—')} />}
            <Fact label="Customer" value={t.exportCustomerName || '—'} />
            <Fact label="Dispatch date" value={fmtDate(t.dispatchDate)} />
            <Fact label="Qty" value={`${fmtNum(Math.round(transferKg(t)))} kg`} />
            <Fact label="Price / kg" value={formatPKR(perMtToPerKg(t.transferPricePkr))} />
            <Fact label="Total (PKR)" value={formatPKR(t.totalValuePkr)} />
            <Fact label="Total (USD)" value={formatUSD(t.usdEquivalent)} />
            <Fact label="Created by" value={t.createdByName || '—'} />
            <Fact label="FX rate" value={parseFloat(t.pkrRate) > 0 ? `1 USD = ${parseFloat(t.pkrRate)} PKR` : '—'} />
          </div>

          {/* Timeline */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Timeline</h3>
            <ol className="space-y-3">
              {timeline.map((step) => (
                <li key={step.key} className="flex items-start gap-3">
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${step.done ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-300'}`}>
                    {step.done ? <CheckCircle size={13} /> : <Clock size={13} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${step.done ? 'text-gray-800' : 'text-gray-400'}`}>{step.label}</p>
                    <p className="text-[11px] text-gray-400">
                      {step.at ? fmtDateTime(step.at) : 'Pending'}{step.by ? ` · ${step.by}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Stock movements */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Stock movement</h3>
            {movements.length === 0 ? (
              <p className="text-xs text-gray-400">No linked stock movements recorded.</p>
            ) : (
              <div className="space-y-2">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                    {String(m.movementType).includes('out') ? <Truck size={14} className="text-red-500" /> : <ArrowDown size={14} className="text-emerald-600" />}
                    <span className="font-medium text-gray-700">{m.lotNo || `Lot ${m.lotId}`}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600 capitalize">{String(m.movementType).replace(/_/g, ' ')}</span>
                    <span className="ml-auto tabular-nums font-medium text-gray-800">{fmtNum(Math.round(parseFloat(m.qty) || 0))} kg</span>
                    <span className="text-[10px] text-gray-400 uppercase">{m.lotEntity}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">Stock was deducted from the mill and received into export when the transfer was created. Confirming export only marks the dispatch complete — it does not move stock again.</p>
          </div>
        </div>
      )}
    </SlideDrawer>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 truncate" title={String(value)}>{value}</p>
    </div>
  );
}
