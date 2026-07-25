import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../../components/StatusBadge';
import PartyLink from '../../../shared/components/PartyLink';
import { financeApi } from '../../../api/services';
import { useApp } from '../../../context/AppContext';
import { Package, Plus, ExternalLink, Warehouse, Scale, FileText, Truck, ArrowRight } from 'lucide-react';
import StockAllocationPicker from './StockAllocationPicker';

export default function ProcurementTab({ order, linkedBatch, purchaseLots = [], onCreateMilling, onStartDocsPreparation, onLinkExternalPurchase, canCreateMilling, canStartDocs, onStockAllocated }) {
  // Supplier privacy: Export users see the Supplier Code, not the name/ledger link.
  const canSeeSupplierName = order?.canSeeSupplierName !== false;
  const { addToast } = useApp();
  const estimatedRawQty = Math.round(order.qtyMT / 0.75);

  // Split lots into finished (main product) and byproducts
  const finishedLots = purchaseLots.filter(l =>
    (l.type === 'finished' || l.source === 'reservation' || l.source === 'allocation' || l.source === 'both')
    && (parseFloat(l.allocated_qty_kg) > 0 || l.source === 'reservation')
  );
  const byproductLots = purchaseLots.filter(l => l.type === 'byproduct' && l.source === 'milling_output');

  // Calculate totals — only count explicitly allocated/reserved quantities
  const totalAllocatedMT = finishedLots.reduce((sum, lot) => {
    // Use allocated_qty_kg from transaction, or reserved_qty for reservation-only lots
    const kg = parseFloat(lot.allocated_qty_kg) || (lot.source === 'reservation' ? (parseFloat(lot.reserved_qty) || 0) : 0);
    return sum + kg / 1000;
  }, 0);
  const fulfillmentPct = order.qtyMT > 0 ? Math.min(100, (totalAllocatedMT / order.qtyMT) * 100) : 0;

  // Order lines — for multi-product proformas, an allocation can target a
  // specific line. Handles either casing (raw snake_case or transformed camel).
  const orderItems = (order.items || []).map((it) => ({
    id: it.id,
    lineNo: it.lineNo ?? it.line_no ?? 1,
    productName: it.productName ?? it.product_name ?? '',
    qtyMt: parseFloat(it.qtyMt ?? it.qty_mt) || 0,
  }));
  const [lineId, setLineId] = useState('');
  // Single-line orders auto-link transparently; multi-line wait for a pick.
  useEffect(() => {
    if (!lineId && orderItems.length === 1) setLineId(String(orderItems[0].id));
  }, [orderItems.length]);

  const remainingNeeded = Math.max(0, order.qtyMT - totalAllocatedMT);

  return (
    <div className="space-y-6">
      {/* Source Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Source Information</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Source Type</span>
            <span className="font-medium text-gray-900">{order.source}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Estimated Raw Qty Required</span>
            <span className="font-medium text-gray-900">{Math.round(estimatedRawQty * 1000).toLocaleString()} kg</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Finished Qty Target</span>
            <span className="font-medium text-gray-900">{Math.round(order.qtyMT * 1000).toLocaleString()} kg</span>
          </div>
          {finishedLots.length > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Reserved from Lots</span>
                <span className="font-medium text-gray-900">{Math.round(totalAllocatedMT * 1000).toLocaleString()} kg</span>
              </div>
              {remainingNeeded > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Remaining to Reserve</span>
                  <span className="font-medium text-amber-600">{Math.round(remainingNeeded * 1000).toLocaleString()} kg</span>
                </div>
              )}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Fulfillment</span>
                  <span>{fulfillmentPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${fulfillmentPct >= 100 ? 'bg-emerald-500' : fulfillmentPct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, fulfillmentPct)}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Packing / Bag Specification */}
      {(order.bagType || order.bagQuality) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Packing Specification</h3>
          <div className="grid grid-cols-2 gap-3">
            {order.bagType && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bag Type</span>
                <span className="font-medium text-gray-900">{order.bagType}</span>
              </div>
            )}
            {order.bagQuality && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bag Quality</span>
                <span className="font-medium text-gray-900">{order.bagQuality}</span>
              </div>
            )}
            {order.bagSizeKg && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bag Size</span>
                <span className="font-medium text-gray-900">{order.bagSizeKg} KG</span>
              </div>
            )}
            {order.bagWeightGm && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bag Weight</span>
                <span className="font-medium text-gray-900">{order.bagWeightGm} gm</span>
              </div>
            )}
            {order.bagPrinting && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Printing</span>
                <span className="font-medium text-gray-900">{order.bagPrinting}</span>
              </div>
            )}
            {order.bagColor && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bag Color</span>
                <span className="font-medium text-gray-900">{order.bagColor}</span>
              </div>
            )}
            {order.bagBrand && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Brand / Marking</span>
                <span className="font-medium text-gray-900">{order.bagBrand}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Bags</span>
              <span className="font-medium text-gray-900">{Math.round((order.qtyMT * 1000) / (order.bagSizeKg || 25)).toLocaleString()}</span>
            </div>
          </div>
          {order.bagNotes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500"><span className="font-medium text-gray-700">Packing Notes:</span> {order.bagNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Linked Milling Order */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Linked Milling Order</h3>
        {order.millingOrderId ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-gray-900">{order.millingOrderId}</p>
              <p className="text-sm text-gray-500">Linked to this export order</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={!canStartDocs}
                onClick={onStartDocsPreparation}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${canStartDocs ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                <FileText className="w-4 h-4" />
                Start Docs
              </button>
              <Link
                to={`/milling/${order.millingOrderId}`}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                View Details
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No milling order linked yet</p>
            <button
              disabled={!canCreateMilling}
              onClick={onCreateMilling}
              className={`mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${!canCreateMilling ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Plus className="w-4 h-4" />
              Create Milling Demand
            </button>
            <button
              onClick={onLinkExternalPurchase}
              className="mt-3 ml-2 inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Link External Purchase
            </button>
          </div>
        )}
      </div>

      {/* Receive from Mill — shows when batch completed but stock not yet transferred */}
      {linkedBatch && linkedBatch.status === 'Completed' && linkedBatch.actualFinishedMT > 0 && fulfillmentPct < 100 && (
        <ReceiveFromMill
          order={order}
          linkedBatch={linkedBatch}
          addToast={addToast}
          onTransferComplete={() => { if (onStockAllocated) onStockAllocated(); }}
        />
      )}

      {/* Fulfil from Existing Inventory — only when the order still needs more */}
      {remainingNeeded > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6">
          <h3 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide mb-1">Fulfil from Existing Inventory</h3>
          <p className="text-[11px] text-gray-400 mb-1">Reserving holds this stock for the order (it stays in the mill and is deducted when the order ships). To physically move a lot to the export entity, use “Transfer to Export” on the lot.</p>
          <p className="text-xs text-gray-400 mb-4">
            Need <span className="font-semibold text-emerald-700">{Math.round(remainingNeeded * 1000).toLocaleString()} kg</span> more. Reserve available finished stock, or use “Create Milling Demand” above to mill the remainder.
          </p>

          {orderItems.length > 1 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Reserve to product line</label>
              <select value={lineId} onChange={e => setLineId(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="">Order-wide (no specific line)</option>
                {orderItems.map(it => (
                  <option key={it.id} value={it.id}>Line {it.lineNo}: {it.productName || 'Product'} ({Math.round(it.qtyMt * 1000).toLocaleString()} kg)</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Multi-product order — the lots you reserve below are held against this line.</p>
            </div>
          )}

          <StockAllocationPicker
            orderId={order.dbId || order.id}
            orderProductId={order.productId}
            orderProductName={order.productName}
            remainingNeededKg={remainingNeeded * 1000}
            lineId={lineId}
            onAllocated={() => { if (onStockAllocated) onStockAllocated(); }}
            addToast={addToast}
          />
        </div>
      )}

      {/* Allocated Stock */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Allocated Stock</h3>
          {finishedLots.length > 0 && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
              {finishedLots.length} lot{finishedLots.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left pb-2 font-semibold text-gray-600">Lot ID</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Product</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Supplier</th>
                <th className="text-right pb-2 font-semibold text-gray-600">Allocated</th>
                <th className="text-right pb-2 font-semibold text-gray-600">Rate/kg</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Warehouse</th>
                <th className="text-center pb-2 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {finishedLots.length > 0 ? (
                finishedLots.map((lot, idx) => {
                  const allocKg = parseFloat(lot.allocated_qty_kg) || parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0);
                  const allocMT = (allocKg / 1000).toFixed(2);
                  const ratePerKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
                  const ratePerKgDisplay = ratePerKg > 0 ? Math.round(ratePerKg).toLocaleString() : '\u2014';

                  return (
                    <tr key={lot.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td data-label="Lot ID" className="py-2.5">
                        <Link
                          to={`/lot-inventory/${lot.lot_no || lot.id}`}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {lot.lot_no || `LOT-${lot.id}`}
                        </Link>
                        {lot.variety && (
                          <p className="text-xs text-gray-400 mt-0.5">{lot.variety} {lot.grade ? `(${lot.grade})` : ''}</p>
                        )}
                      </td>
                      <td data-label="Product" className="py-2.5 text-gray-700">{lot.product_name || lot.item_name || '\u2014'}</td>
                      <td data-label="Supplier" className="mob-hide py-2.5 text-gray-700">{lot.supplier_name || lot.supplier_code || '\u2014'}</td>
                      <td data-label="Allocated" className="py-2.5 text-right font-medium text-gray-900">{Math.round(allocKg).toLocaleString()} kg</td>
                      <td data-label="Rate/kg" className="mob-hide py-2.5 text-right text-gray-700">
                        {ratePerKg > 0 ? `PKR ${ratePerKgDisplay}` : '\u2014'}
                      </td>
                      <td data-label="Warehouse" className="mob-hide py-2.5 text-gray-700">
                        {lot.warehouse_name ? (
                          <span className="inline-flex items-center gap-1">
                            <Warehouse className="w-3 h-3 text-gray-400" />
                            {lot.warehouse_name}
                          </span>
                        ) : '\u2014'}
                      </td>
                      <td data-label="Status" className="py-2.5 text-center">
                        <StatusBadge status={lot.status} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400 text-sm">
                    <Scale className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                    No stock allocated yet. Use "Allocate Stock" to transfer inventory to this order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary row */}
        {finishedLots.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between text-sm">
            <span className="font-semibold text-gray-700">Total Allocated</span>
            <span className="font-bold text-gray-900">{Math.round(totalAllocatedMT * 1000).toLocaleString()} kg / {Math.round(order.qtyMT * 1000).toLocaleString()} kg required</span>
          </div>
        )}
      </div>

      {/* Byproducts from Milling */}
      {byproductLots.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Milling Byproducts</h3>
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left pb-2 font-semibold text-gray-600">Lot ID</th>
                  <th className="text-left pb-2 font-semibold text-gray-600">Product</th>
                  <th className="text-right pb-2 font-semibold text-gray-600">Qty kg</th>
                  <th className="text-left pb-2 font-semibold text-gray-600">Warehouse</th>
                  <th className="text-center pb-2 font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {byproductLots.map((lot, idx) => (
                  <tr key={lot.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td data-label="Lot ID" className="py-2">
                      <Link to={`/lot-inventory/${lot.lot_no || lot.id}`} className="font-medium text-blue-600 hover:underline">
                        {lot.lot_no}
                      </Link>
                    </td>
                    <td data-label="Product" className="py-2 text-gray-700">{lot.product_name || lot.item_name}</td>
                    <td data-label="Qty kg" className="py-2 text-right text-gray-900">{Math.round(parseFloat(lot.qty) || 0).toLocaleString()}</td>
                    <td data-label="Warehouse" className="mob-hide py-2 text-gray-700">{lot.warehouse_name || '\u2014'}</td>
                    <td data-label="Status" className="py-2 text-center"><StatusBadge status={lot.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Receive from Mill sub-component ───
function ReceiveFromMill({ order, linkedBatch, addToast, onTransferComplete }) {
  const [transferring, setTransferring] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Supplier privacy: Export users see the Supplier Code, not the name/ledger link.
  const canSeeSupplierName = order?.canSeeSupplierName !== false;
  const finishedMT = parseFloat(linkedBatch.actualFinishedMT) || 0;
  const batchId = linkedBatch.dbId || linkedBatch.id;
  const orderId = order.dbId || order.id;

  // Auto-calculate transfer price from batch cost: (raw cost + milling cost) per KG.
  const autoPrice = linkedBatch.totalCostPerKgFinished
    ? Math.round(linkedBatch.totalCostPerKgFinished * 100) / 100
    : '';
  const [transferPrice, setTransferPrice] = useState(autoPrice || '');

  async function handleTransfer() {
    const price = parseFloat(transferPrice); // PKR per kg
    if (!price || price <= 0) {
      addToast('Please enter the transfer price (PKR/kg)', 'error');
      return;
    }

    setTransferring(true);
    try {
      const totalPKR = Math.round(price * finishedMT * 1000); // per-kg × finished kg
      // Convert at the order's locked (booked) FX rate, not a hardcoded 280 — the
      // backend books the resulting export cost at booked_fx_rate too.
      const pkrRate = parseFloat(order?.bookedFxRate) || 280;
      await financeApi.createTransfer({
        batch_id: batchId,
        export_order_id: orderId,
        product_name: linkedBatch.productName || order.productName || 'Finished Rice',
        qty_mt: finishedMT,
        transfer_price_pkr: price * 1000, // per-kg → per-MT for the doc boundary
        total_value_pkr: totalPKR,
        usd_equivalent: Math.round(totalPKR / pkrRate),
        pkr_rate: pkrRate,
        dispatch_date: new Date().toISOString().split('T')[0],
        status: 'In Transit',
      });
      addToast(`${Math.round(finishedMT * 1000).toLocaleString()} kg transferred from mill to export — ${linkedBatch.id}`, 'success');
      if (onTransferComplete) onTransferComplete();
    } catch (err) {
      addToast(`Transfer failed: ${err.message}`, 'error');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-amber-50 rounded-xl shadow-sm border-2 border-amber-300 p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-2">
          <Truck className="w-4 h-4" />
          Receive from Mill
        </h3>
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-amber-600 hover:text-amber-800">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <>
          <p className="text-sm text-amber-700 mb-4">
            Milling batch <span className="font-bold">{linkedBatch.id}</span> has completed with{' '}
            <span className="font-bold">{Math.round(finishedMT * 1000).toLocaleString()} kg</span> finished rice.
            Transfer this stock from the mill to your export warehouse to make it available for allocation.
          </p>

          <div className="bg-white/70 rounded-lg border border-amber-200 p-4 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
              <div>
                <span className="text-xs text-gray-500">Batch</span>
                <p className="font-bold text-gray-900">{linkedBatch.id}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Finished Output</span>
                <p className="font-bold text-gray-900">{Math.round(finishedMT * 1000).toLocaleString()} kg</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Yield</span>
                <p className="font-bold text-gray-900">{linkedBatch.yieldPct || '—'}%</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Supplier</span>
                {canSeeSupplierName
                  ? <p className="font-bold"><PartyLink type="supplier" id={linkedBatch.supplierId} name={linkedBatch.supplierName} className="font-bold" /></p>
                  : <p className="font-bold text-gray-900">{linkedBatch.supplierCode || '—'}</p>}
              </div>
            </div>
            {linkedBatch.totalCostPerKgFinished > 0 && (
              <div className="border-t border-amber-200 pt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Raw Cost</span>
                  <p className="font-bold text-gray-900">PKR {(linkedBatch.rawCostPerKgFinished || 0).toFixed(2)}/KG</p>
                </div>
                <div>
                  <span className="text-gray-500">Milling Cost</span>
                  <p className="font-bold text-gray-900">PKR {(linkedBatch.millingCostPerKgFinished || 0).toFixed(2)}/KG</p>
                </div>
                <div>
                  <span className="text-gray-500">Total Finished Cost</span>
                  <p className="font-bold text-emerald-700">PKR {(linkedBatch.totalCostPerKgFinished || 0).toFixed(2)}/KG</p>
                  <p className="text-gray-400">= PKR {(linkedBatch.totalCostPerKgFinished || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-amber-800 mb-1">Transfer Price (PKR/kg) *</label>
              <input
                type="number"
                step="0.01"
                value={transferPrice}
                onChange={e => setTransferPrice(e.target.value)}
                placeholder="e.g. 72.8"
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
              />
              {transferPrice && finishedMT > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Total: PKR {(parseFloat(transferPrice) * finishedMT * 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (~${((parseFloat(transferPrice) * finishedMT * 1000) / (parseFloat(order?.bookedFxRate) || 280)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </p>
              )}
            </div>
            <button
              onClick={handleTransfer}
              disabled={transferring}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {transferring ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Transferring...
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Receive {Math.round(finishedMT * 1000).toLocaleString()} kg from Mill
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
