import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import api from '../../api/client';
import { exportOrdersApi, financeApi } from '../../api/services';
import { useApp } from '../../context/AppContext';
import { Package, Plus, ExternalLink, Warehouse, Scale, FileText, Truck, ArrowRight } from 'lucide-react';

export default function ProcurementTab({ order, linkedBatch, purchaseLots = [], onCreateMilling, onStartDocsPreparation, onLinkExternalPurchase, canCreateMilling, canStartDocs, onStockAllocated }) {
  const { addToast } = useApp();
  const estimatedRawQty = Math.round(order.qtyMT / 0.75);

  // Split lots into finished (main product) and byproducts
  const finishedLots = purchaseLots.filter(l => l.type === 'finished' || l.source === 'reservation' || l.source === 'allocation');
  const byproductLots = purchaseLots.filter(l => l.type === 'byproduct' && l.source === 'milling_output');

  // Calculate totals from finished lots only
  const totalAllocatedMT = finishedLots.reduce((sum, lot) => {
    const kg = parseFloat(lot.allocated_qty_kg) || parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000;
    return sum + kg / 1000;
  }, 0);
  const fulfillmentPct = order.qtyMT > 0 ? Math.min(100, (totalAllocatedMT / order.qtyMT) * 100) : 0;

  // Available lots for allocation
  const [availableLots, setAvailableLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [allocatingLotId, setAllocatingLotId] = useState(null);
  const [showAllLots, setShowAllLots] = useState(false);
  const [customQty, setCustomQty] = useState({});
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const remainingNeeded = Math.max(0, order.qtyMT - totalAllocatedMT);

  // Fetch available finished lots only when order needs more stock
  useEffect(() => {
    if (remainingNeeded <= 0) { setAvailableLots([]); return; }
    setLotsLoading(true);
    api.get('/api/inventory', { type: 'finished', status: 'Available', entity: 'mill', limit: 200 })
      .then(res => {
        const lots = res?.data?.lots || res?.data?.inventory || res?.lots || [];
        setAvailableLots(lots.filter(l => parseFloat(l.available_qty) > 0 && !l.reserved_against));
      })
      .catch(() => setAvailableLots([]))
      .finally(() => setLotsLoading(false));
  }, [fetchTrigger, remainingNeeded]);

  // Filter lots by product match — use multiple strategies
  const orderProduct = (order.productName || '').toLowerCase();
  const orderProductId = order.productId;

  const matchingLots = availableLots.filter(l => {
    // Strategy 1: product_id FK match
    if (orderProductId && l.product_id && String(l.product_id) === String(orderProductId)) return true;

    // Strategy 2: name word matching
    const lotName = (l.item_name || l.product_name || '').toLowerCase();
    if (!orderProduct || !lotName) return false;

    // "Finished Rice" is a generic name from milling — match it if the lot came from this order's batch
    if (lotName.includes('finished rice')) return true;

    const orderWords = orderProduct.split(/\s+/).filter(w => w.length > 2 && w !== 'rice');
    if (orderWords.length === 0) return true; // no distinguishing words, show all
    const matchCount = orderWords.filter(w => lotName.includes(w)).length;
    return matchCount >= 1; // at least 1 significant word matches
  });
  const otherLots = availableLots.filter(l => !matchingLots.includes(l));

  async function handleQuickAllocate(lot) {
    const availMT = parseFloat(lot.available_qty) || 0;
    const enteredQty = parseFloat(customQty[lot.id]);
    const qtyToAllocate = enteredQty > 0 ? Math.min(enteredQty, availMT, remainingNeeded) : Math.min(availMT, remainingNeeded);
    if (qtyToAllocate <= 0) return;

    setAllocatingLotId(lot.id);
    try {
      await exportOrdersApi.allocateStock(order.dbId || order.id, {
        lot_id: lot.id,
        qty_mt: qtyToAllocate,
        notes: `Allocated ${qtyToAllocate.toFixed(2)} MT from ${lot.lot_no}`,
      });
      addToast(`${qtyToAllocate.toFixed(2)} MT allocated from ${lot.lot_no}`, 'success');
      setCustomQty(prev => ({ ...prev, [lot.id]: '' }));
      setFetchTrigger(t => t + 1); // refresh available lots
      if (onStockAllocated) onStockAllocated();
    } catch (err) {
      addToast(err.message || 'Allocation failed', 'error');
    } finally {
      setAllocatingLotId(null);
    }
  }

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
            <span className="font-medium text-gray-900">{estimatedRawQty} MT</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Finished Qty Target</span>
            <span className="font-medium text-gray-900">{order.qtyMT} MT</span>
          </div>
          {finishedLots.length > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Allocated from Lots</span>
                <span className="font-medium text-gray-900">{totalAllocatedMT.toFixed(2)} MT</span>
              </div>
              {remainingNeeded > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Remaining to Allocate</span>
                  <span className="font-medium text-amber-600">{remainingNeeded.toFixed(2)} MT</span>
                </div>
              )}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Fulfillment</span>
                  <span>{fulfillmentPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${fulfillmentPct >= 100 ? 'bg-green-500' : fulfillmentPct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
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

      {/* Available Stock for Allocation — only when order needs more */}
      {remainingNeeded > 0 && !lotsLoading && availableLots.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Available Finished Stock</h3>
            <button onClick={() => setFetchTrigger(t => t + 1)} className="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            {remainingNeeded > 0
              ? <>Need <span className="font-semibold text-emerald-700">{remainingNeeded.toFixed(2)} MT</span> more. Enter qty or click Allocate for full amount.</>
              : <span className="text-green-600 font-medium">Fully allocated!</span>
            }
          </p>

          <div className="space-y-3">
            {[...matchingLots, ...(showAllLots ? otherLots : [])].map(lot => {
              const availMT = parseFloat(lot.available_qty) || 0;
              const defaultQty = Math.min(availMT, remainingNeeded);
              const enteredQty = customQty[lot.id];
              const willAllocate = enteredQty ? Math.min(parseFloat(enteredQty) || 0, availMT, remainingNeeded) : defaultQty;
              const isAllocating = allocatingLotId === lot.id;
              const isMatch = matchingLots.includes(lot);

              return (
                <div
                  key={lot.id}
                  className={`rounded-lg border-2 p-4 transition-all ${
                    isMatch ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold text-gray-900">{lot.lot_no}</p>
                        {lot.batch_ref && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{lot.batch_ref}</span>}
                      </div>
                      <p className="text-xs text-gray-600 mb-2">{lot.item_name || lot.product_name || 'Finished Rice'}</p>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div><span className="text-gray-400">Available</span><br/><span className="font-bold text-emerald-700">{availMT.toFixed(2)} MT</span></div>
                        <div><span className="text-gray-400">Entity</span><br/><span className="font-semibold text-gray-900">{lot.entity || '—'}</span></div>
                        <div><span className="text-gray-400">Supplier</span><br/><span className="font-semibold text-gray-900">{lot.supplier_name || '—'}</span></div>
                        <div><span className="text-gray-400">Warehouse</span><br/><span className="font-semibold text-gray-900">{lot.warehouse_name || '—'}</span></div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={enteredQty ?? ''}
                          onChange={e => setCustomQty(prev => ({ ...prev, [lot.id]: e.target.value }))}
                          placeholder={defaultQty.toFixed(2)}
                          className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                          min="0.01"
                          max={Math.min(availMT, remainingNeeded)}
                          step="0.01"
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="text-xs text-gray-400">MT</span>
                      </div>
                      <button
                        onClick={() => handleQuickAllocate(lot)}
                        disabled={isAllocating || remainingNeeded <= 0 || willAllocate <= 0}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isAllocating ? (
                          <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Allocating...</>
                        ) : (
                          <><Plus className="w-3 h-3" /> Allocate {willAllocate.toFixed(2)} MT</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {otherLots.length > 0 && !showAllLots && (
            <button
              onClick={() => setShowAllLots(true)}
              className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Show {otherLots.length} more lot{otherLots.length !== 1 ? 's' : ''} (other products)
            </button>
          )}
          {showAllLots && otherLots.length > 0 && (
            <button
              onClick={() => setShowAllLots(false)}
              className="mt-3 text-xs text-gray-500 hover:text-gray-700 font-medium"
            >
              Hide other products
            </button>
          )}
        </div>
      )}

      {lotsLoading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-400">Loading available stock...</p>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left pb-2 font-semibold text-gray-600">Lot ID</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Product</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Supplier</th>
                <th className="text-right pb-2 font-semibold text-gray-600">Allocated</th>
                <th className="text-right pb-2 font-semibold text-gray-600">Rate/MT</th>
                <th className="text-left pb-2 font-semibold text-gray-600">Warehouse</th>
                <th className="text-center pb-2 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {finishedLots.length > 0 ? (
                finishedLots.map((lot, idx) => {
                  const allocKg = parseFloat(lot.allocated_qty_kg) || parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000;
                  const allocMT = (allocKg / 1000).toFixed(2);
                  const ratePerKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
                  const ratePerMT = ratePerKg > 0 ? Math.round(ratePerKg * 1000).toLocaleString() : '\u2014';

                  return (
                    <tr key={lot.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5">
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
                      <td className="py-2.5 text-gray-700">{lot.product_name || lot.item_name || '\u2014'}</td>
                      <td className="py-2.5 text-gray-700">{lot.supplier_name || '\u2014'}</td>
                      <td className="py-2.5 text-right font-medium text-gray-900">{allocMT} MT</td>
                      <td className="py-2.5 text-right text-gray-700">
                        {ratePerKg > 0 ? `PKR ${ratePerMT}` : '\u2014'}
                      </td>
                      <td className="py-2.5 text-gray-700">
                        {lot.warehouse_name ? (
                          <span className="inline-flex items-center gap-1">
                            <Warehouse className="w-3 h-3 text-gray-400" />
                            {lot.warehouse_name}
                          </span>
                        ) : '\u2014'}
                      </td>
                      <td className="py-2.5 text-center">
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
            <span className="font-bold text-gray-900">{totalAllocatedMT.toFixed(2)} MT / {order.qtyMT} MT required</span>
          </div>
        )}
      </div>

      {/* Byproducts from Milling */}
      {byproductLots.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Milling Byproducts</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left pb-2 font-semibold text-gray-600">Lot ID</th>
                  <th className="text-left pb-2 font-semibold text-gray-600">Product</th>
                  <th className="text-right pb-2 font-semibold text-gray-600">Qty MT</th>
                  <th className="text-left pb-2 font-semibold text-gray-600">Warehouse</th>
                  <th className="text-center pb-2 font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {byproductLots.map((lot, idx) => (
                  <tr key={lot.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2">
                      <Link to={`/lot-inventory/${lot.lot_no || lot.id}`} className="font-medium text-blue-600 hover:underline">
                        {lot.lot_no}
                      </Link>
                    </td>
                    <td className="py-2 text-gray-700">{lot.product_name || lot.item_name}</td>
                    <td className="py-2 text-right text-gray-900">{(parseFloat(lot.qty) || 0).toFixed(2)}</td>
                    <td className="py-2 text-gray-700">{lot.warehouse_name || '\u2014'}</td>
                    <td className="py-2 text-center"><StatusBadge status={lot.status} /></td>
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
  const [transferPrice, setTransferPrice] = useState('');
  const [expanded, setExpanded] = useState(true);

  const finishedMT = parseFloat(linkedBatch.actualFinishedMT) || 0;
  const batchId = linkedBatch.dbId || linkedBatch.id;
  const orderId = order.dbId || order.id;

  async function handleTransfer() {
    const price = parseFloat(transferPrice);
    if (!price || price <= 0) {
      addToast('Please enter the transfer price (PKR/MT)', 'error');
      return;
    }

    setTransferring(true);
    try {
      const totalPKR = Math.round(price * finishedMT);
      const pkrRate = 280;
      await financeApi.createTransfer({
        batch_id: batchId,
        export_order_id: orderId,
        product_name: linkedBatch.productName || order.productName || 'Finished Rice',
        qty_mt: finishedMT,
        transfer_price_pkr: price,
        total_value_pkr: totalPKR,
        usd_equivalent: Math.round(totalPKR / pkrRate),
        pkr_rate: pkrRate,
        dispatch_date: new Date().toISOString().split('T')[0],
        status: 'In Transit',
      });
      addToast(`${finishedMT} MT transferred from mill to export — ${linkedBatch.id}`, 'success');
      if (onTransferComplete) onTransferComplete();
    } catch (err) {
      addToast(`Transfer failed: ${err.message}`, 'error');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl shadow-sm border-2 border-amber-300 p-6">
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
            <span className="font-bold">{finishedMT} MT</span> finished rice.
            Transfer this stock from the mill to your export warehouse to make it available for allocation.
          </p>

          <div className="bg-white/70 rounded-lg border border-amber-200 p-4 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-xs text-gray-500">Batch</span>
                <p className="font-bold text-gray-900">{linkedBatch.id}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Finished Output</span>
                <p className="font-bold text-gray-900">{finishedMT} MT</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Yield</span>
                <p className="font-bold text-gray-900">{linkedBatch.yieldPct || '—'}%</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Supplier</span>
                <p className="font-bold text-gray-900">{linkedBatch.supplierName || '—'}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-amber-800 mb-1">Transfer Price (PKR/MT) *</label>
              <input
                type="number"
                value={transferPrice}
                onChange={e => setTransferPrice(e.target.value)}
                placeholder="e.g. 72800"
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
              />
              {transferPrice && finishedMT > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Total: PKR {Math.round(parseFloat(transferPrice) * finishedMT).toLocaleString()} (~${Math.round((parseFloat(transferPrice) * finishedMT) / 280).toLocaleString()})
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
                  Receive {finishedMT} MT from Mill
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
