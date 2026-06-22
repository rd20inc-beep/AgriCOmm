import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Save, X } from 'lucide-react';
import PartyLink from '../../../shared/components/PartyLink';
import { useUpdateOrder } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { INCOTERMS, incotermHint } from '../../../shared/constants/incoterms';
import { PAYMENT_TERMS } from '../../../shared/constants/paymentTerms';

// Statuses where ANY contract field is fully editable.
// After milling starts, qty/price changes can desync downstream artifacts —
// but soft fields (incoterm, port, ETA, advance %) stay editable through
// dispatch via SOFT_EDITABLE below.
const CONTRACT_FULLY_EDITABLE = new Set([
  'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending',
]);
// Statuses where soft fields can still be edited (everything before Shipped).
// Once Shipped, every contract field is locked — the BL/invoice are out.
const CONTRACT_SOFT_EDITABLE = new Set([
  'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending',
  'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship',
]);
const TERMINAL_STATUSES = new Set(['Shipped', 'Arrived', 'Closed', 'Cancelled']);

export default function OverviewTab({ order, formatCurrency, formatPKR, totalCosts, grossProfit, marginPct, exportCostCategories }) {
  const formatCost = formatPKR || formatCurrency;
  const { addToast } = useApp();
  const updateOrderMut = useUpdateOrder();
  const [editing, setEditing] = useState(false);
  const [specs, setSpecs] = useState({});
  const [contractEditing, setContractEditing] = useState(false);
  const [contract, setContract] = useState({});

  const orderId = order?.dbId || order?.id;
  // Soft edit is allowed pre-shipment; hard edit (qty/price) only pre-milling.
  const contractEditable = CONTRACT_SOFT_EDITABLE.has(order?.status);
  const qtyPriceEditable = CONTRACT_FULLY_EDITABLE.has(order?.status);

  const startEditing = () => {
    setSpecs({
      // HS Code is per-item now — see the Line Items card. Removed from here
      // to avoid the dual source-of-truth that confused users.
      contract_number: order.contractNumber || '',
      invoice_number: order.invoiceNumber || '',
      broken_pct_target: order.brokenPctTarget || '',
      freight_terms: order.freightTerms || 'COLLECT',
      consignee_type: order.consigneeType || 'to_order_of_bank',
      production_date: order.productionDate || '',
      expiry_date: order.expiryDate || '',
      payment_terms: order.paymentTerms || '',
      quality_description: order.qualityDescription || '',
      production_remarks: order.productionRemarks || '',
    });
    setEditing(true);
  };

  const saveSpecs = async () => {
    try {
      // Send null instead of '' for numeric/date fields so Postgres doesn't
      // reject the update with "invalid input syntax for type numeric".
      const NUMERIC = new Set(['broken_pct_target']);
      const DATE = new Set(['production_date', 'expiry_date']);
      const payload = Object.fromEntries(
        Object.entries(specs).map(([k, v]) => {
          if (typeof v === 'string' && v.trim() === '' && (NUMERIC.has(k) || DATE.has(k))) {
            return [k, null];
          }
          return [k, v];
        })
      );
      await updateOrderMut.mutateAsync({ id: orderId, data: payload });
      addToast('Document specs updated');
      setEditing(false);
    } catch (err) {
      addToast(err.message || 'Failed to update specs', 'error');
    }
  };

  const startContractEditing = () => {
    setContract({
      qty_mt: order.qtyMT || '',
      price_per_mt: order.pricePerMT || '',
      currency: order.currency || 'USD',
      incoterm: order.incoterm || 'FOB',
      advance_pct: order.advancePct ?? '',
      destination_port: order.destinationPort || '',
      shipment_eta: order.shipmentETA || '',
      doc_address_mode: order.docAddressMode || 'country',
    });
    setContractEditing(true);
  };

  const saveContract = async () => {
    // Always-editable soft fields
    const payload = {
      currency: contract.currency,
      incoterm: contract.incoterm,
      advance_pct: parseFloat(contract.advance_pct) || 0,
      destination_port: contract.destination_port || null,
      shipment_eta: contract.shipment_eta || null,
      doc_address_mode: contract.doc_address_mode || 'country',
    };
    // Only send qty/price when they're actually editable, so the server's
    // recompute path doesn't fire for an order that's locked them out.
    if (qtyPriceEditable) {
      payload.qty_mt = parseFloat(contract.qty_mt) || 0;
      payload.price_per_mt = parseFloat(contract.price_per_mt) || 0;
      if (payload.qty_mt <= 0 || payload.price_per_mt <= 0) {
        addToast('Quantity and price must be positive', 'error');
        return;
      }
    }
    if (payload.advance_pct < 0 || payload.advance_pct > 100) {
      addToast('Advance % must be between 0 and 100', 'error');
      return;
    }
    try {
      await updateOrderMut.mutateAsync({ id: orderId, data: payload });
      addToast('Order updated');
      setContractEditing(false);
    } catch (err) {
      addToast(err.message || 'Failed to update order', 'error');
    }
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Contract Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Contract Summary</h3>
          {!contractEditing ? (
            <button
              onClick={startContractEditing}
              disabled={!contractEditable}
              title={contractEditable
                ? (qtyPriceEditable
                    ? 'Edit any P.I. field'
                    : 'Edit incoterm / port / ETA / advance — qty & price are locked once milling has started')
                : `Fully locked: order is ${order.status}`}
              className={`text-xs font-medium flex items-center gap-1 ${contractEditable ? 'text-blue-600 hover:text-blue-700' : 'text-gray-400 cursor-not-allowed'}`}
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setContractEditing(false)} className="text-gray-500 hover:text-gray-700 text-xs font-medium flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
              <button onClick={saveContract} disabled={updateOrderMut.isPending} className="text-white bg-blue-600 hover:bg-blue-700 text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg"><Save className="w-3.5 h-3.5" /> Save</button>
            </div>
          )}
        </div>
        {!contractEditing ? (
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium text-gray-900"><PartyLink type="customer" id={order.customerId} name={order.customerName} /></span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Product</span>
              <span className="font-medium text-gray-900">{order.productName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Quantity</span>
              <span className="font-medium text-gray-900">{order.qtyMT} MT</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Price per MT</span>
              <span className="font-medium text-gray-900">{formatCurrency(order.pricePerMT)} {order.currency}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Advance %</span>
              <span className="font-medium text-gray-900">{order.advancePct ?? 0}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Incoterm</span>
              <span className="font-medium text-gray-900">{order.incoterm}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Destination Port</span>
              <span className="font-medium text-gray-900">{order.destinationPort || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Buyer on Docs</span>
              <span className="font-medium text-gray-900">{order.docAddressMode === 'full' ? 'Full address + country' : 'Country only'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created</span>
              <span className="font-medium text-gray-900">{order.createdAt}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Shipment ETA</span>
              <span className="font-medium text-gray-900">{order.shipmentETA || '\u2014'}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Quantity (MT)
                  {!qtyPriceEditable && <span className="ml-1 text-amber-600 text-[10px]">(locked — past Procurement)</span>}
                </label>
                <input type="number" min="0" step="0.01" value={contract.qty_mt} disabled={!qtyPriceEditable} onChange={e => setContract(c => ({ ...c, qty_mt: e.target.value }))} className={`w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${!qtyPriceEditable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Price per MT
                  {!qtyPriceEditable && <span className="ml-1 text-amber-600 text-[10px]">(locked)</span>}
                </label>
                <input type="number" min="0" step="0.01" value={contract.price_per_mt} disabled={!qtyPriceEditable} onChange={e => setContract(c => ({ ...c, price_per_mt: e.target.value }))} className={`w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${!qtyPriceEditable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                <select value={contract.currency} onChange={e => setContract(c => ({ ...c, currency: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Incoterm</label>
                <select value={contract.incoterm} onChange={e => setContract(c => ({ ...c, incoterm: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  {INCOTERMS.map(it => (
                    <option key={it.code} value={it.code}>{it.code} — {it.name}</option>
                  ))}
                </select>
                {contract.incoterm && (
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug">{incotermHint(contract.incoterm)}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Advance %</label>
                <input type="number" min="0" max="100" value={contract.advance_pct} onChange={e => setContract(c => ({ ...c, advance_pct: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Shipment ETA</label>
                <input type="date" value={contract.shipment_eta} onChange={e => setContract(c => ({ ...c, shipment_eta: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Destination Port</label>
                <input type="text" value={contract.destination_port} onChange={e => setContract(c => ({ ...c, destination_port: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Buyer Details on Documents</label>
                <select value={contract.doc_address_mode} onChange={e => setContract(c => ({ ...c, doc_address_mode: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="country">Country only</option>
                  <option value="full">Full address + country</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Contract value, advance and balance amounts are recalculated automatically on save.
            </p>
          </div>
        )}
      </div>

      {/* Payment Milestones */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Payment Milestones</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">Advance ({order.advancePct}%)</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                order.advanceReceived >= order.advanceExpected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {order.advanceReceived >= order.advanceExpected ? 'Received' : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Expected: {formatCurrency(order.advanceExpected)}</span>
              <span className="font-medium text-gray-900">Received: {formatCurrency(order.advanceReceived)}</span>
            </div>
            <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${order.advanceReceived >= order.advanceExpected ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, order.advanceExpected > 0 ? (order.advanceReceived / order.advanceExpected) * 100 : 0)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">Balance ({100 - order.advancePct}%)</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                order.balanceReceived >= order.balanceExpected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {order.balanceReceived >= order.balanceExpected ? 'Received' : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Expected: {formatCurrency(order.balanceExpected)}</span>
              <span className="font-medium text-gray-900">Received: {formatCurrency(order.balanceReceived)}</span>
            </div>
            <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${order.balanceReceived >= order.balanceExpected ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, order.balanceExpected > 0 ? (order.balanceReceived / order.balanceExpected) * 100 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Line Items (multi-product P.I.) */}
      {Array.isArray(order.items) && order.items.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Line Items ({order.items.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Brand</th>
                  <th className="py-2 pr-3">HS Code</th>
                  <th className="py-2 pr-3">Packing</th>
                  <th className="py-2 pr-3">Bag Type / Size</th>
                  <th className="py-2 pr-3 text-right">Qty (MT)</th>
                  <th className="py-2 pr-3 text-right">Rate / MT</th>
                  <th className="py-2 pl-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id || it.lineNo} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-500">{it.lineNo}</td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{it.productName || '—'}</td>
                    <td className="py-2 pr-3 text-gray-700">{it.bagBrand || order.bagBrand || '—'}</td>
                    <td className="py-2 pr-3 text-gray-700">{it.hsCode || '—'}</td>
                    <td className="py-2 pr-3 text-gray-700">{it.packing || '—'}</td>
                    {(() => {
                      const bagType = it.bagType || it.bag_type || order.bagType || order.bag_type;
                      const bagSize = it.bagSizeKg || it.bag_size_kg;
                      return (
                        <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                          {bagType && <span className="font-medium text-gray-900">{bagType}</span>}
                          {bagType && bagSize ? ' · ' : ''}
                          {bagSize ? `${bagSize} kg` : (!bagType ? '—' : '')}
                          {it.masterBagSizeKg ? <span className="text-amber-700"> · master {it.masterBagSizeKg} kg</span> : ''}
                        </td>
                      );
                    })()}
                    <td className="py-2 pr-3 text-right text-gray-900">{it.qtyMT.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                    <td className="py-2 pr-3 text-right text-gray-900">{formatCurrency(it.pricePerMT)}</td>
                    <td className="py-2 pl-3 text-right font-semibold text-gray-900">{formatCurrency(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={6} className="py-2 pr-3 text-right text-xs uppercase text-gray-500 font-semibold">Total</td>
                  <td className="py-2 pr-3 text-right font-bold text-gray-900">{order.qtyMT.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                  <td className="py-2 pr-3"></td>
                  <td className="py-2 pl-3 text-right font-bold text-gray-900">{formatCurrency(order.contractValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Document & Product Specs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Document & Product Specs</h3>
          {!editing ? (
            <button onClick={startEditing} className="text-blue-600 hover:text-blue-700 text-xs font-medium flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-700 text-xs font-medium flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
              <button onClick={saveSpecs} disabled={updateOrderMut.isPending} className="text-white bg-blue-600 hover:bg-blue-700 text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg"><Save className="w-3.5 h-3.5" /> Save</button>
            </div>
          )}
        </div>
        {!editing ? (
          <div className="space-y-3">
            {[
              ['Contract No', order.contractNumber || order.id],
              ['Invoice No', order.invoiceNumber || '\u2014'],
              // HS Code shown read-only here as a summary; edit per-line in the
              // Line Items card. Falls back to the order's legacy hs_code field
              // for single-product orders that pre-date the items table.
              ['HS Code', (order.items && order.items[0] && order.items[0].hsCode) || order.hsCode || '\u2014 set in Line Items'],
              ['Broken % Target', order.brokenPctTarget ? `${order.brokenPctTarget}%` : '\u2014'],
              ['Freight Terms', order.freightTerms || '\u2014'],
              ['Consignee Type', order.consigneeType === 'direct' ? 'Direct to Buyer' : 'To Order of Bank'],
              ['Production Date', order.productionDate || '\u2014'],
              ['Expiry Date', order.expiryDate || '\u2014'],
              ['Payment Terms', order.paymentTerms || `${order.advancePct || 0}% advance, balance against documents`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-900">{value}</span>
              </div>
            ))}
            {(order.qualityDescription || order.productionRemarks) && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {order.qualityDescription && (
                  <div><span className="text-xs text-gray-500 block mb-0.5">Quality Description</span><p className="text-sm text-gray-800">{order.qualityDescription}</p></div>
                )}
                {order.productionRemarks && (
                  <div><span className="text-xs text-gray-500 block mb-0.5">Production Remarks</span><p className="text-sm text-gray-800">{order.productionRemarks}</p></div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contract No</label>
                <input type="text" value={specs.contract_number} onChange={e => setSpecs(s => ({ ...s, contract_number: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice No</label>
                <input type="text" value={specs.invoice_number} onChange={e => setSpecs(s => ({ ...s, invoice_number: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Broken % Target</label>
                <input type="number" value={specs.broken_pct_target} onChange={e => setSpecs(s => ({ ...s, broken_pct_target: e.target.value }))} min="0" max="100" step="0.5" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Freight Terms</label>
                <select value={specs.freight_terms} onChange={e => setSpecs(s => ({ ...s, freight_terms: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="COLLECT">Collect</option><option value="PREPAID">Prepaid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Consignee Type</label>
                <select value={specs.consignee_type} onChange={e => setSpecs(s => ({ ...s, consignee_type: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="to_order_of_bank">To Order of Bank</option><option value="direct">Direct to Buyer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Production Date</label>
                <input type="date" value={specs.production_date} onChange={e => setSpecs(s => ({ ...s, production_date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                <input type="date" value={specs.expiry_date} onChange={e => setSpecs(s => ({ ...s, expiry_date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
              <input
                type="text"
                list="payment-terms-suggestions"
                value={specs.payment_terms}
                placeholder='e.g. "CAD" or "LC 60 Days" or "20% Advance / 80% Against BL"'
                onChange={e => setSpecs(s => ({ ...s, payment_terms: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <datalist id="payment-terms-suggestions">
                {PAYMENT_TERMS.map(t => <option key={t} value={t} />)}
              </datalist>
              <p className="text-[11px] text-gray-500 mt-1">Pick a standard term or type a custom one. Appears on Proforma Invoice and Bank docs.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quality Description</label>
              <textarea value={specs.quality_description} onChange={e => setSpecs(s => ({ ...s, quality_description: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Production Remarks</label>
              <textarea value={specs.production_remarks} onChange={e => setSpecs(s => ({ ...s, production_remarks: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
            </div>
          </div>
        )}
      </div>

      {/* Linked Milling Order */}
      {order.millingOrderId && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Linked Milling Order</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">{order.millingOrderId}</p>
              <p className="text-sm text-gray-500">Source: {order.source}</p>
            </div>
            <Link
              to={`/milling/${order.millingOrderId}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              View Milling Order
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Expected vs Actual Cost Snapshot */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Cost Snapshot (PKR)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left pb-2 font-semibold text-gray-600">Item</th>
              <th className="text-right pb-2 font-semibold text-gray-600">Expected</th>
              <th className="text-right pb-2 font-semibold text-gray-600">Actual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(() => {
              const est = {
                rice: Math.round(order.qtyMT / 0.75 * order.pricePerMT * 0.5),
                bags: order.qtyMT * 25,
                loading: order.qtyMT * 15,
                clearing: order.qtyMT * 12,
                freight: (order.incoterm === 'CIF' || order.incoterm === 'CNF') ? order.qtyMT * 65 : 0,
              };
              const estTotal = Object.values(est).reduce((s, v) => s + v, 0);
              return (
                <>
                  {exportCostCategories.map(cat => (
                    <tr key={cat.key}>
                      <td className="py-2 text-gray-600">{cat.label}</td>
                      <td className="py-2 text-right text-gray-900">{est[cat.key] != null ? formatCost(est[cat.key]) : '\u2014'}</td>
                      <td className="py-2 text-right text-gray-900">{formatCost(order.costs[cat.key] || 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-2 font-semibold text-gray-900">Total</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatCost(estTotal)}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatCost(totalCosts)}</td>
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
