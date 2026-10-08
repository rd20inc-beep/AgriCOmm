import React, { useEffect, useRef } from 'react';
import Modal from '../../../components/Modal';
import SlideDrawer from '../../../components/SlideDrawer';
import FieldError from '../../../shared/components/FieldError';
import { fmtNum } from '../../../shared/utils/format';
import ProformaInvoice from '../../../components/ProformaInvoice';
import SupplierPicker from '../../../components/SupplierPicker';
import { Boxes, Factory, CheckCircle, Ship, Receipt } from 'lucide-react';
import StockAllocationPicker from './StockAllocationPicker';
import { favStar } from '../../../shared/utils/favorites';

const BTN_CANCEL = 'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50';

// Cancel + primary action for a drawer footer. The primary is disabled while
// the save is in flight so a double-click can't submit twice.
function DrawerFooter({ onClose, onConfirm, label, pendingLabel = 'Saving…', pending = false, tone = 'bg-blue-600 hover:bg-blue-700', closeLabel = 'Cancel' }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <button type="button" onClick={onClose} className={BTN_CANCEL}>{closeLabel}</button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tone}`}
      >
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}

// #3 Fulfil Milling Demand — two options in one modal: reserve existing finished
// stock (Option 1) and/or create a milling order for whatever's left (Option 2).
// The milling raw qty auto-targets the SHORTFALL (order − already reserved); when
// stock fully covers the order, Option 2 is replaced by "Proceed to Documentation".
const YIELD = 0.75;
function FulfilStat({ label, value, tone }) {
  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm font-bold ${tone || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
export function MillingDemandModal({
  isOpen, onClose, order,
  millingRawQty, setMillingRawQty,
  millingSupplier, setMillingSupplier,
  suppliersList,
  onConfirm,
  allocatedMT = 0,          // finished MT already reserved from stock
  onAllocated,              // called after a reservation (parent refetches)
  onSourceFromStock,        // called to skip milling when fully covered
  addToast,
  pending = false,          // milling batch create in flight
}) {
  const requiredMT = parseFloat(order.qtyMT) || 0;
  const remainingMT = Math.max(0, Math.round((requiredMT - (parseFloat(allocatedMT) || 0)) * 1000) / 1000);
  const fullyCovered = remainingMT <= 0.0001;
  const rawTouched = useRef(false);

  // Keep the milling raw-qty defaulted to the shortfall (grossed up for yield)
  // until the user manually edits it, so "only the remaining qty is milled".
  useEffect(() => {
    if (!isOpen) { rawTouched.current = false; return; }
    if (!rawTouched.current) {
      setMillingRawQty(remainingMT > 0 ? Math.ceil((remainingMT / YIELD) * 100) / 100 : 0);
    }
  }, [isOpen, remainingMT]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SlideDrawer
      open={isOpen}
      onClose={onClose}
      title="Fulfil Milling Demand"
      subtitle={order?.id}
      icon={Factory}
      size="2xl"
      footer={fullyCovered
        ? <DrawerFooter onClose={onClose} onConfirm={onSourceFromStock} closeLabel="Close" label="Proceed to Documentation" tone="bg-emerald-600 hover:bg-emerald-700" />
        : <DrawerFooter onClose={onClose} onConfirm={onConfirm} pending={pending} label="Create Milling Batch" pendingLabel="Creating…" />}
    >
      <div className="space-y-5">
        {/* Fulfilment summary */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-sm text-gray-600 mb-2">
            Export Order <span className="font-medium text-gray-900">{order.id}</span> — {requiredMT} MT {order.productName || 'finished rice'} required
          </p>
          <div className="grid grid-cols-3 gap-2">
            <FulfilStat label="Required" value={`${requiredMT} MT`} />
            <FulfilStat label="From stock" value={`${fmtNum(parseFloat(allocatedMT) || 0, 2)} MT`} tone="text-emerald-700" />
            <FulfilStat label="To mill" value={`${fmtNum(remainingMT, 2)} MT`} tone={fullyCovered ? 'text-emerald-700' : 'text-amber-600'} />
          </div>
        </div>

        {/* Option 1 — Fulfil from Existing Inventory */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Boxes className="w-4 h-4 text-emerald-600" />
            <h4 className="text-sm font-semibold text-gray-800">Option 1 — Fulfil from Existing Inventory</h4>
          </div>
          <p className="text-xs text-gray-400 mb-2">Reserve available finished stock against this order. Reserved stock is held (deducted when the order ships) and reduces what needs milling.</p>
          {fullyCovered ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Order is fully covered by reserved stock — no milling needed.
            </div>
          ) : (
            <StockAllocationPicker
              orderId={order.dbId || order.id}
              orderProductId={order.productId}
              orderProductName={order.productName}
              remainingNeededKg={remainingMT * 1000}
              onAllocated={onAllocated}
              addToast={addToast}
              compact
            />
          )}
        </div>

        {/* Option 2 — Create New Milling Order (or proceed, if fully covered) */}
        {fullyCovered ? (
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500">Nothing left to mill. Move the order straight to documentation.</p>
          </div>
        ) : (
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Factory className="w-4 h-4 text-blue-600" />
              <h4 className="text-sm font-semibold text-gray-800">Option 2 — Create Milling Order for the remaining {remainingMT.toFixed(2)} MT</h4>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rice Type</label>
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-900">{order.productName || '—'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Raw Qty Required (MT)</label>
                <input
                  type="number"
                  value={millingRawQty}
                  onChange={e => { rawTouched.current = true; setMillingRawQty(e.target.value); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">Defaults to the {remainingMT.toFixed(2)} MT shortfall at 75% yield</p>
              </div>
            </div>
            <div className="mt-3">
              <SupplierPicker
                label="Supplier"
                value={millingSupplier ? String(millingSupplier) : ''}
                onChange={setMillingSupplier}
                suppliers={suppliersList || []}
                placeholder="Type to search supplier or leave for mill to decide..."
                addToast={addToast}
                clearable
              />
              <p className="text-xs text-gray-400 mt-1">Optional — mill can assign the supplier later</p>
            </div>
          </div>
        )}
      </div>
    </SlideDrawer>
  );
}

export function ShipmentModal({
  isOpen, onClose,
  // ATD/ATA move the order to Shipped/Arrived, which only exists from Ready to
  // Ship. Before that, every other shipment field can be filled in already.
  canRecordDeparture = true,
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
  shipGatePass, setShipGatePass,
  shipContractNo, setShipContractNo,
  shipBankAccountId, setShipBankAccountId,
  bankAccountsList = [],
  shipmentContainers, setShipmentContainers,
  reservedLots = [],
  onConfirm,
  pending = false,
}) {
  const bankOptions = (bankAccountsList || []).filter((b) => b.type !== 'cash');
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
    <SlideDrawer
      open={isOpen}
      onClose={onClose}
      title="Update Shipment Details"
      icon={Ship}
      size="3xl"
      footer={<DrawerFooter onClose={onClose} onConfirm={onConfirm} pending={pending} label="Save Shipment" />}
    >
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Container No <span className="text-red-500">*</span></label>
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
            <input type="date" value={shipATD} disabled={!canRecordDeparture} onChange={e => setShipATD(e.target.value)} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${!canRecordDeparture ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`} />
            {!canRecordDeparture && <p className="text-xs text-gray-400 mt-1">Available once the order is Ready to Ship.</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Gate Pass No {shipATD ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">— required to ship out</span>}
          </label>
          <input type="text" value={shipGatePass || ''} onChange={e => setShipGatePass(e.target.value)} placeholder="e.g. GP-2026-014"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          <FieldError error={shipATD && !String(shipGatePass || '').trim() ? 'Required once an ATD is set' : null} />
          <p className="text-xs text-gray-400 mt-1">Recorded when the goods leave the premises (set an ATD to mark departure). Tracked on the order.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Contract No</label>
          <input type="text" value={shipContractNo || ''} onChange={e => setShipContractNo(e.target.value)} placeholder="e.g. AGRI/2026/014" maxLength={50}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          <p className="text-xs text-gray-400 mt-1">Heads every generated document. Also set when the order is created and on the Overview tab. Clearing this field clears the number.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ETA (Estimated Arrival)</label>
            <input type="date" value={shipETA} onChange={e => setShipETA(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ATA (Actual Arrival)</label>
            <input type="date" value={shipATA} disabled={!canRecordDeparture} onChange={e => setShipATA(e.target.value)} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${!canRecordDeparture ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`} />
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
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Bank Account <span className="text-gray-400 font-normal">— shown on this order's documents</span></label>
            <select value={shipBankAccountId || ''} onChange={e => setShipBankAccountId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="">Use export default</option>
              {bankOptions.map((b) => <option key={b.id} value={b.id}>{favStar(b)}{b.name}{b.bankName ? ` — ${b.bankName}` : ''}{b.iban ? ` (${b.iban})` : ''}</option>)}
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

      </div>
    </SlideDrawer>
  );
}

export function ExpenseModal({
  isOpen, onClose,
  expenseCategory, setExpenseCategory,
  expenseAmount, setExpenseAmount,
  expenseNotes, setExpenseNotes,
  exportCostCategories,
  onConfirm,
  pending = false,
}) {
  return (
    <SlideDrawer
      open={isOpen}
      onClose={onClose}
      title="Add Expense"
      icon={Receipt}
      size="md"
      footer={<DrawerFooter onClose={onClose} onConfirm={onConfirm} pending={pending} label="Add Expense" />}
    >
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs) <span className="text-red-500">*</span></label>
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
      </div>
    </SlideDrawer>
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
