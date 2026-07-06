import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../../context/AppContext';
import { useCreateExportOrder } from '../../../api/queries';
import api from '../../../api/client';
import {
  Save, Send, DollarSign, Calculator, ArrowLeft, Package, Truck,
  User, ShoppingBag, ChevronRight, ChevronDown, ChevronLeft, Plus, Trash2, Info, FileText, Check, Edit3,
} from 'lucide-react';
import { validateForm, required, positiveNonZero } from '../../../utils/validation';
import { toKg, fromKg, allEquivalents, UNITS } from '../../../utils/unitConversion';
import SearchSelect from '../../../components/SearchSelect';
import RiceTypePicker from '../../../components/RiceTypePicker';
import BagTypePicker from '../../../components/BagTypePicker';
import SupplierPicker from '../../../components/SupplierPicker';
import SlideDrawer from '../../../components/SlideDrawer';
import { printedBagsApi, exportOrdersApi } from '../api/services';
import { INCOTERMS, incotermHint, advancePctForIncoterm } from '../../../shared/constants/incoterms';
import { PAYMENT_TERMS } from '../../../shared/constants/paymentTerms';
import { COUNTRY_OPTIONS } from '../../../shared/constants/countries';
import { PORTS } from '../../../shared/constants/ports';

const RECEIVING_MODES = [
  { value: 'bags', label: 'In Bags', desc: 'Standard packed bags', icon: ShoppingBag },
  { value: 'loose', label: 'Loose / Bulk', desc: 'Bulk without bags', icon: Truck },
  { value: 'mixed', label: 'Mixed Packing', desc: 'Multiple bag types or partial loose', icon: Package },
  { value: 'custom', label: 'Custom Packing', desc: 'Special requirements', icon: Info },
];

const EMPTY_PACKING_LINE = { bagType: '', bagQuality: '', fillWeightKg: '25', bagCount: '', bagPrinting: '', notes: '' };

const EMPTY_ITEM = {
  productId: '', productName: '',
  qtyMT: '', pricePerMT: '',
  hsCode: '', packing: '',
  // Packing / bag type / bag size are captured on the next step ("how the buyer
  // receives this order") — left blank here so the per-item payload sends null.
  bagType: '',
  bagSizeKg: '', bagCount: '',
  masterBagSizeKg: '',
  bagBrand: '',
};

// Batch 7 — packing type + material options.
const PACKING_TYPES = [
  { value: 'retail', label: 'Retail Bag', desc: '0.5–50 KG bags' },
  { value: 'jumbo', label: 'Jumbo FIBC', desc: '1,200 KG bulk bag' },
  { value: 'container', label: 'Container Bulk', desc: 'Loose, max 25,000 KG' },
];
const BAG_MATERIALS = ['Polythene', 'Woven', 'Non-Woven', 'Cotton'];

// Retail bag sizes that need to be packed inside an outer "master bag"
// (carton / sack) for shipping. Larger bags ship as-is.
const RETAIL_BAG_SIZES_KG = [0.5, 1, 2, 5, 10];
const MASTER_BAG_SIZES_KG = [10, 20, 40];
const requiresMasterBag = (sizeKg) => {
  const v = parseFloat(sizeKg);
  return RETAIL_BAG_SIZES_KG.includes(v);
};
// Master bag must hold at least one whole retail bag (e.g. a 2kg retail bag
// fits a 10/20/40kg master; a 5kg fits 10/20/40 but a 10kg retail needs ≥20).
const masterOptionsFor = (retailKg) => {
  const r = parseFloat(retailKg) || 0;
  return MASTER_BAG_SIZES_KG.filter((m) => r > 0 && m >= r && m % r === 0);
};

export default function CreateExportOrder() {
  const { addToast, customersList: customers, productsList: products, exportCostCategories, bagTypesList, suppliersList } = useApp();
  const createOrderMut = useCreateExportOrder();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Pre-fill from duplicate
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('dup') === '1') {
      const fields = ['customerId', 'productId', 'country', 'currency', 'incoterm', 'consigneeType', 'qualityDescription'];
      const updates = {};
      fields.forEach(f => { const v = searchParams.get(f); if (v) updates[f] = v; });
      if (Object.keys(updates).length > 0) setForm(prev => ({ ...prev, ...updates }));
    }
  }, []);

  // Quick-add customer
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', country: '', port: '', address: '', email: '', phone: '', contact_person: '' });

  const [form, setForm] = useState({
    // Section 1: Buyer
    customerId: '', country: '',
    // Section 2: Product
    productId: '',
    // Section 3: Quantity
    qtyMT: '', quantityUnit: 'ton', pricePerMT: '',
    // Section 4: Order terms
    currency: 'USD', incoterm: 'FOB', advancePct: 20, source: 'Internal Mill',
    paymentTerms: 'CAD', docAddressMode: 'country',
    // Section 5: Receiving mode (shown after qty entered)
    receivingMode: '',
    // Section 6: Bag spec (shown only when receiving mode needs it)
    bagType: '', bagQuality: '', bagSizeKg: '25', bagWeightGm: '', bagPrinting: '', bagColor: '', bagBrand: '',
    masterBagSizeKg: '', masterBagType: '',
    // Batch 7: structured packing spec + palletization
    packingType: 'retail', bagMaterial: '', palletized: false, palletCost: '',
    // Section 7: Contract & Product Specs (for document generation)
    // HS Code is per-item now (in the Line Items section); no order-level field.
    contractNumber: '', consigneeType: 'to_order_of_bank', brokenPctTarget: '',
    qualityDescription: '', shipmentWindowStart: '', shipmentWindowEnd: '',
    // Section 8: Notes
    notes: '', packingNotes: '',
  });

  // Mixed packing lines
  const [packingLines, setPackingLines] = useState([{ ...EMPTY_PACKING_LINE }]);
  const [specsOpen, setSpecsOpen] = useState(false);

  // Optional printed-bag orders arranged at creation. Each becomes a vendor
  // payable on the new order (posted after the order is created).
  const [printedBags, setPrintedBags] = useState([]);
  const addPrintedBag = () => setPrintedBags(prev => [...prev, { bagType: '', bagTypeId: null, bagSizeKg: '', vendorId: '', quantity: '', unitCost: '', printing: '', brand: '' }]);
  const removePrintedBag = (idx) => setPrintedBags(prev => prev.filter((_, i) => i !== idx));
  const updatePrintedBag = (idx, patch) => setPrintedBags(prev => prev.map((b, i) => i === idx ? { ...b, ...patch } : b));

  // Multi-line P.I. items — one or more products per order
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  const updateItem = (idx, field, value) => setItems(prev => prev.map((it, i) => {
    if (i !== idx) return it;
    const next = { ...it, [field]: value };
    if (field === 'productId') {
      const p = products.find(pp => pp.id === Number(value));
      if (p) next.productName = p.name;
    }
    return next;
  }));

  const set = (k, v) => setForm(p => {
    const u = { ...p, [k]: v };
    if (k === 'customerId') {
      const c = customers.find(c => c.id === Number(v));
      u.country = c ? c.country : '';
    }
    return u;
  });

  // ─── Computed values (derived from line items) ───
  const itemQtyMT = (it) => parseFloat(it.qtyMT) || 0;
  const itemPrice = (it) => parseFloat(it.pricePerMT) || 0;
  const itemTotal = (it) => itemQtyMT(it) * itemPrice(it);
  const qtyMT = items.reduce((s, it) => s + itemQtyMT(it), 0);
  const totalKg = qtyMT * 1000;
  const contractValue = items.reduce((s, it) => s + itemTotal(it), 0);
  const pricePerMT = qtyMT > 0 ? contractValue / qtyMT : 0;
  const equivalents = allEquivalents(totalKg, parseFloat(form.bagSizeKg) || 25);
  const showReceivingMode = qtyMT > 0;
  const isMultiItem = items.length > 1;
  const needsBagWidget = form.receivingMode === 'bags' || form.receivingMode === 'mixed' || form.receivingMode === 'custom';
  const isMixed = form.receivingMode === 'mixed';
  // Batch 7 — container-capacity rule (mirrors the backend guard). Palletized load
  // caps at 20 pallets × 1,000 = 20,000 KG; a bulk/loose container caps at 25,000 KG.
  const capacityWarning = form.palletized && totalKg > 20000
    ? 'Palletized load capped at 20,000 KG (20 pallets × 1,000 KG). Reduce the quantity or ship without pallets.'
    : totalKg > 25000
      ? 'Container load capped at 25,000 KG. Split into multiple orders/containers.'
      : '';

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
    // Advance / balance split — driven by the (incoterm-derived) advance %.
    const advPct = parseFloat(form.advancePct) || 0;
    const advanceExpected = contractValue * (advPct / 100);
    const balanceExpected = contractValue - advanceExpected;
    return { estimatedRawQty, bagsCost, riceCost, loadingCost, clearingCost, freightCost, totalEstimatedCost, contractValue, estimatedGrossProfit, marginPct, advPct, advanceExpected, balanceExpected };
  }, [qtyMT, pricePerMT, form.incoterm, form.receivingMode, form.advancePct, contractValue]);

  const fmtUSD = (v) => '$' + Math.round(v).toLocaleString();

  // ─── Wizard step ───
  // 1 = Buyer & Items, 2 = Terms & Packing, 3 = Specs & Review
  const [step, setStep] = useState(1);

  // ─── Validation ───
  const [formErrors, setFormErrors] = useState({});
  function validate(isDraft) {
    const rules = { customerId: [() => required(form.customerId, 'Customer')] };
    const { valid, errors } = validateForm(form, rules);
    setFormErrors(errors);

    if (!isDraft) {
      const itemsValid = items.length > 0 && items.every(it =>
        it.productId && itemQtyMT(it) > 0 && itemPrice(it) > 0
      );
      if (!itemsValid) {
        addToast('Each line item needs a product, quantity, and price', 'error');
        return false;
      }
      // Master bag is mandatory for retail-sized bags.
      const missingMaster = items.find(it => requiresMasterBag(it.bagSizeKg) && !it.masterBagSizeKg);
      if (missingMaster) {
        addToast(`Line ${items.indexOf(missingMaster) + 1}: select a master bag size for retail bags`, 'error');
        return false;
      }
      if (needsBagWidget && form.packingType === 'retail' && requiresMasterBag(form.bagSizeKg) && !form.masterBagSizeKg) {
        addToast('Select a master bag size for retail bags', 'error');
        return false;
      }
      // Batch 7 — enforce the container-capacity rule (mirrors the backend guard).
      if (capacityWarning) {
        addToast(capacityWarning, 'error');
        return false;
      }
    }
    if (!valid) addToast('Please fix highlighted errors', 'error');
    return valid;
  }

  // ─── Build API payload ───
  function buildPayload(status) {
    const advPct = parseFloat(form.advancePct) || 0;
    const advExpected = contractValue * (advPct / 100);
    const head = items[0] || {};
    const headProduct = products.find(p => p.id === Number(head.productId));

    const payload = {
      customer_id: Number(form.customerId),
      country: form.country,
      // Legacy/summary fields — kept in sync with the first line for code paths
      // that still read order-level product/qty/price (milling, document renderers).
      product_id: Number(head.productId) || null,
      product_name: headProduct?.name || head.productName || '',
      qty_mt: qtyMT,
      price_per_mt: pricePerMT,
      currency: form.currency,
      contract_value: contractValue,
      incoterm: form.incoterm,
      doc_address_mode: form.docAddressMode || 'country',
      advance_pct: advPct,
      advance_expected: advExpected,
      balance_expected: contractValue - advExpected,
      payment_terms: form.paymentTerms || null,
      shipment_eta: form.shipmentWindowEnd || form.shipmentWindowStart || null,
      source: form.source,
      notes: form.notes || null,
      status,
      // Multi-line items — backend persists these to export_order_items.
      items: items.map(it => {
        const p = products.find(pp => pp.id === Number(it.productId));
        return {
          product_id: Number(it.productId) || null,
          product_name: p?.name || it.productName || '',
          qty_mt: itemQtyMT(it),
          price_per_mt: itemPrice(it),
          hs_code: it.hsCode || null,
          packing: it.packing || null,
          bag_type: it.bagType || form.bagType || null,
          bag_size_kg: it.bagSizeKg ? parseFloat(it.bagSizeKg) : null,
          bag_count: it.bagCount ? parseInt(it.bagCount) : null,
          master_bag_size_kg: it.masterBagSizeKg ? parseFloat(it.masterBagSizeKg) : null,
          bag_brand: it.bagBrand || null,
        };
      }),
      // Contract & product specs (HS code mirrors first item for legacy renderers)
      // HS code is per-item; the order-level value is set from the first line
      // for backwards compat with legacy renderers / single-line readers.
      hs_code: head.hsCode || null,
      contract_number: form.contractNumber || null,
      consignee_type: form.consigneeType || null,
      broken_pct_target: form.brokenPctTarget ? parseFloat(form.brokenPctTarget) : null,
      quality_description: form.qualityDescription || null,
      shipment_window_start: form.shipmentWindowStart || null,
      shipment_window_end: form.shipmentWindowEnd || null,
      // Receiving mode
      receiving_mode: form.receivingMode || null,
      quantity_unit: form.quantityUnit || null,
      quantity_input_value: qtyMT,
      packing_notes: form.packingNotes || null,
      // Batch 7 — structured packing spec
      packing_type: form.packingType || 'retail',
      bag_material: form.packingType === 'container' ? null : (form.bagMaterial || null),
      palletized: form.packingType === 'container' ? false : !!form.palletized,
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
      payload.master_bag_size_kg = form.masterBagSizeKg ? parseFloat(form.masterBagSizeKg) : null;
      // Retail bags packed per master bag (e.g. 20kg master ÷ 2kg retail = 10).
      payload.units_per_bag = (requiresMasterBag(form.bagSizeKg) && form.masterBagSizeKg && form.bagSizeKg)
        ? Math.floor(parseFloat(form.masterBagSizeKg) / (parseFloat(form.bagSizeKg) || 1)) : null;
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
      const newOrderId = res.data?.order?.id;
      // Arrange any printed-bag orders captured during creation against the new order.
      const validBags = printedBags.filter(b => (parseInt(b.quantity, 10) || 0) > 0);
      if (newOrderId && validBags.length) {
        try {
          for (const b of validBags) {
            await printedBagsApi.create({
              order_id: newOrderId,
              bag_type_id: b.bagTypeId || null,
              bag_type_name: b.bagType || null,
              bag_size_kg: b.bagSizeKg || null,
              vendor_id: b.vendorId || null,
              quantity: parseInt(b.quantity, 10),
              unit_cost: parseFloat(b.unitCost) || 0,
              printing: b.printing || null,
              brand_marking: b.brand || null,
            });
          }
          addToast(`${validBags.length} printed-bag order(s) arranged`, 'success');
        } catch (bagErr) {
          addToast(`Order created, but a printed-bag order failed: ${bagErr.message}`, 'error');
        }
      }
      // Batch 7 — record the pallet cost as a 'pallet' cost line (GL + payable via addCost).
      const palletCost = parseFloat(form.palletCost) || 0;
      if (newOrderId && form.palletized && palletCost > 0) {
        try {
          await exportOrdersApi.addCost(newOrderId, { category: 'pallet', amount: palletCost, notes: 'Pallet cost' });
        } catch (pErr) {
          addToast(`Order created, but the pallet cost failed to post: ${pErr.message}`, 'error');
        }
      }
      addToast(`Order ${res.data?.order?.order_no || ''} ${status === 'Draft' ? 'saved as draft' : 'created'}`, 'success');
      navigate(`/export/${res.data?.order?.order_no || res.data?.order?.id || ''}`);
    } catch (err) {
      addToast(err.message || 'Failed to create order', 'error');
    }
  }

  const itemsAllFilled = items.length > 0 && items.every(it =>
    it.productId && itemQtyMT(it) > 0 && itemPrice(it) > 0
  );
  const isValid = !!form.customerId && itemsAllFilled;

  // ─── Packing line helpers ───
  function addPackingLine() { setPackingLines(prev => [...prev, { ...EMPTY_PACKING_LINE }]); }
  function removePackingLine(idx) { setPackingLines(prev => prev.filter((_, i) => i !== idx)); }
  function updatePackingLine(idx, field, value) {
    setPackingLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  // Per-step validation
  const step1Valid = !!form.customerId && items.length > 0 && items.every(it => it.productId && itemQtyMT(it) > 0 && itemPrice(it) > 0);
  const step2Valid = !!form.receivingMode;
  const canNext = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  function tryNext() {
    if (step === 1 && !step1Valid) { addToast('Pick a customer and add at least one item with qty + price', 'error'); return; }
    if (step === 2 && !step2Valid) { addToast('Choose a receiving mode', 'error'); return; }
    setStep(s => Math.min(3, s + 1));
  }

  const STEPS = [
    { n: 1, label: 'Buyer & Items' },
    { n: 2, label: 'Terms & Packing' },
    { n: 3, label: 'Specs & Review' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header + Step indicator */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
        <h1 className="text-2xl font-bold text-gray-900">Create Export Order</h1>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          {STEPS.map((s, idx) => {
            const isActive = step === s.n;
            const isDone = step > s.n;
            return (
              <div key={s.n} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => setStep(s.n)}
                  className="flex flex-col items-center group"
                >
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all ${
                    isActive ? 'bg-gray-900 text-white' :
                    isDone ? 'bg-emerald-600 text-white' :
                    'bg-white border border-gray-200 text-gray-400 group-hover:border-gray-400'
                  }`}>
                    {isDone ? <Check size={13} /> : s.n}
                  </span>
                  <span className={`mt-1.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${
                    isActive ? 'text-gray-900' : isDone ? 'text-emerald-600' : 'text-gray-400'
                  }`}>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-2 -mt-4 transition-colors ${step > s.n ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {step === 1 && <>
      {/* ═══ Section 1: Buyer + Order Basics ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><User className="w-4 h-4" /> Buyer & Order Basics</h2>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label flex items-center justify-between">
              <span>Customer *</span>
              <span className="flex items-center gap-3">
                {form.customerId && (
                  <button type="button"
                    onClick={() => {
                      const c = customers.find(x => String(x.id) === String(form.customerId));
                      if (!c) return;
                      setNewCust({ id: c.id, name: c.name || '', country: c.country || '', port: c.port || '', address: c.address || '', email: c.email || '', phone: c.phone || '', contact_person: c.contact || '' });
                      setShowAddCustomer(true);
                    }}
                    className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> Edit Buyer
                  </button>
                )}
                <button type="button"
                  onClick={() => { setNewCust({ name: '', country: '', port: '', address: '', email: '', phone: '', contact_person: '' }); setShowAddCustomer(true); }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> New Buyer
                </button>
              </span>
            </label>
            <SearchSelect
              value={form.customerId}
              onChange={val => set('customerId', val)}
              options={customers.filter(c => (c.customerType || 'export') === 'export').map(c => ({ value: c.id, label: c.name, sub: c.country }))}
              placeholder="Type to search buyer..."
            />
          </div>
          <div className="form-group">
            <label className="form-label">Destination Country</label>
            <input value={form.country} readOnly className="form-input bg-gray-50 text-gray-500" placeholder="Auto-filled" />
          </div>
        </div>
      </div>

      {/* ═══ Section 2: Line Items (multi-product P.I.) ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2"><Package className="w-4 h-4" /> Line Items</h2>
          <button type="button" onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
        <div className="space-y-4">
          {items.map((it, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Item {idx + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)} className="text-red-600 hover:text-red-800 text-xs flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Product *</label>
                  <RiceTypePicker
                    value={it.productId}
                    onChange={val => updateItem(idx, 'productId', val)}
                    products={products}
                    addToast={addToast}
                    placeholder="Search product or add a new one…"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Qty (MT) *</label>
                  <input type="number" min="0" step="0.01" value={it.qtyMT} onChange={e => updateItem(idx, 'qtyMT', e.target.value)} className="form-input" placeholder="MT" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Rate / MT *</label>
                  <input type="number" min="0" step="0.01" value={it.pricePerMT} onChange={e => updateItem(idx, 'pricePerMT', e.target.value)} className="form-input" placeholder={form.currency} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">HS Code</label>
                  <input type="text" value={it.hsCode} onChange={e => updateItem(idx, 'hsCode', e.target.value)} className="form-input" placeholder="e.g. 1006.3010" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Line Total ({form.currency})</label>
                  <div className="form-input bg-white text-right font-semibold text-gray-900">
                    {itemTotal(it).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              {/* Packing, bag size & brand/marking are set on the next step — "how the buyer receives this order". */}
            </div>
          ))}
        </div>
        {isMultiItem && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between text-sm">
            <span className="text-blue-700 font-semibold">Order total ({items.length} items)</span>
            <span className="text-blue-900 font-bold">{qtyMT.toLocaleString()} MT · {form.currency} {contractValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
        )}
      </div>
      </>}

      {step === 2 && <>
      {/* ═══ Section 2b: Order Terms ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Calculator className="w-4 h-4" /> Order Terms</h2>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Currency</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className="form-input">
              <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Incoterm</label>
            <select value={form.incoterm}
              onChange={e => { const v = e.target.value; set('incoterm', v); set('advancePct', advancePctForIncoterm(v)); }}
              className="form-input">
              {INCOTERMS.map(it => (
                <option key={it.code} value={it.code}>{it.code} — {it.name}</option>
              ))}
            </select>
            {form.incoterm && (
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">{incotermHint(form.incoterm)}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Advance %</label>
            <input type="number" value={form.advancePct} onChange={e => set('advancePct', e.target.value)} className="form-input" min="0" max="100" />
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">Auto-set from {form.incoterm || 'incoterm'} ({advancePctForIncoterm(form.incoterm)}%) — edit if the buyer agreed otherwise.</p>
          </div>
          <div className="form-group">
            <label className="form-label">Payment Terms</label>
            <select value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} className="form-input">
              <option value="">Select…</option>
              {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Buyer Details on Documents</label>
            <select value={form.docAddressMode} onChange={e => set('docAddressMode', e.target.value)} className="form-input">
              <option value="country">Country only</option>
              <option value="port">Port only</option>
              <option value="country_port">Country + port</option>
              <option value="full">Full address + country</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">Controls which buyer location lines print on the proforma &amp; export docs.</p>
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

      {/* ═══ Section 4: Bag Specification — single-item only (multi-item uses the
            per-item spec below, so the two never both show) ═══ */}
      {needsBagWidget && !isMixed && !isMultiItem && (
        <div className="bg-white rounded-xl border border-amber-200 p-6">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-4 flex items-center gap-2"><ShoppingBag className="w-4 h-4" /> Bag Specification</h2>

          {/* Batch 7: Packing type — drives sizes, material and pallet rules */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {PACKING_TYPES.map(pt => {
              const active = form.packingType === pt.value;
              return (
                <button key={pt.value} type="button"
                  onClick={() => {
                    set('packingType', pt.value);
                    if (pt.value === 'jumbo') { set('bagSizeKg', '1200'); set('masterBagSizeKg', ''); }
                    else if (pt.value === 'container') { set('bagSizeKg', ''); set('masterBagSizeKg', ''); set('palletized', false); }
                    else if (!form.bagSizeKg || form.bagSizeKg === '1200') { set('bagSizeKg', '25'); }
                  }}
                  className={`text-left rounded-lg border p-3 transition ${active ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-400' : 'border-gray-200 hover:border-amber-300'}`}>
                  <div className="text-sm font-semibold text-gray-800">{pt.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{pt.desc}</div>
                </button>
              );
            })}
          </div>

          <div className="form-grid">
            <div className="form-group">
              <BagTypePicker
                label="Bag Type"
                value={form.bagType}
                bagTypes={bagTypesList}
                addToast={addToast}
                onCreated={() => qc.invalidateQueries({ queryKey: ['bag-types'] })}
                onChange={(name, bt) => { set('bagType', name); if (bt?.sizeKg || bt?.size_kg) set('bagSizeKg', String(bt.sizeKg ?? bt.size_kg)); }}
              />
            </div>
            {form.packingType !== 'container' && (
              <div className="form-group">
                <label className="form-label">Material</label>
                <select value={form.bagMaterial} onChange={e => set('bagMaterial', e.target.value)} className="form-input">
                  <option value="">Select...</option>
                  {BAG_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Bag Quality</label>
              <select value={form.bagQuality} onChange={e => set('bagQuality', e.target.value)} className="form-input">
                <option value="">Select...</option>
                <option>New</option><option>A-Grade</option><option>Standard</option><option>Premium</option><option>Economy</option>
              </select>
            </div>
            {form.packingType === 'retail' && (
            <div className="form-group">
              <label className="form-label">Bag Size (KG)</label>
              <select
                value={form.bagSizeKg}
                onChange={e => {
                  const v = e.target.value;
                  set('bagSizeKg', v);
                  // Auto-default master bag when switching to a retail size
                  if (requiresMasterBag(v) && !form.masterBagSizeKg) {
                    set('masterBagSizeKg', '20');
                  } else if (!requiresMasterBag(v)) {
                    set('masterBagSizeKg', '');
                  }
                }}
                className="form-input"
              >
                <option value="0.5">500 g (retail)</option>
                <option value="1">1 KG (retail)</option>
                <option value="2">2 KG (retail)</option>
                <option value="5">5 KG (retail)</option>
                <option value="10">10 KG (retail)</option>
                <option value="15">15 KG</option>
                <option value="20">20 KG</option>
                <option value="25">25 KG</option>
                <option value="50">50 KG</option>
              </select>
            </div>
            )}
            {form.packingType === 'jumbo' && (
              <div className="form-group">
                <label className="form-label">Bag Size (KG)</label>
                <input value="1,200 (Jumbo FIBC)" disabled className="form-input bg-gray-50 text-gray-500" />
              </div>
            )}
            {form.packingType === 'container' && (
              <div className="form-group">
                <label className="form-label">Load</label>
                <input value="Container / bulk (max 25,000 KG)" disabled className="form-input bg-gray-50 text-gray-500" />
              </div>
            )}
            {form.packingType === 'retail' && requiresMasterBag(form.bagSizeKg) && (
              <div className="form-group">
                <label className="form-label">Master Bag (KG) <span className="text-red-500">*</span></label>
                <select
                  value={form.masterBagSizeKg}
                  onChange={e => set('masterBagSizeKg', e.target.value)}
                  className="form-input"
                >
                  {masterOptionsFor(form.bagSizeKg).map(s => (
                    <option key={s} value={String(s)}>{s} KG ({Math.floor(s / (parseFloat(form.bagSizeKg) || 1))} × {form.bagSizeKg}kg)</option>
                  ))}
                </select>
                <p className="text-[11px] text-amber-700 mt-1">
                  Required: retail bags are packed inside a master bag for shipment.
                </p>
              </div>
            )}
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

          {/* Batch 7: palletization + pallet cost (not applicable to a bulk container) */}
          {form.packingType !== 'container' && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!form.palletized}
                  onChange={e => set('palletized', e.target.checked)} className="rounded border-gray-300" />
                Palletized load
              </label>
              {form.palletized && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Pallet Cost (PKR)</label>
                  <input type="number" min="0" value={form.palletCost}
                    onChange={e => set('palletCost', e.target.value)}
                    className="form-input w-40" placeholder="0.00" />
                </div>
              )}
            </div>
          )}

          {/* Container-capacity guard */}
          {capacityWarning && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {capacityWarning}
            </div>
          )}

          {/* Bag count preview */}
          {singleBagCount > 0 && (
            <div className="mt-4 bg-amber-50 rounded-lg border border-amber-200 p-3 text-sm text-amber-800">
              <span className="font-semibold">Estimated: </span>
              {singleBagCount.toLocaleString()} bags x {form.bagSizeKg} KG = {totalKg.toLocaleString()} KG
              {form.bagType && ` | ${form.bagType}`}
              {requiresMasterBag(form.bagSizeKg) && form.masterBagSizeKg && (() => {
                const inner = parseFloat(form.bagSizeKg) || 1;
                const mbSize = parseFloat(form.masterBagSizeKg);
                const retailPerMaster = mbSize > 0 ? Math.floor(mbSize / inner) : 0;
                const masterBagCount = mbSize > 0 ? Math.ceil(totalKg / mbSize) : 0;
                return (
                  <div className="mt-2 pt-2 border-t border-amber-200 text-[12px] text-amber-800 space-y-0.5">
                    <div><span className="font-semibold">Master bag:</span> {inner}kg × {retailPerMaster} = {mbSize}kg</div>
                    <div><span className="font-semibold">Master bags:</span> {totalKg.toLocaleString()} KG ÷ {mbSize} KG = <span className="font-semibold">{masterBagCount.toLocaleString()}</span> master bags</div>
                  </div>
                );
              })()}
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
                    <BagTypePicker
                      label="Bag Type"
                      value={line.bagType}
                      bagTypes={bagTypesList}
                      addToast={addToast}
                      onCreated={() => qc.invalidateQueries({ queryKey: ['bag-types'] })}
                      onChange={(name) => updatePackingLine(idx, 'bagType', name)}
                    />
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

      {/* ═══ Section 4c: per-item Bag Specification (multi-item) OR a single brand
            field for single-item Mixed (which has no order-level spec above) ═══ */}
      {needsBagWidget && (isMultiItem || isMixed) && (
        <div className="bg-white rounded-xl border border-amber-200 p-6">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" /> {isMultiItem ? 'Bag Specification — per item' : 'Brand / Marking'}
          </h2>
          {isMultiItem ? (
            <div className="space-y-2">
              {items.map((it, idx) => {
                const p = products.find(pp => String(pp.id) === String(it.productId));
                return (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-3 text-sm font-medium text-gray-700 truncate md:pb-2">
                      {p?.name || it.productName || `Item ${idx + 1}`}
                    </div>
                    <div className="md:col-span-3">
                      <BagTypePicker
                        label="Bag Type"
                        value={it.bagType}
                        bagTypes={bagTypesList}
                        addToast={addToast}
                        onCreated={() => qc.invalidateQueries({ queryKey: ['bag-types'] })}
                        onChange={(name, bt) => {
                          updateItem(idx, 'bagType', name);
                          const sz = bt?.sizeKg ?? bt?.size_kg;
                          if (sz) {
                            const v = String(sz);
                            updateItem(idx, 'bagSizeKg', v);
                            if (requiresMasterBag(v) && !it.masterBagSizeKg) updateItem(idx, 'masterBagSizeKg', '20');
                            else if (!requiresMasterBag(v)) updateItem(idx, 'masterBagSizeKg', '');
                          }
                        }}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Bag Size (KG)</label>
                      <select
                        value={it.bagSizeKg}
                        onChange={e => {
                          const v = e.target.value;
                          updateItem(idx, 'bagSizeKg', v);
                          if (requiresMasterBag(v) && !it.masterBagSizeKg) updateItem(idx, 'masterBagSizeKg', '20');
                          else if (!requiresMasterBag(v)) updateItem(idx, 'masterBagSizeKg', '');
                        }}
                        className="form-input"
                      >
                        <option value="">Select…</option>
                        {['0.5', '1', '2', '5', '10', '25', '50', '100'].map(s => (
                          <option key={s} value={s}>{s} KG</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Master Bag</label>
                      {requiresMasterBag(it.bagSizeKg) ? (
                        <select value={it.masterBagSizeKg} onChange={e => updateItem(idx, 'masterBagSizeKg', e.target.value)} className="form-input">
                          {masterOptionsFor(it.bagSizeKg).map(s => <option key={s} value={String(s)}>{s} KG</option>)}
                        </select>
                      ) : (
                        <div className="text-xs text-gray-400 py-2">Ships as-is</div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Brand / Marking</label>
                      <input
                        value={it.bagBrand}
                        onChange={e => updateItem(idx, 'bagBrand', e.target.value)}
                        className="form-input"
                        placeholder={form.bagBrand ? `defaults to ${form.bagBrand}` : 'Brand on bag'}
                      />
                    </div>
                    {requiresMasterBag(it.bagSizeKg) && it.masterBagSizeKg && (() => {
                      const m = parseFloat(it.masterBagSizeKg); const inner = parseFloat(it.bagSizeKg) || 1;
                      const itemKg = (parseFloat(it.qtyMT) || 0) * 1000;
                      return (
                        <div className="md:col-span-12 text-[11px] text-amber-700 -mt-1">
                          {Math.floor(m / inner)} × {inner}kg = {m}kg master · {itemKg.toLocaleString()} KG ÷ {m} = <span className="font-semibold">{Math.ceil(itemKg / m).toLocaleString()}</span> master bags
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-400 mt-1">Each item has its own bag type, size &amp; marking.</p>
            </div>
          ) : (
            <div className="form-group max-w-md">
              <label className="form-label">Brand / Marking</label>
              <input value={form.bagBrand} onChange={e => set('bagBrand', e.target.value)} className="form-input" placeholder="Brand on bag" />
            </div>
          )}
        </div>
      )}

      {/* ═══ Contract & Product Specs (collapsible, optional at creation) ═══ */}
      <div className="bg-white rounded-xl border border-gray-200">
        <button
          type="button"
          onClick={() => setSpecsOpen(prev => !prev)}
          className="w-full flex items-center justify-between p-6 text-left"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Contract & Product Specs</h2>
            <span className="text-xs text-gray-400 font-normal normal-case ml-2">Optional — can be filled later from order detail</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${specsOpen ? 'rotate-180' : ''}`} />
        </button>
        {specsOpen && (
          <div className="px-6 pb-6 pt-0">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Contract Number</label>
                <input value={form.contractNumber} onChange={e => set('contractNumber', e.target.value)} className="form-input" placeholder="If different from order no." />
              </div>
              <div className="form-group">
                <label className="form-label">Consignee Type</label>
                <select value={form.consigneeType} onChange={e => set('consigneeType', e.target.value)} className="form-input">
                  <option value="to_order_of_bank">To Order of Bank</option>
                  <option value="direct">Direct to Buyer</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Broken % Target</label>
                <input type="number" value={form.brokenPctTarget} onChange={e => set('brokenPctTarget', e.target.value)} className="form-input" placeholder="e.g. 2" min="0" max="100" step="0.5" />
              </div>
              <div className="form-group">
                <label className="form-label">Shipment Window Start</label>
                <input type="date" value={form.shipmentWindowStart} onChange={e => set('shipmentWindowStart', e.target.value)} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Shipment Window End</label>
                <input type="date" value={form.shipmentWindowEnd} onChange={e => set('shipmentWindowEnd', e.target.value)} className="form-input" />
              </div>
              <div className="form-group sm:col-span-2 lg:col-span-3">
                <label className="form-label">Quality Description</label>
                <textarea value={form.qualityDescription} onChange={e => set('qualityDescription', e.target.value)} className="form-input resize-none" rows={2} placeholder="e.g. Pakistani Basmati White Rice - 2% Broken - Double polished & color sorted..." />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Section: Printed Bags (optional procurement) ═══ */}
      <div className="bg-white rounded-xl border border-violet-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-violet-700 uppercase tracking-wider flex items-center gap-2"><ShoppingBag className="w-4 h-4" /> Printed Bags <span className="normal-case text-gray-400 font-normal">(optional)</span></h2>
          <button type="button" onClick={addPrintedBag} className="btn btn-sm btn-secondary"><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">If you need to order printed / branded bags from a vendor for this order, arrange them here. Each becomes a payable to the vendor; you can also add or receive these later on the order's Printed Bags tab.</p>
        {printedBags.length === 0 ? (
          <p className="text-sm text-gray-400">No printed-bag orders. Click “Add” if you need printed bags for this shipment.</p>
        ) : (
          <div className="space-y-3">
            {printedBags.map((b, idx) => {
              const lineTotal = (parseInt(b.quantity, 10) || 0) * (parseFloat(b.unitCost) || 0);
              return (
                <div key={idx} className="bg-violet-50/50 rounded-lg p-4 border border-violet-100">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-500">Printed bags {idx + 1}</span>
                    <button type="button" onClick={() => removePrintedBag(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <BagTypePicker label="Bag Type" value={b.bagType} bagTypes={bagTypesList} addToast={addToast}
                      onCreated={() => qc.invalidateQueries({ queryKey: ['bag-types'] })}
                      onChange={(name, bt) => updatePrintedBag(idx, { bagType: name, bagTypeId: bt?.id || null, bagSizeKg: bt ? String(bt.sizeKg ?? bt.size_kg ?? b.bagSizeKg) : b.bagSizeKg })} />
                    <SupplierPicker label="Bag Vendor" value={b.vendorId} suppliers={suppliersList} addToast={addToast} clearable
                      onChange={(id) => updatePrintedBag(idx, { vendorId: id })} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <div className="form-group">
                      <label className="form-label text-xs">Qty (bags)</label>
                      <input type="number" min="0" value={b.quantity} onChange={e => updatePrintedBag(idx, { quantity: e.target.value })} className="form-input text-sm py-1.5" placeholder="2000" />
                    </div>
                    <div className="form-group">
                      <label className="form-label text-xs">Unit cost (Rs)</label>
                      <input type="number" min="0" step="0.01" value={b.unitCost} onChange={e => updatePrintedBag(idx, { unitCost: e.target.value })} className="form-input text-sm py-1.5" placeholder="60" />
                    </div>
                    <div className="form-group">
                      <label className="form-label text-xs">Printing</label>
                      <select value={b.printing} onChange={e => updatePrintedBag(idx, { printing: e.target.value })} className="form-input text-sm py-1.5">
                        <option value="">Select…</option>
                        <option>Plain</option><option>Buyer Logo</option><option>Buyer Logo + Text</option><option>Custom Design</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label text-xs">Line Total</label>
                      <div className="form-input bg-gray-100 text-sm py-1.5 text-gray-700 font-medium">Rs {Math.round(lineTotal).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>}

      {step === 3 && <>
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
              {/* Advance / balance split, driven by the incoterm-derived advance % */}
              <div className="border-t pt-2 flex justify-between text-sm"><span className="text-gray-600">Advance ({costing.advPct}%)</span><span className="font-medium">{fmtUSD(costing.advanceExpected)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Balance ({Math.max(0, 100 - costing.advPct)}%)</span><span className="font-medium">{fmtUSD(costing.balanceExpected)}</span></div>
              <div className={`mt-2 p-2.5 rounded-lg text-xs font-medium ${costing.marginPct >= 15 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : costing.marginPct >= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {costing.marginPct >= 15 ? 'Healthy margin' : costing.marginPct >= 5 ? 'Low margin — review costs' : 'Negative/very low margin — reconsider pricing'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Submit Buttons ═══ */}
      {(() => {
        const advPct = parseFloat(form.advancePct) || 0;
        const createStatus = advPct === 0 ? 'Advance Received' : 'Awaiting Advance';
        return (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => handleSubmit('Draft')} className="btn btn-secondary mobile-full-btn"><Save className="w-4 h-4" /> Save Draft</button>
            <button onClick={() => handleSubmit(createStatus)} disabled={!isValid} className="btn btn-primary mobile-full-btn disabled:opacity-50"><Send className="w-4 h-4" /> Create Order</button>
            {advPct > 0 && (
              <button onClick={() => handleSubmit('Awaiting Advance')} disabled={!isValid} className="btn mobile-full-btn disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600"><DollarSign className="w-4 h-4" /> Create & Request Advance</button>
            )}
          </div>
        );
      })()}
      </>}

      {/* ═══ Wizard Navigation (sticky-ish) ═══ */}
      {(() => {
        const advPct = parseFloat(form.advancePct) || 0;
        const advExpected = contractValue * (advPct / 100);
        const balExpected = contractValue - advExpected;
        return (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sticky bottom-0">
            <div className="text-xs text-gray-500 flex items-center gap-4 flex-wrap">
              {qtyMT > 0 && <span><span className="font-medium text-gray-900">{qtyMT.toLocaleString()}</span> MT</span>}
              {contractValue > 0 && <span><span className="text-gray-400">Value</span> <span className="font-medium text-gray-900">{form.currency} {contractValue.toLocaleString()}</span></span>}
              {advExpected > 0 && <span><span className="text-gray-400">Adv</span> <span className="font-medium text-gray-900">{form.currency} {advExpected.toLocaleString()}</span></span>}
              {balExpected > 0 && <span><span className="text-gray-400">Bal</span> <span className="font-medium text-emerald-700">{form.currency} {balExpected.toLocaleString()}</span></span>}
            </div>
            <div className="flex items-center gap-2">
              {step > 1 && (
                <button onClick={() => setStep(s => Math.max(1, s - 1))} className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 inline-flex items-center gap-1">
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              {step < 3 && (
                <button onClick={tryNext} disabled={!canNext}
                  className={`px-4 py-1.5 text-sm font-medium rounded inline-flex items-center gap-1 ${canNext ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                  Next <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Add / Edit Buyer drawer (edit mode when newCust.id is set) */}
      <SlideDrawer
        open={showAddCustomer}
        onClose={() => setShowAddCustomer(false)}
        title={newCust.id ? 'Edit Buyer' : 'Add New Buyer'}
        icon={newCust.id ? Edit3 : Plus}
        size="md"
        footer={(
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddCustomer(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button
              onClick={async () => {
                if (!newCust.name.trim()) { addToast('Company name is required', 'error'); return; }
                try {
                  if (newCust.id) {
                    // Edit existing buyer → applies now + flagged for admin review.
                    const res = await api.put(`/api/admin/customers/${newCust.id}/submit-edit`, newCust);
                    const c = res?.data?.data?.customer;
                    set('country', (c?.country) || newCust.country || '');
                    qc.invalidateQueries({ queryKey: ['customers'] });
                    addToast(res?.data?.data?.pending ? `Changes to "${newCust.name}" sent for admin review` : `Buyer "${newCust.name}" updated`, 'success');
                  } else {
                    const res = await api.post('/api/customers', newCust);
                    const created = res?.data?.data?.customer || res?.data?.customer || res?.data;
                    if (created?.id) {
                      set('customerId', created.id);
                      set('country', created.country || newCust.country || '');
                      qc.invalidateQueries({ queryKey: ['customers'] });
                      addToast(`Buyer "${newCust.name}" added`, 'success');
                    }
                  }
                  setShowAddCustomer(false);
                  setNewCust({ name: '', country: '', port: '', address: '', email: '', phone: '', contact_person: '' });
                } catch (err) { addToast(err?.response?.data?.message || 'Failed to save buyer', 'error'); }
              }}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              {newCust.id ? 'Save Changes' : 'Add Buyer'}
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Company Name *</label>
            <input type="text" value={newCust.name} onChange={e => setNewCust(p => ({ ...p, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Buyer company name" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Country *</label>
            <SearchSelect
              value={newCust.country}
              onChange={val => setNewCust(p => ({ ...p, country: val }))}
              options={COUNTRY_OPTIONS}
              placeholder="Search country…"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Address</label>
            <textarea value={newCust.address} onChange={e => setNewCust(p => ({ ...p, address: e.target.value }))}
              rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Street, city, postal code…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Port</label>
            <input type="text" list="buyer-port-list" value={newCust.port}
              onChange={e => setNewCust(p => ({ ...p, port: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Select a port or type a new one…" />
            <datalist id="buyer-port-list">
              {PORTS.map(p => <option key={p} value={p} />)}
            </datalist>
            <p className="text-[11px] text-gray-400 mt-1">Buyer's discharge/destination port — pick from the list or enter your own.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Contact Person</label>
            <input type="text" value={newCust.contact_person} onChange={e => setNewCust(p => ({ ...p, contact_person: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Email</label>
              <input type="email" value={newCust.email} onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Phone</label>
              <input type="text" value={newCust.phone} onChange={e => setNewCust(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
      </SlideDrawer>
    </div>
  );
}
