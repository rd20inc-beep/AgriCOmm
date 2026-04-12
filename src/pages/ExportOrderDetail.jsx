import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../api/client';
import api from '../api/client';
import { queryKeys } from '../api/queryClient';
import {
  useExportOrder, useConfirmAdvance, useConfirmBalance,
  useUpdateOrderStatus, useAddOrderCost, useUpdateShipment,
  useStartDocs, useUploadDocument, useApproveDocument,
} from '../api/queries';
import { useCreateMillingBatch } from '../api/queries';
import {
  OrderHeader,
  WorkflowTimeline,
  OverviewTab,
  FinancialsTab,
  ProcurementTab,
  DocumentsTab,
  DocumentCenter,
  ShipmentTab,
  PackingTab,
  TimelineTab,
  AdvancePaymentModal,
  BalancePaymentModal,
  MillingDemandModal,
  ShipmentModal,
  HoldModal,
  ExpenseModal,
  InvoicePreviewModal,
  OrderEmailComposer,
  getVisibleTabs,
  today,
  documentLabels,
} from '../modules/exportOrders/components';

export default function ExportOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { token } = useAuth();
  const { millingBatches, addToast, exportCostCategories, companyProfileData, bankAccountsList, customersList, suppliersList } = useApp();

  // Fetch order detail via TanStack Query
  const { data: order, isLoading: orderLoading } = useExportOrder(id);

  // Mutations
  const confirmAdvanceMut = useConfirmAdvance();
  const confirmBalanceMut = useConfirmBalance();
  const updateStatusMut = useUpdateOrderStatus();
  const addCostMut = useAddOrderCost();
  const updateShipmentMut = useUpdateShipment();
  const startDocsMut = useStartDocs();
  const uploadDocMut = useUploadDocument();
  const approveDocMut = useApproveDocument();
  const createMillingMut = useCreateMillingBatch();

  const [activeTab, setActiveTab] = useState('overview');
  const [showActions, setShowActions] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);

  // Modal visibility states
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showMillingModal, setShowMillingModal] = useState(false);
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showEmailComposer, setShowEmailComposer] = useState(false);

  // Advance Payment form state
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState('');
  const [advanceMethod, setAdvanceMethod] = useState('Bank Transfer');
  const [advanceBankAccountId, setAdvanceBankAccountId] = useState('');
  const [advanceBankRef, setAdvanceBankRef] = useState('');
  const [advanceNotes, setAdvanceNotes] = useState('');

  // Balance Payment form state
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceDate, setBalanceDate] = useState('');
  const [balanceMethod, setBalanceMethod] = useState('Bank Transfer');
  const [balanceBankAccountId, setBalanceBankAccountId] = useState('');
  const [balanceBankRef, setBalanceBankRef] = useState('');
  const [balanceNotes, setBalanceNotes] = useState('');

  // Milling Demand form state
  const [millingRawQty, setMillingRawQty] = useState('');
  const [millingSupplier, setMillingSupplier] = useState('');

  // Shipment form state
  const [shipVessel, setShipVessel] = useState('');
  const [shipBooking, setShipBooking] = useState('');
  const [shipContainers, setShipContainers] = useState([]);
  const [shipBL, setShipBL] = useState('');
  const [shipLine, setShipLine] = useState('');
  const [shipETD, setShipETD] = useState('');
  const [shipATD, setShipATD] = useState('');
  const [shipETA, setShipETA] = useState('');
  const [shipATA, setShipATA] = useState('');
  const [shipDestPort, setShipDestPort] = useState('');
  const [shipVoyage, setShipVoyage] = useState('');
  const [shipGD, setShipGD] = useState('');
  const [shipGDDate, setShipGDDate] = useState('');
  const [shipFI, setShipFI] = useState('');
  const [shipFI2, setShipFI2] = useState('');
  const [shipFI3, setShipFI3] = useState('');
  const [shipFIDate, setShipFIDate] = useState('');
  const [shipNotifyName, setShipNotifyName] = useState('');
  const [shipNotifyAddress, setShipNotifyAddress] = useState('');
  const [shipNotifyPhone, setShipNotifyPhone] = useState('');
  const [shipNotifyEmail, setShipNotifyEmail] = useState('');
  const [shipRemarks, setShipRemarks] = useState('');

  // Expense form state
  const [expenseCategory, setExpenseCategory] = useState('rice');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Helper to invalidate order + related caches after mutations
  const invalidateOrder = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.orders.all });
  }, [qc, id]);
  const invalidateFinance = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
    qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
  }, [qc]);

  // SSE real-time updates — debounced to prevent re-render loops
  const sseTimer = useRef(null);
  useEffect(() => {
    if (!id || !token || token === 'mock-prototype-token') return undefined;

    const source = new EventSource(`${API_BASE}/api/streams/export-orders/${id}?token=${encodeURIComponent(token)}`);
    source.onmessage = () => {
      if (sseTimer.current) clearTimeout(sseTimer.current);
      sseTimer.current = setTimeout(() => invalidateOrder(), 500);
    };
    source.onerror = () => {};
    return () => {
      source.close();
      if (sseTimer.current) clearTimeout(sseTimer.current);
    };
  }, [id, token, invalidateOrder]);

  // Hooks must be called before any early returns (React Rules of Hooks)
  const orderStatus = order?.status;
  const visibleTabs = React.useMemo(() => getVisibleTabs(orderStatus), [orderStatus]);

  React.useEffect(() => {
    if (!orderStatus) return;
    const tabKeys = visibleTabs.map(t => t.key);
    if (!tabKeys.includes(activeTab)) {
      setActiveTab(tabKeys[0] || 'overview');
    }
  }, [orderStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Early returns AFTER all hooks
  if (orderLoading && !order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading order...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500 text-lg">Order not found.</p>
        <button onClick={() => navigate('/export')} className="mt-4 text-blue-600 hover:underline text-sm">
          Back to Export Orders
        </button>
      </div>
    );
  }

  const totalCosts = Object.values(order.costs || {}).reduce((sum, c) => sum + (parseFloat(c) || 0), 0);
  const grossProfit = (parseFloat(order.contractValue) || 0) - totalCosts;
  const marginPct = order.contractValue > 0 ? ((grossProfit / (parseFloat(order.contractValue) || 1)) * 100).toFixed(1) : '0.0';
  const formatCurrency = (value) => '$' + (parseFloat(value) || 0).toLocaleString();
  const backendActions = order.allowedActions || {};

  // --- Modal openers (reset form state then show) ---
  const buildShipmentContainerRow = (container = {}, sequenceNo = 1) => ({
    sequenceNo,
    containerNo: container.containerNo || '',
    sealNo: container.sealNo || '',
    grossWeightKg: container.grossWeightKg ?? '',
    netWeightKg: container.netWeightKg ?? '',
    notes: container.notes || '',
  });

  const openAdvanceModal = () => {
    setAdvanceAmount(Math.max(0, (order.advanceExpected || 0) - (order.advanceReceived || 0)));
    setAdvanceDate(today());
    setAdvanceMethod('Bank Transfer');
    setAdvanceBankAccountId('');
    setAdvanceBankRef('');
    setAdvanceNotes('');
    setShowAdvanceModal(true);
  };

  const openBalanceModal = () => {
    setBalanceAmount(Math.max(0, (order.balanceExpected || 0) - (order.balanceReceived || 0)));
    setBalanceDate(today());
    setBalanceMethod('Bank Transfer');
    setBalanceBankAccountId('');
    setBalanceBankRef('');
    setBalanceNotes('');
    setShowBalanceModal(true);
  };

  const openMillingModal = () => {
    setMillingRawQty(Math.ceil(order.qtyMT / 0.75));
    setMillingSupplier('');
    setShowMillingModal(true);
  };

  const openShipmentModal = () => {
    setShipVessel(order.vesselName || '');
    setShipBooking(order.bookingNo || '');
    const containers = Array.isArray(order.shipmentContainers) && order.shipmentContainers.length > 0
      ? order.shipmentContainers
      : (order.containerNo ? [{ containerNo: order.containerNo }] : []);
    setShipContainers(
      containers.length > 0
        ? containers.map((container, index) => buildShipmentContainerRow(container, index + 1))
        : [buildShipmentContainerRow({}, 1)]
    );
    setShipBL(order.blNumber || '');
    setShipLine(order.shippingLine || '');
    setShipETD(order.etd || '');
    setShipATD(order.atd || '');
    setShipETA(order.eta || '');
    setShipATA(order.ata || '');
    setShipDestPort(order.destinationPort || '');
    setShipVoyage(order.voyageNumber || '');
    setShipGD(order.gdNumber || '');
    setShipGDDate(order.gdDate || '');
    setShipFI(order.fiNumber || '');
    setShipFI2(order.fiNumber2 || '');
    setShipFI3(order.fiNumber3 || '');
    setShipFIDate(order.fiDate || '');
    setShipNotifyName(order.notifyPartyName || '');
    setShipNotifyAddress(order.notifyPartyAddress || '');
    setShipNotifyPhone(order.notifyPartyPhone || '');
    setShipNotifyEmail(order.notifyPartyEmail || '');
    setShipRemarks(order.shipmentRemarks || '');
    setShowShipmentModal(true);
  };

  const openHoldModal = () => {
    setShowHoldModal(true);
  };

  const openExpenseModal = () => {
    setExpenseCategory('rice');
    setExpenseAmount('');
    setExpenseNotes('');
    setShowExpenseModal(true);
  };

  // --- Handlers ---

  const orderId = order?.dbId || order?.id;

  const handleConfirmAdvance = async () => {
    const amount = parseFloat(advanceAmount) || 0;
    if (!amount || amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    setShowAdvanceModal(false);
    try {
      const res = await confirmAdvanceMut.mutateAsync({
        id: orderId,
        data: {
          amount,
          payment_date: advanceDate,
          payment_method: advanceMethod,
          bank_account_id: advanceBankAccountId || null,
          bank_reference: advanceBankRef,
          notes: advanceNotes,
        },
      });
      const updated = res?.data?.order;
      addToast(updated
        ? `Advance of $${amount.toLocaleString()} confirmed — status: ${updated.status}`
        : 'Advance payment confirmed successfully');
      invalidateFinance();
    } catch (err) {
      addToast(err?.message || 'Failed to confirm advance payment', 'error');
    }
  };

  const handleConfirmBalance = async () => {
    const amount = parseFloat(balanceAmount) || 0;
    if (!amount || amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    setShowBalanceModal(false);
    try {
      const res = await confirmBalanceMut.mutateAsync({
        id: orderId,
        data: {
          amount,
          payment_date: balanceDate,
          payment_method: balanceMethod,
          bank_account_id: balanceBankAccountId || null,
          bank_reference: balanceBankRef,
          notes: balanceNotes,
        },
      });
      const updated = res?.data?.order;
      addToast(updated
        ? `Balance of $${amount.toLocaleString()} confirmed — status: ${updated.status}`
        : 'Balance payment confirmed');
      invalidateFinance();
    } catch (err) {
      addToast(err.message || 'Failed to confirm balance', 'error');
    }
  };

  const handleStartDocsPreparation = async () => {
    try {
      await startDocsMut.mutateAsync({
        id: orderId,
        data: { notes: 'Document preparation started from order detail' },
      });
      addToast('Document preparation started');
    } catch (err) {
      addToast(`Failed to start document preparation: ${err.message || 'Server error'}`, 'error');
    }
  };

  const handleCreateMilling = async () => {
    if (order.millingOrderId) {
      addToast('A milling order already exists for this export order', 'error');
      return;
    }
    const rawQty = parseFloat(millingRawQty) || Math.ceil(order.qtyMT / 0.75);
    const supplierId = parseInt(millingSupplier) || null;

    try {
      const res = await createMillingMut.mutateAsync({
        supplier_id: supplierId,
        linked_export_order_id: orderId || null,
        raw_qty_mt: rawQty,
        planned_finished_mt: order.qtyMT,
      });
      const batchNo = res?.data?.batch?.batch_no || res?.data?.batch?.id || 'New';
      addToast(`Milling batch ${batchNo} created successfully`);
      invalidateOrder();
      setShowMillingModal(false);
      setMillingRawQty('');
      setMillingSupplier('');
    } catch (err) {
      addToast(err.message || 'Failed to create milling batch', 'error');
    }
  };

  const handleUpdateShipment = async () => {
    try {
      const containers = shipContainers
        .map((container, index) => ({
          sequence_no: index + 1,
          container_no: String(container.containerNo || '').trim(),
          seal_no: container.sealNo || null,
          gross_weight_kg: container.grossWeightKg === '' || container.grossWeightKg == null
            ? null
            : parseFloat(container.grossWeightKg),
          net_weight_kg: container.netWeightKg === '' || container.netWeightKg == null
            ? null
            : parseFloat(container.netWeightKg),
          notes: container.notes || null,
        }))
        .filter((container) => container.container_no);

      const res = await updateShipmentMut.mutateAsync({
        id: orderId,
        data: {
          vessel_name: shipVessel || null,
          booking_no: shipBooking || null,
          container_no: containers[0]?.container_no || null,
          containers,
          bl_number: shipBL || null,
          shipping_line: shipLine || null,
          etd: shipETD || null,
          atd: shipATD || null,
          eta: shipETA || null,
          ata: shipATA || null,
          destination_port: shipDestPort || null,
          voyage_number: shipVoyage || null,
          gd_number: shipGD || null,
          gd_date: shipGDDate || null,
          fi_number: shipFI || null,
          fi_number_2: shipFI2 || null,
          fi_number_3: shipFI3 || null,
          fi_date: shipFIDate || null,
          notify_party_name: shipNotifyName || null,
          notify_party_address: shipNotifyAddress || null,
          notify_party_phone: shipNotifyPhone || null,
          notify_party_email: shipNotifyEmail || null,
          shipment_remarks: shipRemarks || null,
          notes: shipATA
            ? `Shipment arrived on ${shipATA}`
            : shipATD
            ? `Shipment departed on ${shipATD}`
            : null,
        },
      });
      addToast(res?.data?.transitioned_to ? `Shipment updated: ${res.data.transitioned_to}` : 'Shipment details updated');
      setActiveTab('shipment');
    } catch (err) {
      addToast(`Failed to update shipment: ${err.message || 'Server error'}`, 'error');
    }
    setShowShipmentModal(false);
  };

  const handlePutOnHold = async () => {
    try {
      await updateStatusMut.mutateAsync({
        id: orderId,
        data: { status: 'Cancelled', notes: 'Order cancelled / put on hold' },
      });
      addToast('Order has been cancelled');
    } catch (err) {
      addToast(`Failed to cancel order: ${err.message || 'Server error'}`, 'error');
    }
    setShowHoldModal(false);
  };

  const handleAddExpense = async () => {
    const amount = parseFloat(expenseAmount) || 0;
    if (amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    try {
      await addCostMut.mutateAsync({
        id: orderId,
        data: { category: expenseCategory, amount, notes: expenseNotes },
      });
      addToast(`$${amount.toLocaleString()} added to ${expenseCategory}`);
    } catch (err) {
      addToast(err.message || 'Failed to add expense', 'error');
    }
    setShowExpenseModal(false);
  };

  const handleDocumentUpload = async (docKey, file) => {
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('doc_type', docKey);
      formData.append('linked_type', 'export_order');
      formData.append('linked_id', orderId);
      formData.append('title', `${documentLabels[docKey] || docKey} - ${order.id}`);
      try {
        await api.upload('/api/documents/upload', formData);
      } catch (uploadErr) {
        addToast(`File upload failed: ${uploadErr.message}. Marking document status anyway.`, 'warning');
      }
    }
    try {
      await uploadDocMut.mutateAsync({
        id: orderId,
        data: { doc_type: docKey, file_path: file ? file.name : null },
      });
      addToast(`${documentLabels[docKey] || docKey} uploaded${file ? ` (${file.name})` : ''}`);
    } catch (err) {
      addToast(`Failed to upload ${documentLabels[docKey] || docKey}: ${err.message}`, 'error');
    }
  };

  const handleDocumentApprove = async (docKey) => {
    try {
      await approveDocMut.mutateAsync({
        id: orderId,
        data: { doc_type: docKey, uploaded_by: 'Export Manager' },
      });
      addToast(`${documentLabels[docKey]} approved`);
    } catch (err) {
      addToast(`Failed to approve ${documentLabels[docKey]}: ${err.message}`, 'error');
      return;
    }
    if (docKey === 'blDraft' && order.balanceReceived < order.balanceExpected) {
      addToast('Balance collection reminder sent to customer', 'info');
    }
  };

  // Find linked milling batch for procurement tab
  const linkedBatch = order.millingOrderId
    ? millingBatches.find(b => b.id === order.millingOrderId)
    : null;

  // Workflow gating - determine which actions are allowed
  const canConfirmAdvance = backendActions.canConfirmAdvance ?? (order.advanceReceived < order.advanceExpected && ['Awaiting Advance', 'Draft'].includes(order.status));
  const canStartDocs = backendActions.canStartDocs ?? (order.status === 'In Milling');
  const canRequestBalance = backendActions.canRequestBalance ?? (order.status === 'Awaiting Balance' && order.balanceReceived < order.balanceExpected);
  const canCreateMilling = backendActions.canCreateMilling ?? (order.advanceReceived >= order.advanceExpected && !order.millingOrderId && !['Draft', 'Closed', 'Cancelled'].includes(order.status));
  const canUpdateShipment = backendActions.canUpdateShipment ?? ['Ready to Ship', 'Shipped'].includes(order.status);
  const canPutOnHold = backendActions.canPutOnHold ?? !['Closed', 'Cancelled'].includes(order.status);
  const canCloseOrder = backendActions.canCloseOrder ?? (order.status === 'Arrived' || (order.balanceReceived >= order.balanceExpected && order.status === 'Shipped'));

  const handleCloseOrder = async () => {
    try {
      await updateStatusMut.mutateAsync({
        id: orderId,
        data: { status: 'Closed', notes: 'Order closed with full settlement' },
      });
      addToast(`Order ${order.id} has been closed`);
    } catch (err) {
      addToast(`Failed to close order: ${err.message || 'Server error'}`, 'error');
    }
    setShowActions(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <OrderHeader
        order={order}
        formatCurrency={formatCurrency}
        showActions={showActions}
        setShowActions={setShowActions}
        onNavigateBack={() => navigate('/export')}
        onShowInvoicePreview={() => setShowInvoicePreview(true)}
        onShowEmailComposer={() => setShowEmailComposer(true)}
        canConfirmAdvance={canConfirmAdvance}
        canStartDocs={canStartDocs}
        canRequestBalance={canRequestBalance}
        canCreateMilling={canCreateMilling}
        canUpdateShipment={canUpdateShipment}
        canPutOnHold={canPutOnHold}
        canCloseOrder={canCloseOrder}
        onOpenAdvanceModal={openAdvanceModal}
        onStartDocsPreparation={handleStartDocsPreparation}
        onOpenBalanceModal={openBalanceModal}
        onOpenMillingModal={openMillingModal}
        onOpenShipmentModal={openShipmentModal}
        onOpenHoldModal={openHoldModal}
        onCloseOrder={handleCloseOrder}
      />

      {/* Workflow Timeline */}
      <WorkflowTimeline order={order} />

      {/* Action Banner — prominent CTA for current workflow step */}
      {canConfirmAdvance && order.status === 'Awaiting Advance' && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800">Advance Payment Required</p>
            <p className="text-xs text-amber-600">Expected: {formatCurrency(order.advanceExpected)} | Received: {formatCurrency(order.advanceReceived)}</p>
          </div>
          <button onClick={openAdvanceModal} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700">Confirm Advance Received</button>
        </div>
      )}
      {order.status === 'Docs In Preparation' && (() => {
        const docs = order.documents || {};
        const approvedCount = Object.values(docs).filter(d => d && ['Approved', 'Final', 'Draft Uploaded'].includes(typeof d === 'string' ? d : d.status || d)).length;
        if (approvedCount < 7) return null;
        return (
          <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-800">All Documents Approved</p>
              <p className="text-xs text-emerald-600">All 7 required export documents are approved. Click to advance to balance payment stage.</p>
            </div>
            <button
              onClick={async () => {
                try {
                  await updateStatusMut.mutateAsync({ id: orderId, data: { status: 'Awaiting Balance', reason: 'All documents complete — manual promotion' } });
                  addToast('Order moved to Awaiting Balance');
                  invalidateOrder();
                } catch (err) {
                  addToast(err?.message || 'Failed to promote', 'error');
                }
              }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
            >
              Complete Documents
            </button>
          </div>
        );
      })()}
      {canRequestBalance && order.status === 'Awaiting Balance' && (
        <div className="bg-blue-50 border border-blue-300 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">Balance Payment Required</p>
            <p className="text-xs text-blue-600">Expected: {formatCurrency(order.balanceExpected)} | Received: {formatCurrency(order.balanceReceived)} | Outstanding: {formatCurrency(order.balanceExpected - order.balanceReceived)}</p>
          </div>
          <button onClick={openBalanceModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Confirm Balance Received</button>
        </div>
      )}

      {/* Tabs — only show tabs relevant to the current workflow stage */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && <OverviewTab order={order} formatCurrency={formatCurrency} totalCosts={totalCosts} grossProfit={grossProfit} marginPct={marginPct} exportCostCategories={exportCostCategories} />}
        {activeTab === 'financials' && (
          <FinancialsTab
            order={order}
            formatCurrency={formatCurrency}
            totalCosts={totalCosts}
            grossProfit={grossProfit}
            marginPct={marginPct}
            onConfirmAdvance={openAdvanceModal}
            onRequestBalance={openBalanceModal}
            onAddExpense={openExpenseModal}
            onAddReceivable={() => addToast('Receivable recorded')}
            canConfirmAdvance={canConfirmAdvance}
            canRequestBalance={canRequestBalance}
            exportCostCategories={exportCostCategories}
          />
        )}
        {activeTab === 'procurement' && (
          <ProcurementTab
            order={order}
            linkedBatch={linkedBatch}
            purchaseLots={order.purchaseLots || []}
            onCreateMilling={openMillingModal}
            onStartDocsPreparation={handleStartDocsPreparation}
            onLinkExternalPurchase={() => addToast('External purchase linked')}
            canCreateMilling={canCreateMilling}
            canStartDocs={canStartDocs}
            onStockAllocated={() => { invalidateOrder(); addToast('Stock allocated successfully'); }}
          />
        )}
        {activeTab === 'packing' && <PackingTab order={order} onUpdated={invalidateOrder} />}
        {activeTab === 'documents' && (
          <>
            <DocumentsTab order={order} onUpload={handleDocumentUpload} onApprove={handleDocumentApprove} onPreviewInvoice={() => setShowInvoicePreview(true)} />
            <DocumentCenter order={order} />
          </>
        )}
        {activeTab === 'shipment' && <ShipmentTab order={order} onUpdateShipment={openShipmentModal} canUpdateShipment={canUpdateShipment} />}
        {activeTab === 'timeline' && <TimelineTab order={order} />}
      </div>

      {/* ====== MODALS ====== */}

      <AdvancePaymentModal
        isOpen={showAdvanceModal}
        onClose={() => setShowAdvanceModal(false)}
        order={order}
        formatCurrency={formatCurrency}
        advanceAmount={advanceAmount}
        setAdvanceAmount={setAdvanceAmount}
        advanceDate={advanceDate}
        setAdvanceDate={setAdvanceDate}
        advanceMethod={advanceMethod}
        setAdvanceMethod={setAdvanceMethod}
        advanceBankAccountId={advanceBankAccountId}
        setAdvanceBankAccountId={setAdvanceBankAccountId}
        advanceBankRef={advanceBankRef}
        setAdvanceBankRef={setAdvanceBankRef}
        advanceNotes={advanceNotes}
        setAdvanceNotes={setAdvanceNotes}
        bankAccountsList={bankAccountsList}
        onConfirm={handleConfirmAdvance}
      />

      <BalancePaymentModal
        isOpen={showBalanceModal}
        onClose={() => setShowBalanceModal(false)}
        order={order}
        formatCurrency={formatCurrency}
        balanceAmount={balanceAmount}
        setBalanceAmount={setBalanceAmount}
        balanceDate={balanceDate}
        setBalanceDate={setBalanceDate}
        balanceMethod={balanceMethod}
        setBalanceMethod={setBalanceMethod}
        balanceBankAccountId={balanceBankAccountId}
        setBalanceBankAccountId={setBalanceBankAccountId}
        balanceBankRef={balanceBankRef}
        setBalanceBankRef={setBalanceBankRef}
        balanceNotes={balanceNotes}
        setBalanceNotes={setBalanceNotes}
        bankAccountsList={bankAccountsList}
        onConfirm={handleConfirmBalance}
      />

      <MillingDemandModal
        isOpen={showMillingModal}
        onClose={() => setShowMillingModal(false)}
        order={order}
        millingRawQty={millingRawQty}
        setMillingRawQty={setMillingRawQty}
        millingSupplier={millingSupplier}
        setMillingSupplier={setMillingSupplier}
        suppliersList={suppliersList || []}
        onConfirm={handleCreateMilling}
      />

      <ShipmentModal
        isOpen={showShipmentModal}
        onClose={() => setShowShipmentModal(false)}
        shipVessel={shipVessel}
        setShipVessel={setShipVessel}
        shipBooking={shipBooking}
        setShipBooking={setShipBooking}
        shipBL={shipBL}
        setShipBL={setShipBL}
        shipLine={shipLine}
        setShipLine={setShipLine}
        shipETD={shipETD}
        setShipETD={setShipETD}
        shipATD={shipATD}
        setShipATD={setShipATD}
        shipETA={shipETA}
        setShipETA={setShipETA}
        shipATA={shipATA}
        setShipATA={setShipATA}
        shipDestPort={shipDestPort}
        setShipDestPort={setShipDestPort}
        shipVoyage={shipVoyage} setShipVoyage={setShipVoyage}
        shipGD={shipGD} setShipGD={setShipGD}
        shipGDDate={shipGDDate} setShipGDDate={setShipGDDate}
        shipFI={shipFI} setShipFI={setShipFI}
        shipFI2={shipFI2} setShipFI2={setShipFI2}
        shipFI3={shipFI3} setShipFI3={setShipFI3}
        shipFIDate={shipFIDate} setShipFIDate={setShipFIDate}
        shipNotifyName={shipNotifyName} setShipNotifyName={setShipNotifyName}
        shipNotifyAddress={shipNotifyAddress} setShipNotifyAddress={setShipNotifyAddress}
        shipNotifyPhone={shipNotifyPhone} setShipNotifyPhone={setShipNotifyPhone}
        shipNotifyEmail={shipNotifyEmail} setShipNotifyEmail={setShipNotifyEmail}
        shipRemarks={shipRemarks} setShipRemarks={setShipRemarks}
        shipmentContainers={shipContainers}
        setShipmentContainers={setShipContainers}
        onConfirm={handleUpdateShipment}
      />

      <HoldModal
        isOpen={showHoldModal}
        onClose={() => setShowHoldModal(false)}
        order={order}
        onConfirm={handlePutOnHold}
      />

      <ExpenseModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        expenseCategory={expenseCategory}
        setExpenseCategory={setExpenseCategory}
        expenseAmount={expenseAmount}
        setExpenseAmount={setExpenseAmount}
        expenseNotes={expenseNotes}
        setExpenseNotes={setExpenseNotes}
        exportCostCategories={exportCostCategories}
        onConfirm={handleAddExpense}
      />

      <InvoicePreviewModal
        isOpen={showInvoicePreview}
        onClose={() => setShowInvoicePreview(false)}
        order={order}
        companyProfile={companyProfileData}
      />

      <OrderEmailComposer
        isOpen={showEmailComposer}
        onClose={() => setShowEmailComposer(false)}
        defaultTo={(customersList.find(c => c.id === order.customerId) || {}).email || ''}
        defaultSubject={`Proforma Invoice - PI-${order.id.replace('EX-','')}`}
        defaultBody={`Dear Customer,\n\nPlease find attached the Proforma Invoice for Order ${order.id}.\n\nProduct: ${order.productName}\nQuantity: ${order.qtyMT} MT\nContract Value: $${order.contractValue.toLocaleString()}\n\nBest regards,\nAGRI COMMODITIES`}
        attachmentLabel={`PI-${order.id.replace('EX-','')}.pdf`}
      />
    </div>
  );
}
