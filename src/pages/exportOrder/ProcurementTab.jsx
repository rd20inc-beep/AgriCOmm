import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import api from '../../api/client';
import { Package, Plus, ExternalLink, Warehouse, Scale, FileText } from 'lucide-react';

export default function ProcurementTab({ order, linkedBatch, purchaseLots = [], onCreateMilling, onStartDocsPreparation, onLinkExternalPurchase, canCreateMilling, canStartDocs, onStockAllocated }) {
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

  const remainingNeeded = Math.max(0, order.qtyMT - totalAllocatedMT);

  // Fetch available finished lots when fulfillment < 100%
  useEffect(() => {
    if (fulfillmentPct >= 100) return;
    setLotsLoading(true);
    api.get('/api/inventory', { type: 'finished', status: 'Available', limit: 200 })
      .then(res => {
        const lots = res?.data?.lots || res?.data?.inventory || res?.lots || [];
        setAvailableLots(lots.filter(l => parseFloat(l.available_qty) > 0));
      })
      .catch(() => setAvailableLots([]))
      .finally(() => setLotsLoading(false));
  }, [fulfillmentPct]);

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
    const qtyToAllocate = Math.min(availMT, remainingNeeded);
    if (qtyToAllocate <= 0) return;

    setAllocatingLotId(lot.id);
    try {
      await api.post(`/api/export-orders/${order.dbId || order.id}/allocate-stock`, {
        lot_id: lot.id,
        qty_mt: qtyToAllocate,
        notes: `Quick allocation: ${qtyToAllocate.toFixed(2)} MT from ${lot.lot_no}`,
      });
      if (onStockAllocated) onStockAllocated();
    } catch (err) {
      alert(err.message || 'Allocation failed');
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

      {/* Available Stock for Allocation — click to allocate */}
      {fulfillmentPct < 100 && !lotsLoading && (matchingLots.length > 0 || otherLots.length > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6">
          <h3 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide mb-1">Available Stock — Click to Allocate</h3>
          <p className="text-xs text-gray-400 mb-4">
            Need <span className="font-semibold text-emerald-700">{remainingNeeded.toFixed(2)} MT</span> more.
            {matchingLots.length > 0 ? ` Showing lots matching "${order.productName}".` : ' No exact product match found.'}
          </p>

          {matchingLots.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {matchingLots.map(lot => {
                const availMT = parseFloat(lot.available_qty) || 0;
                const willAllocate = Math.min(availMT, remainingNeeded);
                const isAllocating = allocatingLotId === lot.id;
                return (
                  <button
                    key={lot.id}
                    onClick={() => handleQuickAllocate(lot)}
                    disabled={isAllocating || remainingNeeded <= 0}
                    className="text-left rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4 hover:border-emerald-400 hover:bg-emerald-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{lot.lot_no}</p>
                        <p className="text-xs text-gray-600">{lot.item_name || lot.product_name || 'Finished Rice'}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium">
                        {isAllocating ? 'Allocating...' : `+ ${willAllocate.toFixed(1)} MT`}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-gray-400">Available</span><br/><span className="font-semibold text-gray-900">{availMT.toFixed(2)} MT</span></div>
                      <div><span className="text-gray-400">Entity</span><br/><span className="font-semibold text-gray-900">{lot.entity || '—'}</span></div>
                      <div><span className="text-gray-400">Supplier</span><br/><span className="font-semibold text-gray-900">{lot.supplier_name || '—'}</span></div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {otherLots.length > 0 && (
            <>
              <button
                onClick={() => setShowAllLots(!showAllLots)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium mb-3"
              >
                {showAllLots ? 'Hide' : 'Show'} {otherLots.length} other available lot{otherLots.length !== 1 ? 's' : ''} (different product)
              </button>
              {showAllLots && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {otherLots.map(lot => {
                    const availMT = parseFloat(lot.available_qty) || 0;
                    const willAllocate = Math.min(availMT, remainingNeeded);
                    const isAllocating = allocatingLotId === lot.id;
                    return (
                      <button
                        key={lot.id}
                        onClick={() => handleQuickAllocate(lot)}
                        disabled={isAllocating || remainingNeeded <= 0}
                        className="text-left rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/30 transition-all disabled:opacity-50"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{lot.lot_no}</p>
                            <p className="text-xs text-gray-600">{lot.item_name || 'Finished Rice'}</p>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-600 text-white rounded-lg text-xs font-medium">
                            {isAllocating ? 'Allocating...' : `+ ${willAllocate.toFixed(1)} MT`}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-gray-400">Available</span><br/><span className="font-semibold">{availMT.toFixed(2)} MT</span></div>
                          <div><span className="text-gray-400">Entity</span><br/><span className="font-semibold">{lot.entity || '—'}</span></div>
                          <div><span className="text-gray-400">Supplier</span><br/><span className="font-semibold">{lot.supplier_name || '—'}</span></div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
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
