import React from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { Package, Plus, ExternalLink, Warehouse, Scale } from 'lucide-react';

export default function ProcurementTab({ order, linkedBatch, purchaseLots = [], onCreateMilling, onLinkExternalPurchase, canCreateMilling }) {
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
          {purchaseLots.length > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Allocated from Lots</span>
                <span className="font-medium text-gray-900">{totalAllocatedMT.toFixed(2)} MT</span>
              </div>
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">{order.millingOrderId}</p>
              <p className="text-sm text-gray-500">Linked to this export order</p>
            </div>
            <Link
              to={`/milling/${order.millingOrderId}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              View Details
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
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

      {/* Purchase Lots */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Purchase Lots</h3>
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
                    No purchase lots allocated yet. Transfer lots from Inventory to this order.
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
            <span className="font-bold text-gray-900">{totalAllocatedMT.toFixed(2)} MT</span>
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
