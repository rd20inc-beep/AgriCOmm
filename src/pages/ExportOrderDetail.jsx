import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { API_BASE } from '../api/client';
import { transformOrder, transformBankAccount } from '../api/transforms';
import {
  OrderHeader,
  WorkflowTimeline,
  OverviewTab,
  FinancialsTab,
  ProcurementTab,
  DocumentsTab,
  DocumentCenter,
  ShipmentTab,
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
} from './exportOrder';

export default function ExportOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { exportOrders, millingBatches, updateExportOrder, addActivityToOrder, addToast, addMillingBatch, exportCostCategories, companyProfileData, bankAccountsList: contextBankAccounts, customersList, suppliersList, refreshFromApi } = useApp();

  // Fetch bank accounts and suppliers directly via API — bypasses TanStack Query caching issues
  const [bankAccountsList, setBankAccountsList] = useState([]);
  const [localSuppliers, setLocalSuppliers] = useState([]);
  useEffect(() => {
    api.get('/api/finance/bank-accounts')
      .then(res => {
        const raw = res?.data?.accounts || res?.data?.bank_accounts || [];
        setBankAccountsList(raw.map(transformBankAccount));
      })
      .catch(() => { if (contextBankAccounts?.length > 0) setBankAccountsList(contextBankAccounts); });
    api.get('/api/suppliers?limit=500')
      .then(res => {
        const raw = res?.data?.suppliers || [];
        setLocalSuppliers(raw.map(s => ({ id: s.id, name: s.name })));
      })
      .catch(() => { if (suppliersList?.length > 0) setLocalSuppliers(suppliersList); });
  }, []);
  const [activeTab, setActiveTab] = useState('overview');
  const [showActions, setShowActions] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [apiOrder, setApiOrder] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);

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

  // Expense form state
  const [expenseCategory, setExpenseCategory] = useState('rice');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Try to find in pre-loaded list first, fallback to API fetch
  const listOrder = exportOrders.find(o => o.id === id || String(o.dbId) === id);

  // Fetch full order detail from API (costs, documents, status history)
  async function fetchOrderDetail() {
    setApiLoading(true);
    try {
      const res = await api.get(`/api/export-orders/${id}`);
      const raw = res?.data?.order;
      if (raw) {
        raw.costs = res.data.costs || raw.costs;
        raw.documents = res.data.documents || raw.documents;
        raw.status_history = res.data.statusHistory || raw.status_history;
        raw.packingLines = res.data.packingLines || [];
        raw.purchaseLots = res.data.purchaseLots || [];
        setApiOrder(transformOrder(raw));
      }
    } catch (_) {
      // Leave the existing order visible if the refetch fails.
    } finally {
      setApiLoading(false);
    }
  }

  // Fetch on mount and when ID changes
  React.useEffect(() => {
    if (id) fetchOrderDetail();
  }, [id]);

  React.useEffect(() => {
    if (!id || !token || token === 'mock-prototype-token') {
      return undefined;
    }

    const source = new EventSource(`${API_BASE}/api/streams/export-orders/${id}?token=${encodeURIComponent(token)}`);
    source.onmessage = () => {
      fetchOrderDetail();
      refreshFromApi('orders');
    };
    source.onerror = () => {};

    return () => {
      source.close();
    };
  }, [id, token]);

  React.useEffect(() => {
    // no-op
  }, [id, listOrder, apiOrder, apiLoading]);

  // Prefer apiOrder (fresh from detail endpoint) over listOrder (from cached list)
  const order = apiOrder || listOrder;

  if (apiLoading && !order) {
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

  // Compute visible tabs based on workflow status
  const visibleTabs = getVisibleTabs(order.status);

  // Reset activeTab if it's no longer visible after a status change
  React.useEffect(() => {
    if (order && !visibleTabs.find(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'overview');
    }
  }, [order?.status]);

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

  const handleConfirmAdvance = async () => {
    const amount = parseFloat(advanceAmount) || 0;
    if (!amount || amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    setShowAdvanceModal(false);
    try {
      const res = await api.post(`/api/export-orders/${order.dbId || order.id}/confirm-advance`, {
        amount,
        payment_date: advanceDate,
        payment_method: advanceMethod,
        bank_account_id: advanceBankAccountId || null,
        bank_reference: advanceBankRef,
        notes: advanceNotes,
      });
      // Sync local state immediately from the API response
      const updated = res?.data?.order;
      if (updated) {
        setApiOrder(transformOrder(updated));
        addToast(`Advance of $${amount.toLocaleString()} confirmed — status: ${updated.status}`);
      } else {
        addToast('Advance payment confirmed successfully');
      }
      // Re-fetch full detail (costs, docs, history) to get the complete picture
      await fetchOrderDetail();
      refreshFromApi('orders');
      refreshFromApi('finance');
    } catch (err) {
      const msg = err?.message || err?.data?.message || 'Failed to confirm advance payment';
      console.error('Advance confirm failed:', msg);
      addToast(msg, 'error');
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
      const res = await api.post(`/api/export-orders/${order.dbId || order.id}/confirm-balance`, {
        amount,
        payment_date: balanceDate,
        payment_method: balanceMethod,
        bank_account_id: balanceBankAccountId || null,
        bank_reference: balanceBankRef,
        notes: balanceNotes,
      });
      const updated = res?.data?.order;
      if (updated) {
        setApiOrder(transformOrder(updated));
        addToast(`Balance of $${amount.toLocaleString()} confirmed — status: ${updated.status}`);
      } else {
        addToast('Balance payment confirmed');
      }
      await fetchOrderDetail();
      refreshFromApi('orders');
      refreshFromApi('finance');
    } catch (err) {
      addToast(err.message || 'Failed to confirm balance', 'error');
    }
  };

  const handleStartDocsPreparation = async () => {
    try {
      const res = await api.post(`/api/export-orders/${order.dbId || order.id}/start-docs`, {
        notes: 'Document preparation started from order detail',
      });
      const updatedOrder = res?.data?.order;
      if (updatedOrder) {
        setApiOrder(transformOrder(updatedOrder));
      }
      await fetchOrderDetail();
      refreshFromApi('orders');
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
    const supplierId = parseInt(millingSupplier);
    if (!supplierId) {
      addToast('Please select a supplier', 'error');
      return;
    }

    try {
      const res = await api.post('/api/milling/batches', {
        supplier_id: supplierId,
        linked_export_order_id: order.dbId || parseInt(order.id) || null,
        raw_qty_mt: rawQty,
        planned_finished_mt: order.qtyMT,
      });

      const batchNo = res?.data?.batch?.batch_no || res?.data?.batch?.id || 'New';
      const updatedOrder = res?.data?.order;
      if (updatedOrder) {
        setApiOrder(transformOrder(updatedOrder));
      }

      // Refresh UI immediately
      await fetchOrderDetail();
      addMillingBatch({});
      refreshFromApi('orders');

      addToast(`Milling batch ${batchNo} created successfully`);
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

      const res = await api.put(`/api/export-orders/${order.dbId || order.id}/shipment`, {
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
        notes: shipATA
          ? `Shipment arrived on ${shipATA}`
          : shipATD
          ? `Shipment departed on ${shipATD}`
          : null,
      });

      const updatedOrder = res?.data?.order;
      if (updatedOrder) {
        setApiOrder(transformOrder(updatedOrder));
      }
      await fetchOrderDetail();
      refreshFromApi('orders');
      addToast(res?.data?.transitioned_to ? `Shipment updated: ${res.data.transitioned_to}` : 'Shipment details updated');
    } catch (err) {
      addToast(`Failed to update shipment: ${err.message || 'Server error'}`, 'error');
    }
    setShowShipmentModal(false);
  };

  const handlePutOnHold = async () => {
    try {
      await api.put(`/api/export-orders/${order.dbId || order.id}/status`, {
        status: 'Cancelled',
        notes: 'Order cancelled / put on hold',
      });
      addToast('Order has been cancelled');
      fetchOrderDetail();
      refreshFromApi('orders');
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
      await api.post(`/api/export-orders/${order.dbId || order.id}/costs`, {
        category: expenseCategory,
        amount,
        notes: expenseNotes,
      });
      addToast(`$${amount.toLocaleString()} added to ${expenseCategory}`);
      await fetchOrderDetail();
      refreshFromApi('orders');
    } catch (err) {
      addToast(err.message || 'Failed to add expense', 'error');
    }
    setShowExpenseModal(false);
  };

  const handleDocumentUpload = async (docKey, file) => {
    try {
      if (file) {
        // Upload the actual file first
        const formData = new FormData();
        formData.append('file', file);
        formData.append('doc_type', docKey);
        formData.append('linked_type', 'export_order');
        formData.append('linked_id', order.dbId || order.id);
        try {
          await api.upload('/api/documents/upload', formData);
        } catch (uploadErr) {
          console.warn('File upload to document store failed:', uploadErr.message);
          // Continue with status update even if file store fails
        }
      }
      // Mark the document as uploaded in the order
      await api.post(`/api/export-orders/${order.dbId || order.id}/documents/upload`, {
        doc_type: docKey,
        file_path: file ? file.name : null,
      });
      await fetchOrderDetail();
      refreshFromApi('orders');
      addToast(`${documentLabels[docKey] || docKey} uploaded${file ? ` (${file.name})` : ''}`);
    } catch (err) {
      console.warn('API doc upload failed:', err.message);
      addToast(`Failed to upload ${documentLabels[docKey] || docKey}`, 'error');
    }
  };

  const handleDocumentApprove = async (docKey) => {
    try {
      await api.post(`/api/export-orders/${order.dbId || order.id}/documents/approve`, {
        doc_type: docKey,
        uploaded_by: 'Export Manager',
      });
      await fetchOrderDetail();
      refreshFromApi('orders');
      addToast(`${documentLabels[docKey]} approved`);
    } catch (err) {
      console.warn('API doc approve failed:', err.message);
      addToast(`Failed to approve ${documentLabels[docKey]}`, 'error');
      return;
    }
    // GAP 26: BL Draft approved → balance collection reminder
    if (docKey === 'blDraft' && order.balanceReceived < order.balanceExpected) {
      addToast('Balance collection reminder sent to customer', 'info');
      addActivityToOrder(order.id, {
        date: today(),
        action: 'BL Draft approved — balance collection reminder triggered',
        by: 'System',
      });
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
      await api.put(`/api/export-orders/${order.dbId || order.id}/status`, {
        status: 'Closed',
        notes: 'Order closed with full settlement',
      });
      addToast(`Order ${order.id} has been closed`);
      fetchOrderDetail();
      refreshFromApi('orders');
    } catch (err) {
      addToast(`Failed to close order: ${err.message || 'Server error'}`, 'error');
    }
    setShowActions(false);
  };

  // Resolve suppliers list for milling modal
  const resolvedSuppliers = localSuppliers.length > 0 ? localSuppliers : suppliersList || [];

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
            onAddReceivable={() => { addToast('Receivable recorded'); addActivityToOrder(order.id, { date: today(), action: 'Receivable added to financials', by: 'Export Manager' }); }}
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
            onLinkExternalPurchase={() => { addToast('External purchase linked'); addActivityToOrder(order.id, { date: today(), action: 'External purchase linked to order', by: 'Export Manager' }); }}
            canCreateMilling={canCreateMilling}
            canStartDocs={canStartDocs}
            onStockAllocated={() => { fetchOrderDetail(); addToast('Stock allocated successfully'); refreshFromApi('orders'); }}
          />
        )}
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
        suppliersList={resolvedSuppliers}
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
