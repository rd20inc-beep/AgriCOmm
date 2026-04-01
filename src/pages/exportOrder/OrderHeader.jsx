import React from 'react';
import StatusBadge from '../../components/StatusBadge';
import {
  ArrowLeft, ChevronDown, FileText, DollarSign,
  Package, User, Globe, Mail
} from 'lucide-react';

export default function OrderHeader({
  order,
  formatCurrency,
  showActions,
  setShowActions,
  onNavigateBack,
  onShowInvoicePreview,
  onShowEmailComposer,
  canConfirmAdvance,
  canStartDocs,
  canRequestBalance,
  canCreateMilling,
  canUpdateShipment,
  canPutOnHold,
  canCloseOrder,
  onOpenAdvanceModal,
  onOpenBalanceModal,
  onOpenMillingModal,
  onOpenShipmentModal,
  onOpenHoldModal,
  onCloseOrder,
  onStartDocsPreparation,
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <button onClick={onNavigateBack} className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{order.id}</h1>
            <StatusBadge status={order.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{order.customerName}</span>
            <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" />{order.qtyMT} MT</span>
            <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{order.country}</span>
            <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />{formatCurrency(order.contractValue)}</span>
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
        <button
          onClick={onShowEmailComposer}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Mail className="w-4 h-4" />
          Send Email
        </button>
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
              <button disabled={!canConfirmAdvance} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canConfirmAdvance ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canConfirmAdvance) return; onOpenAdvanceModal(); setShowActions(false); }}>Confirm Advance Payment</button>
              <button disabled={!canStartDocs} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canStartDocs ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canStartDocs) return; onStartDocsPreparation(); setShowActions(false); }}>Start Docs Preparation</button>
              <button disabled={!canRequestBalance} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canRequestBalance ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canRequestBalance) return; onOpenBalanceModal(); setShowActions(false); }}>Request Balance Payment</button>
              <button disabled={!canCreateMilling} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canCreateMilling ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canCreateMilling) return; onOpenMillingModal(); setShowActions(false); }}>Create Milling Demand</button>
              <button disabled={!canUpdateShipment} className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${!canUpdateShipment ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canUpdateShipment) return; onOpenShipmentModal(); setShowActions(false); }}>Update Shipment</button>
              <button disabled={!canPutOnHold} className={`w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 ${!canPutOnHold ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canPutOnHold) return; onOpenHoldModal(); setShowActions(false); }}>Put On Hold</button>
              <button disabled={!canCloseOrder} className={`w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50 ${!canCloseOrder ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={() => { if (!canCloseOrder) return; onCloseOrder(); }}>Close Order</button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
