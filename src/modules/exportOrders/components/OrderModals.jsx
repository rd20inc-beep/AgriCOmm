import React from 'react';
import Modal from '../../../components/Modal';
import ProformaInvoice from '../../../components/ProformaInvoice';
import EmailComposer from '../../../components/EmailComposer';
import SearchSelect from '../../../components/SearchSelect';
import { AlertTriangle } from 'lucide-react';

export function AdvancePaymentModal({
  isOpen, onClose, order, formatCurrency,
  advanceAmount, setAdvanceAmount,
  advanceDate, setAdvanceDate,
  advanceMethod, setAdvanceMethod,
  advanceBankAccountId, setAdvanceBankAccountId,
  advanceBankRef, setAdvanceBankRef,
  advanceNotes, setAdvanceNotes,
  advanceFxRate, setAdvanceFxRate,
  bankAccountsList,
  onConfirm,
}) {
  const orderCurrency = order?.currency || 'USD';
  const symbol = orderCurrency === 'USD' ? '$' : orderCurrency === 'EUR' ? '€' : orderCurrency === 'GBP' ? '£' : orderCurrency;
  const isForeign = orderCurrency !== 'PKR';
  const fxRateNum = parseFloat(advanceFxRate) || 0;
  const amountNum = parseFloat(advanceAmount) || 0;
  const pkrEquivalent = isForeign ? amountNum * fxRateNum : amountNum;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Advance Payment" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Received Amount ({symbol})</label>
          <input
            type="number"
            value={advanceAmount}
            onChange={e => setAdvanceAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Exchange rate — only for foreign-currency orders. This is the
            single point at which $→PKR is locked; everything downstream
            (costs, profit, payables) is then PKR-only. */}
        {isForeign && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-1">
                Exchange Rate (1 {symbol} = ? Rs) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                value={advanceFxRate}
                onChange={e => setAdvanceFxRate(e.target.value)}
                placeholder={order?.bookedFxRate ? `Booked: ${order.bookedFxRate}` : 'e.g. 285.5000'}
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
              />
              <p className="text-[11px] text-amber-700 mt-1">
                Rate the bank actually applied for this credit. From this point on, the order is tracked in PKR.
              </p>
            </div>
            {fxRateNum > 0 && amountNum > 0 && (
              <div className="bg-white border border-amber-200 rounded-md px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-gray-500">PKR equivalent banked</span>
                <span className="font-bold text-gray-900">Rs {pkrEquivalent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            {order?.bookedFxRate && fxRateNum > 0 && (
              (() => {
                const delta = fxRateNum - parseFloat(order.bookedFxRate);
                if (Math.abs(delta) < 0.01) return null;
                const isGain = delta > 0;
                const pkrDelta = amountNum * Math.abs(delta);
                return (
                  <div className={`text-[11px] flex items-center justify-between px-3 py-1.5 rounded-md ${isGain ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    <span>vs booked {order.bookedFxRate}: {isGain ? '+' : '-'}{Math.abs(delta).toFixed(4)} Rs/{symbol}</span>
                    <span className="font-semibold">{isGain ? '+' : '-'}Rs {pkrDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                );
              })()
            )}
          </div>
        )}
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
            <option value="bank_transfer">Bank Transfer</option>
            <option value="wire">Wire</option>
            <option value="cash">Cash</option>
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
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
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
  balanceFxRate, setBalanceFxRate,
  bankAccountsList,
  onConfirm,
}) {
  const outstanding = Math.max(0, (order.balanceExpected || 0) - (order.balanceReceived || 0));
  const orderCurrency = order?.currency || 'USD';
  const symbol = orderCurrency === 'USD' ? '$' : orderCurrency === 'EUR' ? '€' : orderCurrency === 'GBP' ? '£' : orderCurrency;
  const isForeign = orderCurrency !== 'PKR';
  const fxRateNum = parseFloat(balanceFxRate) || 0;
  const amountNum = parseFloat(balanceAmount) || 0;
  const pkrEquivalent = isForeign ? amountNum * fxRateNum : amountNum;
  // Locked rate from advance receipt — most realistic comparison anchor
  const lockedRate = parseFloat(order?.advanceFxRate) || parseFloat(order?.bookedFxRate) || 0;
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount Received ({symbol})</label>
          <input type="number" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>

        {/* Exchange rate — required for foreign-currency orders, mirroring
            the advance modal. Locks $→PKR for the balance leg so PKR
            totals downstream are exact. */}
        {isForeign && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-1">
                Exchange Rate (1 {symbol} = ? Rs) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                value={balanceFxRate}
                onChange={e => setBalanceFxRate(e.target.value)}
                placeholder={lockedRate ? `Advance locked: ${lockedRate}` : 'e.g. 285.5000'}
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
              />
              <p className="text-[11px] text-amber-700 mt-1">
                Rate the bank actually applied for the balance credit. PKR-equivalent banked amount is computed from this.
              </p>
            </div>
            {fxRateNum > 0 && amountNum > 0 && (
              <div className="bg-white border border-amber-200 rounded-md px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-gray-500">PKR equivalent banked</span>
                <span className="font-bold text-gray-900">Rs {pkrEquivalent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            {lockedRate > 0 && fxRateNum > 0 && (
              (() => {
                const delta = fxRateNum - lockedRate;
                if (Math.abs(delta) < 0.01) return null;
                const isGain = delta > 0;
                const pkrDelta = amountNum * Math.abs(delta);
                return (
                  <div className={`text-[11px] flex items-center justify-between px-3 py-1.5 rounded-md ${isGain ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    <span>vs advance/booked {lockedRate}: {isGain ? '+' : '-'}{Math.abs(delta).toFixed(4)} Rs/{symbol}</span>
                    <span className="font-semibold">{isGain ? '+' : '-'}Rs {pkrDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                );
              })()
            )}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input type="date" value={balanceDate} onChange={e => setBalanceDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
          <select value={balanceMethod} onChange={e => setBalanceMethod(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="bank_transfer">Bank Transfer</option>
            <option value="wire">Wire</option>
            <option value="lc">LC</option>
            <option value="cash">Cash</option>
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
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors">Confirm Balance Payment</button>
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Rice Type</label>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-900">
            {order.productName || '—'}
          </div>
          <p className="text-xs text-gray-400 mt-1">From this export order — the batch and its output lots inherit this variety.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Required Packing</label>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-900">
            {order.packingType === 'container'
              ? 'Bulk container — no bags'
              : order.packingType === 'jumbo'
                ? `1,200 kg jumbo FIBC${order.bagMaterial ? ` · ${order.bagMaterial}` : ''}${order.palletized ? ' · palletized' : ''}`
                : `${order.bagSizeKg ? `${order.bagSizeKg} kg` : 'Retail'} bags${order.bagMaterial ? ` · ${order.bagMaterial}` : ''}${order.masterBagSizeKg ? ` · ${order.masterBagSizeKg} kg master` : ''}${order.palletized ? ' · palletized' : ''}`}
          </div>
          <p className="text-xs text-gray-400 mt-1">What the export customer requires — the mill packs the finished rice to this spec.</p>
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
          <SearchSelect
            value={millingSupplier}
            onChange={setMillingSupplier}
            options={(suppliersList || []).map(s => ({ value: s.id, label: s.name, sub: s.location || s.type || '' }))}
            placeholder="Type to search supplier or leave for mill to decide..."
          />
          <p className="text-xs text-gray-400 mt-1">Optional — mill can assign the supplier later</p>
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
  shipVoyage, setShipVoyage,
  shipGD, setShipGD,
  shipGDDate, setShipGDDate,
  shipFI, setShipFI,
  shipFI2, setShipFI2,
  shipFI3, setShipFI3,
  shipFIDate, setShipFIDate,
  shipBLDate, setShipBLDate,
  shipFreightTerms, setShipFreightTerms,
  shipConsigneeType, setShipConsigneeType,
  shipWindowStart, setShipWindowStart,
  shipWindowEnd, setShipWindowEnd,
  shipNotifyName, setShipNotifyName,
  shipNotifyAddress, setShipNotifyAddress,
  shipNotifyPhone, setShipNotifyPhone,
  shipNotifyEmail, setShipNotifyEmail,
  shipRemarks, setShipRemarks,
  shipmentContainers, setShipmentContainers,
  reservedLots = [],
  onConfirm,
}) {
  const rows = Array.isArray(shipmentContainers) ? shipmentContainers : [];

  const updateRow = (index, field, value) => {
    setShipmentContainers((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  // Toggle a reserved lot into / out of a container's structured lot links (P4c).
  const toggleContainerLot = (index, rl) => {
    setShipmentContainers((prev) => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const lots = Array.isArray(row.lots) ? row.lots : [];
      const has = lots.some((l) => String(l.lotId ?? l.lot_id) === String(rl.lotId));
      const nextLots = has
        ? lots.filter((l) => String(l.lotId ?? l.lot_id) !== String(rl.lotId))
        : [...lots, { lotId: rl.lotId, lotNo: rl.lotNo }];
      return { ...row, lots: nextLots };
    }));
  };

  const addRow = () => {
    setShipmentContainers((prev) => ([
      ...prev,
      {
        sequenceNo: prev.length + 1,
        containerNo: '',
        sealNo: '',
        lotNumber: '',
        bagsCount: '',
        grossWeightKg: '',
        netWeightKg: '',
        tareWeightKg: '',
        containerType: '20ft',
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
        lotNumber: '',
        bagsCount: '',
        grossWeightKg: '',
        netWeightKg: '',
        tareWeightKg: '',
        containerType: '20ft',
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Booking No</label>
            <input type="text" value={shipBooking} onChange={e => setShipBooking(e.target.value)} placeholder="e.g. BK-2025-001" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination Port</label>
            <input type="text" value={shipDestPort} onChange={e => setShipDestPort(e.target.value)} placeholder="e.g. Conakry Port" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">BL Number</label>
            <input type="text" value={shipBL} onChange={e => setShipBL(e.target.value)} placeholder="e.g. MAEUSK12345" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">BL Date</label>
            <input type="date" value={shipBLDate || ''} onChange={e => setShipBLDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Container Type</label>
                  <select
                    value={container.containerType || '20ft'}
                    onChange={e => updateRow(index, 'containerType', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="20ft">20ft</option>
                    <option value="40ft">40ft</option>
                    <option value="40ft HC">40ft HC</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lot / Batch Number</label>
                  <input
                    type="text"
                    value={container.lotNumber || ''}
                    onChange={e => updateRow(index, 'lotNumber', e.target.value)}
                    placeholder="e.g. LOT-2026-001"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bags Count</label>
                  <input
                    type="number"
                    value={container.bagsCount ?? ''}
                    onChange={e => updateRow(index, 'bagsCount', e.target.value)}
                    placeholder="Number of bags"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              {reservedLots.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lots loaded in this container</label>
                  <div className="flex flex-wrap gap-2">
                    {reservedLots.map((rl) => {
                      const sel = (container.lots || []).some((l) => String(l.lotId ?? l.lot_id) === String(rl.lotId));
                      return (
                        <button type="button" key={rl.lotId} onClick={() => toggleContainerLot(index, rl)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${sel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                          {rl.lotNo}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Tap the reserved lots in this container — links them by FK (and fills the Lot/Batch Number above on save).</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tare Weight (kg)</label>
                  <input
                    type="number"
                    value={container.tareWeightKg ?? ''}
                    onChange={e => updateRow(index, 'tareWeightKg', e.target.value)}
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

        {/* Voyage & GD */}
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2 border-t border-gray-200">Voyage & Customs</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Voyage Number</label>
            <input type="text" value={shipVoyage || ''} onChange={e => setShipVoyage(e.target.value)} placeholder="e.g. XA604A" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GD Number</label>
            <input type="text" value={shipGD || ''} onChange={e => setShipGD(e.target.value)} placeholder="e.g. KPPE-SB-189325" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GD Date</label>
            <input type="date" value={shipGDDate || ''} onChange={e => setShipGDDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* FI Numbers */}
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2 border-t border-gray-200">Financial Instrument (FI)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FI Number</label>
            <input type="text" value={shipFI || ''} onChange={e => setShipFI(e.target.value)} placeholder="e.g. AHB-EXP-021606-02022026" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FI Date</label>
            <input type="date" value={shipFIDate || ''} onChange={e => setShipFIDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FI Number 2</label>
            <input type="text" value={shipFI2 || ''} onChange={e => setShipFI2(e.target.value)} placeholder="Optional second FI" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FI Number 3</label>
            <input type="text" value={shipFI3 || ''} onChange={e => setShipFI3(e.target.value)} placeholder="Optional third FI" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* Freight & Consignee */}
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2 border-t border-gray-200">Freight & Consignee</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Freight Terms</label>
            <select value={shipFreightTerms || 'COLLECT'} onChange={e => setShipFreightTerms(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              <option value="COLLECT">Collect</option>
              <option value="PREPAID">Prepaid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Consignee Type</label>
            <select value={shipConsigneeType || 'to_order_of_bank'} onChange={e => setShipConsigneeType(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              <option value="to_order_of_bank">To Order of Bank</option>
              <option value="direct">Direct to Buyer</option>
            </select>
          </div>
        </div>

        {/* Shipment Window */}
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2 border-t border-gray-200">Shipment Window</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Window Start</label>
            <input type="date" value={shipWindowStart || ''} onChange={e => setShipWindowStart(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Window End</label>
            <input type="date" value={shipWindowEnd || ''} onChange={e => setShipWindowEnd(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* Notify Party */}
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2 border-t border-gray-200">Notify Party</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notify Party Name</label>
            <input type="text" value={shipNotifyName || ''} onChange={e => setShipNotifyName(e.target.value)} placeholder="If different from buyer" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notify Phone</label>
            <input type="text" value={shipNotifyPhone || ''} onChange={e => setShipNotifyPhone(e.target.value)} placeholder="Phone" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notify Address</label>
            <input type="text" value={shipNotifyAddress || ''} onChange={e => setShipNotifyAddress(e.target.value)} placeholder="Full address" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Shipment Remarks</label>
          <textarea value={shipRemarks || ''} onChange={e => setShipRemarks(e.target.value)} rows={2} placeholder="e.g. Partial shipment allowed, SGS inspection required" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs)</label>
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
  // Print/Download live inside ProformaInvoice (a clean new-window render that
  // prints the whole sheet and keeps the orientation toggle enabled).
  const footer = (
    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
  );
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Proforma Invoice Preview" size="full" footer={footer}>
      <div className="overflow-x-auto">
        <ProformaInvoice order={order} companyProfile={companyProfile} />
      </div>
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
