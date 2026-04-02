import React from 'react';
import Modal from '../../components/Modal';
import ProformaInvoice from '../../components/ProformaInvoice';
import EmailComposer from '../../components/EmailComposer';
import { AlertTriangle } from 'lucide-react';

export function AdvancePaymentModal({
  isOpen, onClose, order, formatCurrency,
  advanceAmount, setAdvanceAmount,
  advanceDate, setAdvanceDate,
  advanceMethod, setAdvanceMethod,
  advanceBankAccountId, setAdvanceBankAccountId,
  advanceBankRef, setAdvanceBankRef,
  advanceNotes, setAdvanceNotes,
  bankAccountsList,
  onConfirm,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Advance Payment" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Received Amount ($)</label>
          <input
            type="number"
            value={advanceAmount}
            onChange={e => setAdvanceAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={advanceDate}
            onChange={e => setAdvanceDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
          <select
            value={advanceMethod}
            onChange={e => setAdvanceMethod(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Wire">Wire</option>
            <option value="Cash">Cash</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receiving Bank Account</label>
          <select
            value={advanceBankAccountId || ''}
            onChange={e => setAdvanceBankAccountId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">Select account...</option>
            {(bankAccountsList || []).map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency}) — {a.bankName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bank Reference</label>
          <input
            type="text"
            value={advanceBankRef}
            onChange={e => setAdvanceBankRef(e.target.value)}
            placeholder="e.g. TXN-20250317-001"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={advanceNotes}
            onChange={e => setAdvanceNotes(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            Confirm Payment
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BalancePaymentModal({
  isOpen, onClose, order, formatCurrency,
  balanceAmount, setBalanceAmount,
  balanceDate, setBalanceDate,
  balanceMethod, setBalanceMethod,
  balanceBankAccountId, setBalanceBankAccountId,
  balanceBankRef, setBalanceBankRef,
  balanceNotes, setBalanceNotes,
  bankAccountsList,
  onConfirm,
}) {
  const outstanding = Math.max(0, (order.balanceExpected || 0) - (order.balanceReceived || 0));
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Balance Payment" size="md">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-800 mb-2">Balance Details</h4>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-blue-700">Contract Value</span>
              <span className="font-medium text-blue-900">{formatCurrency(order.contractValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-700">Advance Received</span>
              <span className="font-medium text-blue-900">{formatCurrency(order.advanceReceived)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-700">Balance Already Received</span>
              <span className="font-medium text-blue-900">{formatCurrency(order.balanceReceived)}</span>
            </div>
            <div className="flex justify-between border-t border-blue-200 pt-1.5">
              <span className="text-blue-700 font-semibold">Outstanding Balance</span>
              <span className="font-bold text-emerald-700">{formatCurrency(outstanding)}</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount Received ($)</label>
          <input type="number" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input type="date" value={balanceDate} onChange={e => setBalanceDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
          <select value={balanceMethod} onChange={e => setBalanceMethod(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Wire">Wire</option>
            <option value="LC">LC</option>
            <option value="Cash">Cash</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receiving Bank Account</label>
          <select value={balanceBankAccountId || ''} onChange={e => setBalanceBankAccountId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
            <option value="">Select account...</option>
            {(bankAccountsList || []).map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency}) — {a.bankName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bank Reference</label>
          <input type="text" value={balanceBankRef} onChange={e => setBalanceBankRef(e.target.value)} placeholder="TT/Wire reference" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={balanceNotes} onChange={e => setBalanceNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors">Confirm Balance Payment</button>
        </div>
      </div>
    </Modal>
  );
}

export function MillingDemandModal({
  isOpen, onClose, order,
  millingRawQty, setMillingRawQty,
  millingSupplier, setMillingSupplier,
  suppliersList,
  onConfirm,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Milling Demand" size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-600">
          Export Order: <span className="font-medium text-gray-900">{order.id}</span> &mdash; {order.qtyMT} MT finished rice required
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Raw Qty Required (MT)</label>
          <input
            type="number"
            value={millingRawQty}
            onChange={e => setMillingRawQty(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">Estimated at 75% milling yield</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
          <select
            value={millingSupplier}
            onChange={e => setMillingSupplier(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">Select supplier...</option>
            {(suppliersList || []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Milling Batch
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ShipmentModal({
  isOpen, onClose,
  shipVessel, setShipVessel,
  shipBooking, setShipBooking,
  shipBL, setShipBL,
  shipLine, setShipLine,
  shipETD, setShipETD,
  shipATD, setShipATD,
  shipETA, setShipETA,
  shipATA, setShipATA,
  shipDestPort, setShipDestPort,
  shipmentContainers, setShipmentContainers,
  onConfirm,
}) {
  const rows = Array.isArray(shipmentContainers) ? shipmentContainers : [];

  const updateRow = (index, field, value) => {
    setShipmentContainers((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    setShipmentContainers((prev) => ([
      ...prev,
      {
        sequenceNo: prev.length + 1,
        containerNo: '',
        sealNo: '',
        grossWeightKg: '',
        netWeightKg: '',
        notes: '',
      },
    ]));
  };

  const removeRow = (index) => {
    setShipmentContainers((prev) => {
      const next = prev.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next.map((row, rowIndex) => ({ ...row, sequenceNo: rowIndex + 1 })) : [{
        sequenceNo: 1,
        containerNo: '',
        sealNo: '',
        grossWeightKg: '',
        netWeightKg: '',
        notes: '',
      }];
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Update Shipment Details" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Name</label>
            <input type="text" value={shipVessel} onChange={e => setShipVessel(e.target.value)} placeholder="e.g. MV Pacific Star" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Line</label>
            <input type="text" value={shipLine} onChange={e => setShipLine(e.target.value)} placeholder="e.g. Maersk, MSC, CMA CGM" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Booking No</label>
            <input type="text" value={shipBooking} onChange={e => setShipBooking(e.target.value)} placeholder="e.g. BK-2025-001" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">BL Number</label>
            <input type="text" value={shipBL} onChange={e => setShipBL(e.target.value)} placeholder="e.g. MAEUSK12345" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination Port</label>
            <input type="text" value={shipDestPort} onChange={e => setShipDestPort(e.target.value)} placeholder="e.g. Conakry Port" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-700">Shipment Containers</h4>
            <p className="text-xs text-gray-500">Add one row per physical container on the shipment.</p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            + Add Container
          </button>
        </div>
        <div className="space-y-3">
          {rows.map((container, index) => (
            <div key={container.id || index} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-semibold text-gray-800">Container {index + 1}</h5>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:text-gray-400"
                  disabled={rows.length === 1}
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Container No *</label>
                  <input
                    type="text"
                    value={container.containerNo || ''}
                    onChange={e => updateRow(index, 'containerNo', e.target.value)}
                    placeholder="e.g. MSCU1234567"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seal No</label>
                  <input
                    type="text"
                    value={container.sealNo || ''}
                    onChange={e => updateRow(index, 'sealNo', e.target.value)}
                    placeholder="e.g. SEAL-7781"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gross Weight (kg)</label>
                  <input
                    type="number"
                    value={container.grossWeightKg ?? ''}
                    onChange={e => updateRow(index, 'grossWeightKg', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Net Weight (kg)</label>
                  <input
                    type="number"
                    value={container.netWeightKg ?? ''}
                    onChange={e => updateRow(index, 'netWeightKg', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={container.notes || ''}
                    onChange={e => updateRow(index, 'notes', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ETD (Estimated Departure)</label>
            <input type="date" value={shipETD} onChange={e => setShipETD(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ATD (Actual Departure)</label>
            <input type="date" value={shipATD} onChange={e => setShipATD(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ETA (Estimated Arrival)</label>
            <input type="date" value={shipETA} onChange={e => setShipETA(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ATA (Actual Arrival)</label>
            <input type="date" value={shipATA} onChange={e => setShipATA(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">Save Shipment</button>
        </div>
      </div>
    </Modal>
  );
}

export function HoldModal({ isOpen, onClose, order, onConfirm }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Put Order On Hold" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Are you sure you want to put this order on hold?</p>
            <p className="text-xs text-amber-600 mt-1">
              Order <span className="font-medium">{order.id}</span> for {order.customerName} will be marked as On Hold. This can be reversed later.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
          >
            Put On Hold
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ExpenseModal({
  isOpen, onClose,
  expenseCategory, setExpenseCategory,
  expenseAmount, setExpenseAmount,
  expenseNotes, setExpenseNotes,
  exportCostCategories,
  onConfirm,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Expense" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={expenseCategory}
            onChange={e => setExpenseCategory(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {exportCostCategories.map(cat => (
              <option key={cat.key} value={cat.key}>{cat.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
          <input
            type="number"
            value={expenseAmount}
            onChange={e => setExpenseAmount(e.target.value)}
            placeholder="0"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={expenseNotes}
            onChange={e => setExpenseNotes(e.target.value)}
            rows={3}
            placeholder="Optional notes about this expense"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Expense
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function InvoicePreviewModal({ isOpen, onClose, order, companyProfile }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Proforma Invoice Preview" size="lg">
      <ProformaInvoice order={order} companyProfile={companyProfile} />
    </Modal>
  );
}

export function OrderEmailComposer({ isOpen, onClose, defaultTo, defaultSubject, defaultBody, attachmentLabel }) {
  return (
    <EmailComposer
      isOpen={isOpen}
      onClose={onClose}
      defaultTo={defaultTo}
      defaultSubject={defaultSubject}
      defaultBody={defaultBody}
      attachmentLabel={attachmentLabel}
    />
  );
}
