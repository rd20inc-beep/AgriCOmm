import React from 'react';
import StatusBadge from '../../../components/StatusBadge';
import PartyLink from '../../../shared/components/PartyLink';
import { useAuth } from '../../../context/AuthContext';
import { financialStatusMeta } from './constants';
import { orderOutstanding } from '../utils/orderOutstanding';
import {
  ArrowLeft, ChevronDown, FileText, DollarSign,
  Package, User, Globe, Mail, Copy,
} from 'lucide-react';

export default function OrderHeader({
  order,
  formatCurrency,
  showActions,
  setShowActions,
  onNavigateBack,
  onShowInvoicePreview,
  onShowEmailComposer,
  onDuplicate,
  canConfirmAdvance,
  canStartDocs,
  canRequestBalance,
  canCreateMilling,
  canUpdateShipment,
  canCloseOrder,
  canCancel,
  onCancelOrder,
  onOpenAdvanceModal,
  onOpenBalanceModal,
  onOpenMillingModal,
  onOpenShipmentModal,
  onCloseOrder,
  onStartDocsPreparation,
}) {
  // W07: what the buyer still owes on this order, on the header itself.
  const outstanding = orderOutstanding(order);
  // P5-05: each action shows only for those the backend lets run it
  // (exportOrders.routes); the state flags above still decide when.
  const { hasPermission } = useAuth();
  const can = (...perms) => perms.some(([m, a]) => hasPermission(m, a));
  const allowed = {
    advance: can(['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']),
    startDocs: can(['export_orders', 'approve']),
    balance: can(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
    milling: can(['milling', 'create']),
    shipment: can(['export_orders', 'approve']),
    close: can(['export_orders', 'close']),
    cancel: can(['export_orders', 'approve']),
    duplicate: can(['export_orders', 'create']),
    email: can(['export_orders', 'send_email']),
  };
  const anyAction = Object.entries(allowed).some(([k, v]) => v && k !== 'email');
  return (
    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <button onClick={onNavigateBack} aria-label="Back to export orders" className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{order.id}</h1>
            <StatusBadge status={order.status} />
            {order.financialStatus && financialStatusMeta[order.financialStatus] && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${financialStatusMeta[order.financialStatus].cls}`}
                title="Advance / financial confirmation status — independent of the operational workflow."
              >
                {financialStatusMeta[order.financialStatus].label}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /><PartyLink type="customer" id={order.customerId} name={order.customerName} /></span>
            <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" />{order.qtyMT} MT</span>
            <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{order.country}</span>
            <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />{formatCurrency(order.contractValue)}</span>
            {outstanding != null && (
              <span data-testid="order-outstanding" title="Advance + balance still to be received (expected minus received)"
                className={`flex items-center gap-1 font-medium ${outstanding > 0.005 ? 'text-amber-700' : 'text-emerald-700'}`}>
                Outstanding: {formatCurrency(outstanding)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onShowInvoicePreview}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2d5a87] transition-colors"
        >
          <FileText className="w-4 h-4" />
          Proforma Invoice
        </button>
        {allowed.email && (
        <button
          onClick={onShowEmailComposer}
          title="Open the Proforma Invoice in the Document Center and email it as a PDF"
          data-action="send-email"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Mail className="w-4 h-4" />
          Send Email
        </button>
        )}
        {anyAction && (
        <div className="relative">
        <button
          onClick={() => setShowActions(!showActions)}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          Quick Actions
          <ChevronDown className="w-4 h-4" />
        </button>
        {showActions && (
          <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
            <div className="py-1">
              {allowed.advance && <button data-action="advance" disabled={!canConfirmAdvance} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canConfirmAdvance ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canConfirmAdvance) return; onOpenAdvanceModal(); setShowActions(false); }}>Record Advance Receipt</button>}
              {allowed.startDocs && <button data-action="start-docs" disabled={!canStartDocs} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canStartDocs ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canStartDocs) return; onStartDocsPreparation(); setShowActions(false); }}>Start Docs Preparation</button>}
              {allowed.balance && <button data-action="balance" disabled={!canRequestBalance} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canRequestBalance ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canRequestBalance) return; onOpenBalanceModal(); setShowActions(false); }}>Record Balance Receipt</button>}
              {allowed.milling && <button data-action="milling" disabled={!canCreateMilling} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canCreateMilling ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canCreateMilling) return; onOpenMillingModal(); setShowActions(false); }}>Create Milling Demand</button>}
              {allowed.shipment && <button data-action="shipment" disabled={!canUpdateShipment} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canUpdateShipment ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canUpdateShipment) return; onOpenShipmentModal(); setShowActions(false); }}>Update Shipment</button>}
              {allowed.close && <button data-action="close" disabled={!canCloseOrder} className={`w-full text-left px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-50 ${!canCloseOrder ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canCloseOrder) return; onCloseOrder(); }}>Close Order</button>}
              {allowed.cancel && <button data-action="cancel" disabled={!canCancel} className={`w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 ${!canCancel ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canCancel) return; onCancelOrder(); }}>Cancel Order</button>}
              {allowed.duplicate && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <button data-action="duplicate" className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2" onClick={() => { if (onDuplicate) onDuplicate(); setShowActions(false); }}>
                    <Copy className="w-3.5 h-3.5" /> Duplicate Order
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
        )}
      </div>
    </div>
  );
}
