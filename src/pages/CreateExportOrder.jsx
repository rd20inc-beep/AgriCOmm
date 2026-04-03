import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useCreateExportOrder } from '../api/queries';
import {
  Save, Send, DollarSign, Calculator, ArrowLeft, Package, Truck,
  User, ShoppingBag, ChevronRight, Plus, Trash2, Info,
} from 'lucide-react';
import { validateForm, required, positiveNonZero } from '../utils/validation';
import { toKg, fromKg, allEquivalents, UNITS } from '../utils/unitConversion';

const RECEIVING_MODES = [
  { value: 'bags', label: 'In Bags', desc: 'Standard packed bags', icon: ShoppingBag },
  { value: 'loose', label: 'Loose / Bulk', desc: 'Bulk without bags', icon: Truck },
  { value: 'mixed', label: 'Mixed Packing', desc: 'Multiple bag types or partial loose', icon: Package },
  { value: 'custom', label: 'Custom Packing', desc: 'Special requirements', icon: Info },
];

const EMPTY_PACKING_LINE = { bagType: '', bagQuality: '', fillWeightKg: '25', bagCount: '', bagPrinting: '', notes: '' };

export default function CreateExportOrder() {
  const { addToast, customersList: customers, productsList: products, exportCostCategories, bagTypesList } = useApp();
  const createOrderMut = useCreateExportOrder();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    // Section 1: Buyer
    customerId: '', country: '',
    // Section 2: Product
    productId: '',
    // Section 3: Quantity
    qtyMT: '', quantityUnit: 'ton', pricePerMT: '',
    // Section 4: Order terms
    currency: 'USD', incoterm: 'FOB', shipmentTargetDate: '', advancePct: 20, source: 'Internal Mill',
    // Section 5: Receiving mode (shown after qty entered)
    receivingMode: '',
    // Section 6: Bag spec (shown only when receiving mode needs it)
    bagType: '', bagQuality: '', bagSizeKg: '25', bagWeightGm: '', bagPrinting: '', bagColor: '', bagBrand: '',
    // Section 7: Notes
    notes: '', packingNotes: '',
  });

  // Mixed packing lines
  const [packingLines, setPackingLines] = useState([{ ...EMPTY_PACKING_LINE }]);

  const set = (k, v) => setForm(p => {
    const u = { ...p, [k]: v };
    if (k === 'customerId') {
      const c = customers.find(c => c.id === Number(v));
      u.country = c ? c.country : '';
    }
    return u;
  });

  // ─── Computed values ───
  const qtyMT = parseFloat(form.qtyMT) || 0;
  const totalKg = qtyMT * 1000;
  const pricePerMT = parseFloat(form.pricePerMT) || 0;
  const contractValue = qtyMT * pricePerMT;
  const equivalents = allEquivalents(totalKg, parseFloat(form.bagSizeKg) || 25);
  const showReceivingMode = qtyMT > 0;
  const needsBagWidget = form.receivingMode === 'bags' || form.receivingMode === 'mixed' || form.receivingMode === 'custom';
  const isMixed = form.receivingMode === 'mixed';

  // Mixed packing totals
  const mixedTotals = useMemo(() => {
    if (!isMixed) return { packedKg: 0, packedBags: 0, looseKg: 0 };
    const packedKg = packingLines.reduce((s, l) => s + (parseFloat(l.fillWeightKg) || 0) * (parseInt(l.bagCount) || 0), 0);
    const packedBags = packingLines.reduce((s, l) => s + (parseInt(l.bagCount) || 0), 0);
    return { packedKg, packedBags, looseKg: Math.max(0, totalKg - packedKg) };
  }, [isMixed, packingLines, totalKg]);

  // Single bag mode totals
  const singleBagCount = form.receivingMode === 'bags' && form.bagSizeKg
    ? Math.round(totalKg / (parseFloat(form.bagSizeKg) || 25))
    : 0;

  // ─── Costing ───
  const costing = useMemo(() => {
    const estimatedRawQty = qtyMT > 0 ? Math.round(qtyMT / 0.75) : 0;
    const bagsCost = form.receivingMode === 'loose' ? 0 : qtyMT * 25;
    const riceCost = estimatedRawQty * pricePerMT * 0.5;
    const loadingCost = qtyMT * 15;
    const clearingCost = qtyMT * 12;
    const freightCost = (form.incoterm === 'CIF' || form.incoterm === 'CNF') ? qtyMT * 65 : 0;
    const totalEstimatedCost = riceCost + bagsCost + loadingCost + clearingCost + freightCost;
    const estimatedGrossProfit = contractValue - totalEstimatedCost;
    const marginPct = contractValue > 0 ? ((estimatedGrossProfit / contractValue) * 100) : 0;
    return { estimatedRawQty, bagsCost, riceCost, loadingCost, clearingCost, freightCost, totalEstimatedCost, contractValue, estimatedGrossProfit, marginPct };
  }, [qtyMT, pricePerMT, form.incoterm, form.receivingMode, contractValue]);

  const fmtUSD = (v) => '$' + Math.round(v).toLocaleString();

  // ─── Validation ───
  const [formErrors, setFormErrors] = useState({});
  function validate(isDraft) {
    const rules = { customerId: [() => required(form.customerId, 'Customer')] };
    if (!isDraft) {
      rules.productId = [() => required(form.productId, 'Product')];
      rules.qtyMT = [() => required(form.qtyMT, 'Quantity'), () => positiveNonZero(form.qtyMT, 'Quantity')];
      rules.pricePerMT = [() => required(form.pricePerMT, 'Price'), () => positiveNonZero(form.pricePerMT, 'Price')];
    }
    const { valid, errors } = validateForm(form, rules);
    setFormErrors(errors);
    if (!valid) addToast('Please fix highlighted errors', 'error');
    return valid;
  }

  // ─── Build API payload ───
  function buildPayload(status) {
    const product = products.find(p => p.id === Number(form.productId));
    const advPct = parseFloat(form.advancePct) || 0;
    const advExpected = contractValue * (advPct / 100);

    const payload = {
      customer_id: Number(form.customerId),
      country: form.country,
      product_id: Number(form.productId),
      product_name: product?.name || '',
      qty_mt: qtyMT,
      price_per_mt: pricePerMT,
      currency: form.currency,
      contract_value: contractValue,
      incoterm: form.incoterm,
      advance_pct: advPct,
      advance_expected: advExpected,
      balance_expected: contractValue - advExpected,
      shipment_eta: form.shipmentTargetDate || null,
      source: form.source,
      notes: form.notes || null,
      status,
      // Receiving mode
      receiving_mode: form.receivingMode || null,
      quantity_unit: form.quantityUnit || null,
      quantity_input_value: qtyMT,
      packing_notes: form.packingNotes || null,
    };

    // Bag fields — only when receiving mode requires them
    if (needsBagWidget) {
      payload.bag_type = form.bagType || null;
      payload.bag_quality = form.bagQuality || null;
      payload.bag_size_kg = form.bagSizeKg ? parseFloat(form.bagSizeKg) : null;
      payload.bag_weight_gm = form.bagWeightGm ? parseFloat(form.bagWeightGm) : null;
      payload.bag_printing = form.bagPrinting || null;
      payload.bag_color = form.bagColor || null;
      payload.bag_brand = form.bagBrand || null;
      payload.total_bags = singleBagCount || null;
    }

    // Mixed packing lines
    if (isMixed && packingLines.length > 0) {
      payload.packing_lines = packingLines
        .filter(l => l.bagCount && l.fillWeightKg)
        .map(l => ({
          bag_type: l.bagType || null,
          bag_quality: l.bagQuality || null,
          fill_weight_kg: parseFloat(l.fillWeightKg),
          bag_count: parseInt(l.bagCount),
          bag_printing: l.bagPrinting || null,
          notes: l.notes || null,
        }));
      payload.total_bags = mixedTotals.packedBags;
      payload.total_loose_weight_kg = mixedTotals.looseKg > 0 ? mixedTotals.looseKg : null;
    }

    if (form.receivingMode === 'loose') {
      payload.total_loose_weight_kg = totalKg;
    }

    return payload;
  }

  // ─── Submit handlers ───
  async function handleSubmit(status) {
    if (!validate(status === 'Draft')) return;
    try {
      const res = await createOrderMut.mutateAsync(buildPayload(status));
      addToast(`Order ${res.data?.order?.order_no || ''} ${status === 'Draft' ? 'saved as draft' : 'created'}`, 'success');
      navigate(`/export/${res.data?.order?.order_no || res.data?.order?.id || ''}`);
    } catch (err) {
      addToast(err.message || 'Failed to create order', 'error');
    }
  }

  const isValid = form.customerId && form.productId && qtyMT > 0 && pricePerMT > 0;

  // ─── Packing line helpers ───
  function addPackingLine() { setPackingLines(prev => [...prev, { ...EMPTY_PACKING_LINE }]); }
  function removePackingLine(idx) { setPackingLines(prev => prev.filter((_, i) => i !== idx)); }
  function updatePackingLine(idx, field, value) {
    setPackingLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
        <h1 className="text-2xl font-bold text-gray-900">Create Export Order</h1>
      </div>

      {/* ═══ Section 1: Buyer + Order Basics ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><User className="w-4 h-4" /> Buyer & Order Basics</h2>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Customer *</label>
            <select value={form.customerId} onChange={e => set('customerId', e.target.value)} className="form-input">
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Destination Country</label>
            <input value={form.country} readOnly className="form-input bg-gray-50 text-gray-500" placeholder="Auto-filled" />
          </div>
          <div className="form-group">
            <label className="form-label">Product *</label>
            <select value={form.productId} onChange={e => set('productId', e.target.value)} className="form-input">
              <option value="">Select product...</option>
              {products.filter(p => !p.isByproduct).map(p => <option key={p.id} value={p.id}>{p.name}{p.grade ? ` (${p.grade})` : ''}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ═══ Section 2: Quantity & Pricing ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Calculator className="w-4 h-4" /> Quantity & Pricing</h2>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Quantity (MT) *</label>
            <input type="number" value={form.qtyMT} onChange={e => set('qtyMT', e.target.value)} className="form-input" placeholder="Metric tons" min="0" step="0.01" />
          </div>
          <div className="form-group">
            <label className="form-label">Price per MT ({form.currency}) *</label>
            <input type="number" value={form.pricePerMT} onChange={e => set('pricePerMT', e.target.value)} className="form-input" placeholder="Rate per MT" min="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Currency</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className="form-input">
              <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Incoterm</label>
            <select value={form.incoterm} onChange={e => set('incoterm', e.target.value)} className="form-input">
              <option value="FOB">FOB</option><option value="CIF">CIF</option><option value="CNF">CNF</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Advance %</label>
            <input type="number" value={form.advancePct} onChange={e => set('advancePct', e.target.value)} className="form-input" min="0" max="100" />
          </div>
          <div className="form-group">
            <label className="form-label">Shipment Date</label>
            <input type="date" value={form.shipmentTargetDate} onChange={e => set('shipmentTargetDate', e.target.value)} className="form-input" />
          </div>
        </div>

        {/* Weight equivalents helper */}
        {totalKg > 0 && (
          <div className="mt-4 bg-blue-50 rounded-xl border border-blue-200 p-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2">Quantity Equivalents</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><span className="text-blue-600">KG:</span> <span className="font-bold text-gray-900">{totalKg.toLocaleString()}</span></div>
              <div><span className="text-blue-600">Bags (25kg):</span> <span className="font-bold text-gray-900">{Math.round(totalKg / 25).toLocaleString()}</span></div>
              <div><span className="text-blue-600">Bags (50kg):</span> <span className="font-bold text-gray-900">{Math.round(totalKg / 50).toLocaleString()}</span></div>
              <div><span className="text-blue-600">MT:</span> <span className="font-bold text-gray-900">{qtyMT}</span></div>
            </div>
            {contractValue > 0 && (
              <p className="mt-2 text-sm font-semibold text-blue-800">Contract Value: {fmtUSD(contractValue)}</p>
            )}
          </div>
        )}
      </div>

      {/* ═══ Section 3: Buyer Receiving Preference (conditional) ═══ */}
      {showReceivingMode && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-4 h-4" /> How is the buyer receiving this order?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {RECEIVING_MODES.map(mode => {
              const Icon = mode.icon;
              const active = form.receivingMode === mode.value;
              return (
                <button key={mode.value} type="button" onClick={() => set('receivingMode', mode.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center ${
                    active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}>
                  <Icon className={`w-6 h-6 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className="text-sm font-semibold">{mode.label}</span>
                  <span className="text-xs text-gray-400">{mode.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Section 4: Bag Specification (conditional — only when bags/mixed/custom) ═══ */}
      {needsBagWidget && !isMixed && (
        <div className="bg-white rounded-xl border border-amber-200 p-6">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-4 flex items-center gap-2"><ShoppingBag className="w-4 h-4" /> Bag Specification</h2>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Bag Type</label>
              <select value={form.bagType} onChange={e => { set('bagType', e.target.value); const bt = bagTypesList.find(b => b.name === e.target.value); if (bt?.sizeKg) set('bagSizeKg', String(bt.sizeKg)); }} className="form-input">
                <option value="">Select bag type...</option>
                {bagTypesList.filter(b => b.sizeKg).map(b => <option key={b.id || b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Bag Quality</label>
              <select value={form.bagQuality} onChange={e => set('bagQuality', e.target.value)} className="form-input">
                <option value="">Select...</option>
                <option>New</option><option>A-Grade</option><option>Standard</option><option>Premium</option><option>Economy</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Bag Size (KG)</label>
              <select value={form.bagSizeKg} onChange={e => set('bagSizeKg', e.target.value)} className="form-input">
                <option value="5">5 KG</option><option value="10">10 KG</option><option value="25">25 KG</option><option value="50">50 KG</option><option value="100">100 KG</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Bag Printing</label>
              <select value={form.bagPrinting} onChange={e => set('bagPrinting', e.target.value)} className="form-input">
                <option value="">Select...</option>
                <option>Plain</option><option>Buyer Logo</option><option>Buyer Logo + Text</option><option>Custom Design</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Bag Color</label>
              <input value={form.bagColor} onChange={e => set('bagColor', e.target.value)} className="form-input" placeholder="e.g. White" />
            </div>
            <div className="form-group">
              <label className="form-label">Brand / Marking</label>
              <input value={form.bagBrand} onChange={e => set('bagBrand', e.target.value)} className="form-input" placeholder="Brand on bag" />
            </div>
          </div>

          {/* Bag count preview */}
          {singleBagCount > 0 && (
            <div className="mt-4 bg-amber-50 rounded-lg border border-amber-200 p-3 text-sm text-amber-800">
              <span className="font-semibold">Estimated: </span>
              {singleBagCount.toLocaleString()} bags x {form.bagSizeKg} KG = {totalKg.toLocaleString()} KG
              {form.bagType && ` | ${form.bagType}`}
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 4b: Mixed Packing Lines ═══ */}
      {isMixed && (
        <div className="bg-white rounded-xl border border-violet-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-violet-700 uppercase tracking-wider flex items-center gap-2"><Package className="w-4 h-4" /> Mixed Packing Lines</h2>
            <button onClick={addPackingLine} className="btn btn-sm btn-secondary"><Plus className="w-3.5 h-3.5" /> Add Line</button>
          </div>

          <div className="space-y-3">
            {packingLines.map((line, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-500">Line {idx + 1}</span>
                  {packingLines.length > 1 && (
                    <button onClick={() => removePackingLine(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="form-group">
                    <label className="form-label text-xs">Bag Type</label>
                    <select value={line.bagType} onChange={e => updatePackingLine(idx, 'bagType', e.target.value)} className="form-input text-sm py-1.5">
                      <option value="">Select...</option>
                      {bagTypesList.filter(b => b.sizeKg).map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label text-xs">Fill Weight (KG)</label>
                    <input type="number" value={line.fillWeightKg} onChange={e => updatePackingLine(idx, 'fillWeightKg', e.target.value)} className="form-input text-sm py-1.5" />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-xs">Bag Count</label>
                    <input type="number" value={line.bagCount} onChange={e => updatePackingLine(idx, 'bagCount', e.target.value)} className="form-input text-sm py-1.5" />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-xs">Line Total</label>
                    <div className="form-input bg-gray-100 text-sm py-1.5 text-gray-700 font-medium">
                      {((parseFloat(line.fillWeightKg) || 0) * (parseInt(line.bagCount) || 0)).toLocaleString()} KG
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Mixed packing totals */}
          <div className="mt-4 bg-violet-50 rounded-lg border border-violet-200 p-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><span className="text-violet-600 text-xs font-medium">Packed:</span> <span className="font-bold text-gray-900">{mixedTotals.packedKg.toLocaleString()} KG ({mixedTotals.packedBags} bags)</span></div>
              <div><span className="text-violet-600 text-xs font-medium">Loose:</span> <span className="font-bold text-gray-900">{mixedTotals.looseKg.toLocaleString()} KG</span></div>
              <div><span className="text-violet-600 text-xs font-medium">Order Total:</span> <span className={`font-bold ${Math.abs(mixedTotals.packedKg + mixedTotals.looseKg - totalKg) < 1 ? 'text-emerald-600' : 'text-red-600'}`}>{totalKg.toLocaleString()} KG</span></div>
            </div>
            {mixedTotals.packedKg > totalKg + 1 && (
              <p className="mt-2 text-xs text-red-600 font-medium">Packed weight exceeds order quantity!</p>
            )}
          </div>
        </div>
      )}

      {/* ═══ Section 5: Notes ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="form-grid">
          <div className="form-group sm:col-span-2 lg:col-span-3">
            <label className="form-label">Order Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="form-input resize-none" rows={2} placeholder="General order notes..." />
          </div>
          {needsBagWidget && (
            <div className="form-group sm:col-span-2 lg:col-span-3">
              <label className="form-label">Packing Instructions</label>
              <textarea value={form.packingNotes} onChange={e => set('packingNotes', e.target.value)} className="form-input resize-none" rows={2} placeholder="Special packing instructions, labeling, marking requirements..." />
            </div>
          )}
        </div>
      </div>

      {/* ═══ Section 6: Costing Preview ═══ */}
      {qtyMT > 0 && pricePerMT > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Costing Preview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              {[
                ['Estimated Raw Qty', `${costing.estimatedRawQty} MT`],
                ['Rice Cost', fmtUSD(costing.riceCost)],
                ...(form.receivingMode !== 'loose' ? [['Bags Cost', fmtUSD(costing.bagsCost)]] : []),
                ['Loading', fmtUSD(costing.loadingCost)],
                ['Clearing', fmtUSD(costing.clearingCost)],
                ...(costing.freightCost > 0 ? [['Freight', fmtUSD(costing.freightCost)]] : []),
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between text-sm"><span className="text-gray-600">{l}</span><span className="font-medium">{v}</span></div>
              ))}
              <div className="border-t pt-2 flex justify-between text-sm font-semibold"><span>Total Est. Cost</span><span>{fmtUSD(costing.totalEstimatedCost)}</span></div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-600">Contract Value</span><span className="font-medium">{fmtUSD(contractValue)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Est. Cost</span><span className="font-medium">{fmtUSD(costing.totalEstimatedCost)}</span></div>
              <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                <span>Gross Profit</span>
                <span className={costing.estimatedGrossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtUSD(costing.estimatedGrossProfit)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span>Margin</span>
                <span className={costing.marginPct >= 15 ? 'text-emerald-600' : costing.marginPct >= 5 ? 'text-amber-600' : 'text-red-600'}>{costing.marginPct.toFixed(1)}%</span>
              </div>
              <div className={`mt-2 p-2.5 rounded-lg text-xs font-medium ${costing.marginPct >= 15 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : costing.marginPct >= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {costing.marginPct >= 15 ? 'Healthy margin' : costing.marginPct >= 5 ? 'Low margin — review costs' : 'Negative/very low margin — reconsider pricing'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Submit Buttons ═══ */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button onClick={() => handleSubmit('Draft')} className="btn btn-secondary mobile-full-btn"><Save className="w-4 h-4" /> Save Draft</button>
        <button onClick={() => handleSubmit('Awaiting Advance')} disabled={!isValid} className="btn btn-primary mobile-full-btn disabled:opacity-50"><Send className="w-4 h-4" /> Create Order</button>
        <button onClick={() => handleSubmit('Awaiting Advance')} disabled={!isValid} className="btn mobile-full-btn disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600"><DollarSign className="w-4 h-4" /> Create & Request Advance</button>
      </div>
    </div>
  );
}
