import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import api from '../api/client';
import { transformOrder, transformBankAccount } from '../api/transforms';
import {
  OrderHeader,
  WorkflowTimeline,
  OverviewTab,
  FinancialsTab,
  ProcurementTab,
  DocumentsTab,
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
  tabList,
  today,
  allDocsApproved,
  allDocsFinal,
  documentLabels,
} from './exportOrder';

export default function ExportOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
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

  // Milling Demand form state
  const [millingRawQty, setMillingRawQty] = useState('');
  const [millingSupplier, setMillingSupplier] = useState('');

  // Shipment form state
  const [shipVessel, setShipVessel] = useState('');
  const [shipBooking, setShipBooking] = useState('');
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
  function fetchOrderDetail() {
    setApiLoading(true);
    api.get(`/api/export-orders/${id}`)
      .then(res => {
        const raw = res?.data?.order;
        if (raw) {
          raw.costs = res.data.costs || raw.costs;
          raw.documents = res.data.documents || raw.documents;
          raw.status_history = res.data.statusHistory || raw.status_history;
          raw.packingLines = res.data.packingLines || [];
          raw.purchaseLots = res.data.purchaseLots || [];
          setApiOrder(transformOrder(raw));
        }
      })
      .catch(() => {})
      .finally(() => setApiLoading(false));
  }

  // Fetch on mount and when ID changes
  React.useEffect(() => {
    if (id) fetchOrderDetail();
  }, [id]);

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

  const totalCosts = Object.values(order.costs || {}).reduce((sum, c) => sum + (parseFloat(c) || 0), 0);
  const grossProfit = (parseFloat(order.contractValue) || 0) - totalCosts;
  const marginPct = order.contractValue > 0 ? ((grossProfit / (parseFloat(order.contractValue) || 1)) * 100).toFixed(1) : '0.0';
  const formatCurrency = (value) => '$' + (parseFloat(value) || 0).toLocaleString();

  // --- Modal openers (reset form state then show) ---

  const openAdvanceModal = () => {
    setAdvanceAmount(order.advanceExpected);
    setAdvanceDate(today());
    setAdvanceMethod('Bank Transfer');
    setAdvanceBankAccountId('');
    setAdvanceBankRef('');
    setAdvanceNotes('');
    setShowAdvanceModal(true);
  };

  const openBalanceModal = () => {
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
    try {
      const res = await api.post(`/api/export-orders/${order.dbId || order.id}/confirm-advance`, {
        amount,
        payment_date: advanceDate,
        payment_method: advanceMethod,
        bank_account_id: advanceBankAccountId || null,
        bank_reference: advanceBankRef,
        notes: advanceNotes,
      });
      // Sync local state from the API response
      const updated = res?.data?.data?.order;
      if (updated) {
        updateExportOrder(order.id, {
          advanceReceived: parseFloat(updated.advance_received) || amount,
          advanceDate: updated.advance_date || advanceDate,
          status: updated.status || 'Advance Received',
          currentStep: updated.current_step || Math.max(order.currentStep, 3),
        });
      } else {
        // Fallback if API doesn't return order
        updateExportOrder(order.id, {
          advanceReceived: amount,
          advanceDate: advanceDate,
          status: 'Advance Received',
          currentStep: Math.max(order.currentStep, 3),
        });
      }
      addActivityToOrder(order.id, {
        date: today(),
        action: `Advance payment confirmed: $${amount.toLocaleString()} via ${advanceMethod}${advanceBankRef ? ` (Ref: ${advanceBankRef})` : ''}${advanceNotes ? ` - ${advanceNotes}` : ''}`,
        by: 'Export Manager',
      });
      addToast('Advance payment confirmed successfully');
      // If milling already linked, advance further
      if (order.millingOrderId) {
        updateExportOrder(order.id, { status: 'In Milling', currentStep: Math.max(5, order.currentStep) });
      }
      fetchOrderDetail(); // Refresh this order immediately
      refreshFromApi('orders'); // Refresh orders + receivables
      refreshFromApi('finance'); // Refresh finance dashboard
    } catch (err) {
      console.warn('API advance confirm failed:', err.message);
      addToast('Failed to confirm advance payment', 'error');
    }
    setShowAdvanceModal(false);
  };

  const handleRequestBalance = () => {
    addActivityToOrder(order.id, {
      date: today(),
      action: 'Balance payment request sent to customer',
      by: 'Export Manager',
    });
    if (order.status !== 'Awaiting Balance') {
      updateExportOrder(order.id, { status: 'Awaiting Balance' });
    }
    addToast('Balance payment request sent');
    setShowBalanceModal(false);
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

      // Update the export order to link to the milling batch
      const orderId = order.dbId || order.id;
      await api.put(`/api/export-orders/${orderId}`, {
        milling_order_id: res?.data?.batch?.id || null,
        status: 'In Milling',
      }).catch(() => {}); // non-critical

      // Refresh UI immediately
      fetchOrderDetail();
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

  const handleUpdateShipment = () => {
    const updates = {
      vesselName: shipVessel,
      bookingNo: shipBooking,
      etd: shipETD,
      atd: shipATD,
      eta: shipETA,
      ata: shipATA,
      destinationPort: shipDestPort,
    };

    // Determine status based on shipment progress
    if (shipATA) {
      updates.status = 'Arrived';
      updates.currentStep = 8;
    } else if (shipATD) {
      if (!['Arrived', 'Completed'].includes(order.status)) {
        updates.status = 'Shipped';
        updates.currentStep = 7;
      }
    }

    updateExportOrder(order.id, updates);

    const parts = [];
    if (shipVessel) parts.push(`Vessel: ${shipVessel}`);
    if (shipATD) parts.push(`Departed: ${shipATD}`);
    if (shipATA) parts.push(`Arrived: ${shipATA}`);
    addActivityToOrder(order.id, {
      date: today(),
      action: `Shipment updated${parts.length ? ': ' + parts.join(', ') : ''}`,
      by: 'Export Manager',
    });

    addToast('Shipment details updated');
    setShowShipmentModal(false);
  };

  const handlePutOnHold = () => {
    updateExportOrder(order.id, { status: 'On Hold' });
    addActivityToOrder(order.id, {
      date: today(),
      action: 'Order put on hold',
      by: 'Export Manager',
    });
    addToast('Order placed on hold');
    setShowHoldModal(false);
  };

  const handleAddExpense = () => {
    const amount = parseFloat(expenseAmount) || 0;
    if (amount <= 0) {
      addToast('Please enter a valid amount');
      return;
    }
    const updatedCosts = {
      ...order.costs,
      [expenseCategory]: (order.costs[expenseCategory] || 0) + amount,
    };
    updateExportOrder(order.id, { costs: updatedCosts });
    addActivityToOrder(order.id, {
      date: today(),
      action: `Expense added: $${amount.toLocaleString()} to ${expenseCategory}${expenseNotes ? ` (${expenseNotes})` : ''}`,
      by: 'Export Manager',
    });
    addToast(`$${amount.toLocaleString()} added to ${expenseCategory}`);
    setShowExpenseModal(false);
  };

  const handleDocumentUpload = async (docKey) => {
    const updatedDocs = {
      ...order.documents,
      [docKey]: {
        status: 'Draft Uploaded',
        uploadedBy: 'Export Manager',
        date: today(),
      },
    };
    updateExportOrder(order.id, { documents: updatedDocs });
    addActivityToOrder(order.id, {
      date: today(),
      action: `${documentLabels[docKey]} draft uploaded`,
      by: 'Export Manager',
    });
    addToast(`${documentLabels[docKey]} uploaded`);
    try {
      await api.post(`/api/export-orders/${order.dbId || order.id}/documents`, {
        doc_type: docKey,
        status: 'Draft Uploaded',
        uploaded_by: 'Export Manager',
      });
    } catch (err) { console.warn('API doc upload failed:', err.message); }
  };

  const handleDocumentApprove = async (docKey) => {
    const updatedDocs = {
      ...order.documents,
      [docKey]: {
        ...(order.documents?.[docKey] || {}),
        status: 'Approved',
      },
    };
    updateExportOrder(order.id, { documents: updatedDocs });
    addActivityToOrder(order.id, {
      date: today(),
      action: `${documentLabels[docKey]} approved`,
      by: 'Export Manager',
    });
    addToast(`${documentLabels[docKey]} approved`);
    try {
      await api.post(`/api/export-orders/${order.dbId || order.id}/documents`, {
        doc_type: docKey,
        status: 'Approved',
        uploaded_by: 'Export Manager',
      });
    } catch (err) { console.warn('API doc approve failed:', err.message); }
    // GAP 26: BL Draft approved → balance collection reminder
    if (docKey === 'blDraft' && order.balanceReceived < order.balanceExpected) {
      addToast('Balance collection reminder sent to customer', 'info');
      addActivityToOrder(order.id, {
        date: today(),
        action: 'BL Draft approved — balance collection reminder triggered',
        by: 'System',
      });
    }
    // Auto-progress: if all required docs approved and order is in Docs In Preparation, advance to Awaiting Balance
    const updatedDocsCheck = { ...(order.documents || {}), [docKey]: { ...(order.documents?.[docKey] || {}), status: 'Approved' } };
    if (allDocsApproved(updatedDocsCheck) && order.status === 'Docs In Preparation') {
      updateExportOrder(order.id, { status: 'Awaiting Balance', currentStep: Math.max(order.currentStep, 5) });
      addActivityToOrder(order.id, { date: today(), action: 'All required documents approved - order advanced to Awaiting Balance', by: 'System' });
    }
    if (allDocsFinal(updatedDocsCheck) && order.status === 'Awaiting Balance') {
      updateExportOrder(order.id, { status: 'Ready to Ship', currentStep: Math.max(order.currentStep, 6) });
      addActivityToOrder(order.id, { date: today(), action: 'All documents finalized - order ready to ship', by: 'System' });
    }
  };

  // Find linked milling batch for procurement tab
  const linkedBatch = order.millingOrderId
    ? millingBatches.find(b => b.id === order.millingOrderId)
    : null;

  // Workflow gating - determine which actions are allowed
  const canConfirmAdvance = order.advanceReceived < order.advanceExpected && ['Awaiting Advance', 'Draft'].includes(order.status);
  const canRequestBalance = order.advanceReceived >= order.advanceExpected && order.balanceReceived < order.balanceExpected && !['Draft', 'Awaiting Advance', 'Closed', 'Cancelled'].includes(order.status);
  const canCreateMilling = order.advanceReceived >= order.advanceExpected && !order.millingOrderId && !['Draft', 'Closed', 'Cancelled'].includes(order.status);
  const canUpdateShipment = !['Draft', 'Awaiting Advance', 'Closed', 'Cancelled'].includes(order.status);
  const canPutOnHold = !['Closed', 'Cancelled', 'On Hold'].includes(order.status);
  const canCloseOrder = order.status === 'Arrived' || (order.balanceReceived >= order.balanceExpected && order.status === 'Shipped');

  const handleCloseOrder = () => {
    updateExportOrder(order.id, { status: 'Closed', currentStep: 9 });
    addActivityToOrder(order.id, { date: today(), action: 'Order closed with full settlement', by: 'Export Manager' });
    addToast(`Order ${order.id} has been closed`);
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
        canRequestBalance={canRequestBalance}
        canCreateMilling={canCreateMilling}
        canUpdateShipment={canUpdateShipment}
        canPutOnHold={canPutOnHold}
        canCloseOrder={canCloseOrder}
        onOpenAdvanceModal={openAdvanceModal}
        onOpenBalanceModal={openBalanceModal}
        onOpenMillingModal={openMillingModal}
        onOpenShipmentModal={openShipmentModal}
        onOpenHoldModal={openHoldModal}
        onCloseOrder={handleCloseOrder}
      />

      {/* Workflow Timeline */}
      <WorkflowTimeline order={order} />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {tabList.map(tab => (
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
            onLinkExternalPurchase={() => { addToast('External purchase linked'); addActivityToOrder(order.id, { date: today(), action: 'External purchase linked to order', by: 'Export Manager' }); }}
            canCreateMilling={canCreateMilling}
          />
        )}
        {activeTab === 'documents' && <DocumentsTab order={order} onUpload={handleDocumentUpload} onApprove={handleDocumentApprove} onPreviewInvoice={() => setShowInvoicePreview(true)} />}
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
        onConfirm={handleRequestBalance}
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
