/**
 * Milling Process Costing Sheet — Auto-populated, print-ready.
 *
 * Sections:
 * A: Source raw material (auto-filled from quality/lot/batch)
 * B: Raw material buying/landed cost
 * C: Process/additional costs
 * D: Yield/output details
 * E: By-product details & values
 * F: Final costing summary (net cost after by-product recovery)
 * G: Vehicle arrivals
 */
import { useRef } from 'react';
import { Printer } from 'lucide-react';
import PartyLink from '../../../shared/components/PartyLink';

/**
 * Open the cost sheet in a clean popup, copy parent stylesheets across
 * so Tailwind classes still apply, then trigger print. Avoids the
 * brittle "visibility:hidden everywhere" CSS strategy that left blank
 * pages depending on browser + modal stacking.
 */
function printCostSheet(node, title) {
  if (!node) { window.print(); return; }
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    // Popup blocked — fall back to in-place print
    window.print();
    return;
  }
  // Copy stylesheets + inline <style> blocks from parent
  const headHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join('\n');
  win.document.open();
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title || 'Costing Sheet'}</title>
${headHtml}
<style>
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: white;
    font-family: Inter, system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cost-sheet { width: 100%; }
  /* Keep each major panel and each table intact across page boundaries
     where the page is tall enough. Browsers honour this as a hint —
     they'll still split when a single block exceeds one page. */
  .cost-sheet > div,
  .cost-sheet table,
  .cost-sheet tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* When a table does split, repeat its header on the next page */
  .cost-sheet thead { display: table-header-group; }
  .cost-sheet tfoot { display: table-footer-group; }
  /* Don't strand a heading at the bottom of a page */
  .cost-sheet h1, .cost-sheet h2, .cost-sheet h3 {
    break-after: avoid;
    page-break-after: avoid;
  }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`);
  win.document.close();
  // Give stylesheets a moment to load
  const trigger = () => { try { win.focus(); win.print(); } catch { /* user cancelled */ } setTimeout(() => win.close(), 500); };
  if (win.document.readyState === 'complete') setTimeout(trigger, 250);
  else win.addEventListener('load', trigger);
}

// Costing figures show 2 decimals — especially the per-kg costs, where rounding
// to whole rupees hid real cost (e.g. 145.37/kg displayed as 145).
function fmtPKR(v) { return 'Rs ' + (parseFloat(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function pf(v) { return parseFloat(v) || 0; }

function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (num < 20) return ones[num];
  if (num < 100) return tens[Math.floor(num/10)] + (num%10 ? ' '+ones[num%10] : '');
  if (num < 1000) return ones[Math.floor(num/100)] + ' Hundred' + (num%100 ? ' '+numberToWords(num%100) : '');
  if (num < 100000) return numberToWords(Math.floor(num/1000)) + ' Thousand' + (num%1000 ? ' '+numberToWords(num%1000) : '');
  if (num < 10000000) return numberToWords(Math.floor(num/100000)) + ' Lakh' + (num%100000 ? ' '+numberToWords(num%100000) : '');
  return numberToWords(Math.floor(num/10000000)) + ' Crore' + (num%10000000 ? ' '+numberToWords(num%10000000) : '');
}

// Default by-product market rates (PKR per MT) — editable via props
const DEFAULT_BYPRODUCT_RATES = {
  broken: 42000,
  sortex: 35000,
  bran: 22400,
  husk: 8400,
};

export default function MillingCostSheet({ batch, companyProfile, millingCostCategories, vehicles = [], sourceLots = [], byproductRates = DEFAULT_BYPRODUCT_RATES }) {
  if (!batch) return null;

  const isFromLots = Array.isArray(sourceLots) && sourceLots.length > 0;
  // A true blend mixes 2+ distinct rice TYPES; same-type / single lots stay single-variety.
  const isBlend = isFromLots && new Set(
    sourceLots
      .map((l) => (l.product_name || l.variety || l.type || l.item_name || '').trim().toLowerCase())
      .filter(Boolean),
  ).size > 1;

  const safeCosts = (batch.costs && typeof batch.costs === 'object' && !Array.isArray(batch.costs)) ? batch.costs : {};
  const safeSample = batch.sampleAnalysis || null;
  const safeArrival = batch.arrivalAnalysis || null;

  // ═══ SECTION A: Raw Material Input ═══
  const rawQtyMT = pf(batch.rawQtyMT);
  const rawQtyKG = rawQtyMT * 1000;
  const inputPriceMT = pf(safeArrival?.pricePerMT || safeSample?.pricePerMT);
  const inputPriceKG = inputPriceMT > 0 ? inputPriceMT / 1000 : 0;
  const rawMaterialCost = rawQtyMT * inputPriceMT;

  // ═══ SECTION C: Process Costs ═══
  const materialCats = (millingCostCategories || []).filter(c => c.section === 'material');
  const processCats = (millingCostCategories || []).filter(c => c.section === 'process');
  const overheadCats = (millingCostCategories || []).filter(c => c.section === 'overhead');
  const allCats = [...materialCats, ...processCats, ...overheadCats];

  // Raw cost — milling_costs raw_rice (residual model), else arrival price × qty.
  const rawRiceCostFromSheet = rawMaterialCost;
  const rawRiceCostManual = pf(safeCosts.rawRice ?? safeCosts.raw_rice);
  const effectiveRawRiceCost = rawRiceCostManual > 0 ? rawRiceCostManual : rawRiceCostFromSheet;

  // Residual costing: Net Purchase = Raw + Milling + Other, using the operator's
  // manual Milling Cost / Other Expenses (fallback to milling fee + recorded
  // process/overhead categories), to match the costing box and Costs tab.
  const processCostTotal = processCats.reduce((s, c) => s + pf(safeCosts[c.key]), 0);
  const overheadCostTotal = overheadCats.reduce((s, c) => s + pf(safeCosts[c.key]), 0);
  // Milling Cost defaults to 0 until entered (no auto milling fee). Other
  // Expenses falls back to recorded processing costs (process + overhead), to
  // match the engine's Net Purchase.
  const millingCostVal = batch.manualMillingCostPkr != null ? pf(batch.manualMillingCostPkr) : 0;
  // Only a POSITIVE manual Other overrides the itemized process/overhead costs;
  // a stored 0 must not hide them (matches the backend residual engine).
  const otherExpVal = pf(batch.manualOtherExpensesPkr) > 0 ? pf(batch.manualOtherExpensesPkr) : (processCostTotal + overheadCostTotal);
  // Packing (bags) is a separate always-added line so it loads the finished cost
  // even when a manual Other figure overrides the auto process/overhead costs.
  const packingCostVal = pf(safeCosts.packaging);
  // Itemised packing breakdown (bags / master bags / polythene), when present.
  const packBreakdown = batch.packingBreakdown || null;
  const totalBatchCost = effectiveRawRiceCost + millingCostVal + otherExpVal + packingCostVal;

  // ═══ SECTION D: Yield Output ═══
  const finishedMT = pf(batch.actualFinishedMT);
  const finishedKG = finishedMT * 1000;
  const finishedYieldPct = rawQtyMT > 0 ? (finishedMT / rawQtyMT * 100).toFixed(1) : '0.0';

  // ═══ SECTION E: By-Products ═══
  // Sortex Rejects is the current byproduct stream; Bran/Husk render only
  // when a legacy batch carries non-zero values so old batches stay
  // accurate while new ones show only the relevant outputs.
  // Pricing precedence: batch-confirmed price → caller-supplied commodity
  // rate → built-in default. This way, once an operator runs the price
  // confirmation modal the sheet reflects what they actually entered.
  const rate = (batchVal, fallback) => pf(batchVal) > 0 ? pf(batchVal) : pf(fallback);
  const sortexMT = pf(batch.sortexRejectsMT || batch.sortex_rejects_mt);
  const branMTval = pf(batch.branMT);
  const huskMTval = pf(batch.huskMT);
  // Per-grade broken quantities. When any of these is set the cost sheet
  // shows one row per grade (each with its own price); otherwise it
  // shows a single aggregate Broken Rice row.
  const b1MT  = pf(batch.b1MT);
  const b2MT  = pf(batch.b2MT);
  const b3MT  = pf(batch.b3MT);
  const csrMT = pf(batch.csrMT);
  const sgMT  = pf(batch.shortGrainMT);
  const usePerGradeBroken = (b1MT + b2MT + b3MT + csrMT + sgMT) > 0;
  // Fallback when a per-grade price isn't set on the batch: aggregate
  // broken price → commodity-rate prop → built-in default.
  const fallbackBrokenRate = rate(batch.brokenPricePerMT, byproductRates.broken);
  const brokenRows = usePerGradeBroken ? [
    { type: 'B1',          key: 'b1',  qty: b1MT,  rate: rate(batch.b1PricePerMT,         fallbackBrokenRate), color: 'bg-amber-500' },
    { type: 'B2',          key: 'b2',  qty: b2MT,  rate: rate(batch.b2PricePerMT,         fallbackBrokenRate), color: 'bg-amber-400' },
    { type: 'B3',          key: 'b3',  qty: b3MT,  rate: rate(batch.b3PricePerMT,         fallbackBrokenRate), color: 'bg-amber-300' },
    { type: 'CSR',         key: 'csr', qty: csrMT, rate: rate(batch.csrPricePerMT,        fallbackBrokenRate), color: 'bg-yellow-500' },
    { type: 'Short Grain', key: 'sg',  qty: sgMT,  rate: rate(batch.shortGrainPricePerMT, fallbackBrokenRate), color: 'bg-yellow-400' },
  ] : [
    { type: 'Broken', key: 'broken', qty: pf(batch.brokenMT), rate: fallbackBrokenRate, color: 'bg-amber-500' },
  ];
  const allByproducts = [
    ...brokenRows,
    { type: 'Sortex Rejects',      key: 'sortex', qty: sortexMT,           rate: rate(batch.sortexRejectsPricePerMT || batch.sortex_rejects_price_per_mt, byproductRates.sortex), color: 'bg-amber-500' },
    { type: 'Powder',              key: 'powder', qty: pf(batch.powderMT),   rate: rate(batch.powderPricePerMT,   byproductRates.powder),   color: 'bg-gray-400' },
    { type: 'Sweeping',            key: 'sweeping', qty: pf(batch.sweepingMT), rate: rate(batch.sweepingPricePerMT, byproductRates.sweeping), color: 'bg-gray-300' },
    { type: 'Rice Bran (legacy)',  key: 'bran',   qty: branMTval,          rate: rate(batch.branPricePerMT,                                         byproductRates.bran),   color: 'bg-emerald-500',  legacy: true },
    { type: 'Rice Husk (legacy)',  key: 'husk',   qty: huskMTval,          rate: rate(batch.huskPricePerMT,                                         byproductRates.husk),   color: 'bg-purple-500', legacy: true },
  ];
  const byProducts = allByproducts
    // Drop legacy bran/husk if they're zero on this batch. Drop per-grade
    // broken rows that are zero (keeps the sheet tight). Always keep the
    // aggregate row in non-per-grade mode and always keep Sortex.
    .filter(bp => {
      if (bp.legacy) return bp.qty > 0;
      if (usePerGradeBroken && ['b1','b2','b3','csr','sg'].includes(bp.key)) return bp.qty > 0;
      // Powder & Sweeping always show on the sheet (match the costing dialog),
      // even at qty 0, so their line + rate are always visible.
      if (bp.key === 'powder' || bp.key === 'sweeping') return true;
      return true;
    })
    .map(bp => ({
      ...bp,
      qtyKG: bp.qty * 1000,
      value: bp.qty * bp.rate,
      yieldPct: rawQtyMT > 0 ? (bp.qty / rawQtyMT * 100).toFixed(1) : '0.0',
    }));
  const wastageMT = pf(batch.wastageMT);
  const totalByproductValue = byProducts.reduce((s, bp) => s + bp.value, 0);
  const totalOutputMT = finishedMT + byProducts.reduce((s, bp) => s + bp.qty, 0) + wastageMT;
  const totalRecoveryPct = rawQtyMT > 0 ? (totalOutputMT / rawQtyMT * 100).toFixed(1) : '0.0';

  // ═══ SECTION F: Final Costing ═══
  const netCostAfterByproducts = totalBatchCost - totalByproductValue;
  // Use the engine's stored residual finished cost as the authoritative figure so
  // the sheet matches the costing box / Costs tab exactly; fall back to the local
  // computation for batches not yet costed by the residual engine.
  const storedFinishedPerKG = pf(batch.totalCostPerKgFinished);
  const finalCostPerKG = storedFinishedPerKG > 0
    ? storedFinishedPerKG
    : (finishedKG > 0 ? netCostAfterByproducts / finishedKG : 0);
  const finalCostPerMaund = finalCostPerKG * 40;
  const finalCostPerKatta = finalCostPerKG * 50;
  const finalCostPerTon = finalCostPerKG * 1000;
  const costPerMT = rawQtyMT > 0 ? totalBatchCost / rawQtyMT : 0;

  const H = '#1e3a5f'; // header color
  const G = '#d4a853'; // gold accent

  const sheetRef = useRef(null);

  return (
    <>
      {/* Print toolbar — never printed because it lives outside the
          cloned node passed to the popup print window. */}
      <div className="mb-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => printCostSheet(sheetRef.current, `Costing Sheet — ${batch.id || ''}`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
          title="Print or save as PDF"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div ref={sheetRef} className="cost-sheet text-sm" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

        {/* ===== HEADER ===== */}
        <div className="rounded-t-xl px-8 py-5 flex items-center justify-between" style={{ backgroundColor: H }}>
          <div className="flex items-center gap-4">
            {companyProfile?.logo && (
              <img src={companyProfile.logo} alt="Logo" className="rounded-lg object-contain" style={{ width: 60, height: 60 }} />
            )}
            <div>
              <h1 className="text-2xl font-bold text-white tracking-wider" style={{ letterSpacing: '0.12em' }}>
                {companyProfile?.name || 'AGRI COMMODITIES'}
              </h1>
              <p className="italic text-sm mt-0.5" style={{ color: G }}>
                {companyProfile?.tagline || 'Serving Natural Nutrition'}
              </p>
            </div>
          </div>
          <div className="bg-white bg-opacity-95 rounded-xl px-6 py-3 text-center shadow-md">
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: H }}>Milling Process Costing Sheet</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: '#10b981' }}>{batch.id}</p>
            <p className="text-xs mt-0.5" style={{ color: '#666' }}>{fmtDate(batch.createdAt)}</p>
          </div>
        </div>

        {/* ═══ SECTION A: Source Raw Material ═══ */}
        <div className="border-x border-gray-200 px-6 py-4 bg-gray-50">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Section A — Source Raw Material</p>
          <div className="grid grid-cols-4 gap-4">
            <div><p className="text-[10px] text-gray-500">Supplier</p><p className="font-semibold"><PartyLink type="supplier" id={batch.supplierId} name={batch.supplierName} className="font-semibold" /></p></div>
            <div><p className="text-[10px] text-gray-500">Linked Export Order</p><p className="font-semibold text-gray-900">{batch.linkedExportOrder || 'Local / Unlinked'}</p></div>
            <div><p className="text-[10px] text-gray-500">Batch Status</p><p className="font-semibold text-gray-900">{batch.status}</p></div>
            <div><p className="text-[10px] text-gray-500">Date</p><p className="font-semibold text-gray-900">{fmtDate(batch.createdAt)}</p></div>
          </div>
          {/* Quality from quality sheet */}
          {(safeSample || safeArrival) && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="grid grid-cols-6 gap-3">
                {safeSample?.moisture != null && <div><p className="text-[10px] text-amber-600">Sample Moisture</p><p className="font-semibold">{safeSample.moisture}%</p></div>}
                {safeSample?.broken != null && <div><p className="text-[10px] text-amber-600">Sample Broken</p><p className="font-semibold">{safeSample.broken}%</p></div>}
                {safeArrival?.moisture != null && <div><p className="text-[10px] text-blue-600">Arrival Moisture</p><p className="font-semibold">{safeArrival.moisture}%</p></div>}
                {safeArrival?.broken != null && <div><p className="text-[10px] text-blue-600">Arrival Broken</p><p className="font-semibold">{safeArrival.broken}%</p></div>}
                {safeArrival?.purity != null && <div><p className="text-[10px] text-blue-600">Purity</p><p className="font-semibold">{safeArrival.purity}%</p></div>}
                {safeArrival?.chalky != null && <div><p className="text-[10px] text-blue-600">Chalky</p><p className="font-semibold">{safeArrival.chalky}%</p></div>}
              </div>
            </div>
          )}
        </div>

        {/* ═══ SECTION B: Raw Material Buying Cost (auto-populated) ═══ */}
        <div className="border-x border-t border-gray-200 px-6 py-3" style={{ backgroundColor: '#fefce8' }}>
          {isFromLots ? (() => {
            const avgPerMt = rawQtyMT > 0 ? effectiveRawRiceCost / rawQtyMT : 0;
            return (
              <>
                <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-2">Section B — Raw Material Buying Cost ({isBlend ? 'Blended — ' : 'Source Lots — '}{sourceLots.length} lot{sourceLots.length === 1 ? '' : 's'})</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-amber-700 border-b border-amber-200">
                      <th className="text-left py-1 font-semibold">Lot / Supplier</th>
                      <th className="text-right font-semibold">Qty (kg)</th>
                      <th className="text-right font-semibold">Agreed Price /kg</th>
                      <th className="text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceLots.map((l) => {
                      const perMt = Math.round((pf(l.unit_cost_pkr || l.landed_cost_per_kg)) * 1000);
                      return (
                        <tr key={l.id} className="border-b border-amber-100">
                          <td className="py-1 text-gray-800">{l.lot_no}{l.supplier_name ? ` · ${l.supplier_name}` : ''}</td>
                          <td className="text-right text-gray-900">{Math.round(pf(l.qty_kg)).toLocaleString()}</td>
                          <td className="text-right text-gray-900">{fmtPKR(perMt / 1000)}</td>
                          <td className="text-right text-gray-900">{fmtPKR(pf(l.cost_total_pkr))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold text-gray-900 border-t-2 border-amber-300">
                      <td className="py-1.5">{isBlend ? 'Blended average' : 'Weighted average'}</td>
                      <td className="text-right">{Math.round(rawQtyKG).toLocaleString()} kg</td>
                      <td className="text-right text-blue-900">{fmtPKR(avgPerMt / 1000)}</td>
                      <td className="text-right">{fmtPKR(effectiveRawRiceCost)}</td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-1.5 text-[9px] text-amber-700">{isBlend ? 'Blended average' : 'Weighted average'} = total cost ÷ total input qty. Used as the raw material cost below.</p>
              </>
            );
          })() : (
            <>
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-2">Section B — Raw Material Buying Cost {inputPriceMT > 0 ? '(Auto-populated from Quality Sheet)' : '(Manual Entry)'}</p>
              <div className="grid grid-cols-5 gap-4">
                <div><p className="text-xs text-amber-700">Input Quantity</p><p className="text-base font-bold text-gray-900">{Math.round(rawQtyKG).toLocaleString()} kg</p></div>
                <div><p className="text-xs text-amber-700">{safeSample?.pricePerMT ? 'Sample Price' : 'Rate'}</p><p className="text-base font-bold text-gray-900">{safeSample?.pricePerMT ? fmtPKR(pf(safeSample.pricePerMT) / 1000) : '—'}<span className="text-xs font-normal text-gray-500"> /kg</span></p></div>
                <div><p className="text-xs text-amber-700">{safeArrival?.pricePerMT ? 'Agreed/Arrival Price' : 'Agreed Price'}</p><p className="text-base font-bold text-blue-900">{inputPriceMT > 0 ? fmtPKR(inputPriceMT / 1000) : '—'}<span className="text-xs font-normal text-gray-500"> /kg</span></p></div>
                <div><p className="text-xs text-amber-700">Rate per kg</p><p className="text-base font-bold text-gray-900">{inputPriceKG > 0 ? fmtPKR(inputPriceKG) : '—'}</p></div>
                <div><p className="text-xs text-amber-700">Total Raw Material Cost</p><p className="text-base font-bold text-gray-900">{rawMaterialCost > 0 ? fmtPKR(rawMaterialCost) : fmtPKR(effectiveRawRiceCost)}</p></div>
              </div>
              {rawRiceCostManual > 0 && rawMaterialCost > 0 && Math.abs(rawRiceCostManual - rawMaterialCost) > 100 && (
                <p className="mt-2 text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1">
                  Note: Manual cost entry ({fmtPKR(rawRiceCostManual)}) differs from quality sheet ({fmtPKR(rawMaterialCost)}). Using manual entry.
                </p>
              )}
            </>
          )}
        </div>

        {/* ═══ SECTION C: Process & Additional Costs ═══ */}
        <div className="border-x border-gray-200">
          <div className="px-6 py-2 bg-gray-50 border-t border-gray-200">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Section C — Process & Additional Costs</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: H }}>
                <th className="text-left px-6 py-2 text-xs font-bold text-white uppercase">Cost Item</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Amount (PKR)</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Per kg (Raw)</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {/* Raw material row */}
              <tr className="bg-amber-50 border-b border-amber-100">
                <td className="px-6 py-2 font-semibold text-amber-900">Raw Rice Purchase</td>
                <td className="px-6 py-2 text-right font-bold text-amber-900">{fmtPKR(effectiveRawRiceCost)}</td>
                <td className="px-6 py-2 text-right text-amber-700">{rawQtyKG > 0 ? fmtPKR(effectiveRawRiceCost / rawQtyKG) : '—'}</td>
                <td className="px-6 py-2 text-right text-amber-700">{totalBatchCost > 0 ? ((effectiveRawRiceCost / totalBatchCost) * 100).toFixed(1) : '—'}%</td>
              </tr>
              {/* Milling Cost + Other Expenses — the residual-model cost lines
                  (operator-entered, or the recorded-cost fallback). Shown
                  explicitly so the figures the operator entered are visible and
                  Raw + Milling + Other = Net Purchase reconciles. */}
              <tr className="bg-white">
                <td className="px-6 py-1.5 text-gray-900">Milling Cost</td>
                <td className="px-6 py-1.5 text-right text-gray-700">{millingCostVal > 0 ? fmtPKR(millingCostVal) : '—'}</td>
                <td className="px-6 py-1.5 text-right text-gray-500">{millingCostVal > 0 && rawQtyKG > 0 ? fmtPKR(millingCostVal / rawQtyKG) : '—'}</td>
                <td className="px-6 py-1.5 text-right text-gray-500">{millingCostVal > 0 && totalBatchCost > 0 ? ((millingCostVal / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="px-6 py-1.5 text-gray-900">Other Expenses</td>
                <td className="px-6 py-1.5 text-right text-gray-700">{otherExpVal > 0 ? fmtPKR(otherExpVal) : '—'}</td>
                <td className="px-6 py-1.5 text-right text-gray-500">{otherExpVal > 0 && rawQtyKG > 0 ? fmtPKR(otherExpVal / rawQtyKG) : '—'}</td>
                <td className="px-6 py-1.5 text-right text-gray-500">{otherExpVal > 0 && totalBatchCost > 0 ? ((otherExpVal / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
              {packingCostVal > 0 && (
                <tr className="bg-gray-50">
                  <td className="px-6 py-1.5 text-gray-900">Packing / Bags</td>
                  <td className="px-6 py-1.5 text-right text-gray-700">{fmtPKR(packingCostVal)}</td>
                  <td className="px-6 py-1.5 text-right text-gray-500">{rawQtyKG > 0 ? fmtPKR(packingCostVal / rawQtyKG) : '—'}</td>
                  <td className="px-6 py-1.5 text-right text-gray-500">{totalBatchCost > 0 ? ((packingCostVal / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
              )}
              {/* Itemised packing breakdown — bags / master bags / polythene —
                  shown only when master bag or polythene were used. */}
              {packingCostVal > 0 && packBreakdown && (
                [
                  ...(packBreakdown.bags || []).map((i) => ({ label: `${i.name || 'Bags'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                  ...(packBreakdown.masters || []).map((i) => ({ label: `${i.name || 'Master bag'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                  ...(packBreakdown.polythene || []).map((i) => ({ label: `${i.name || 'Polythene'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                ].filter((r) => r.val > 0).map((r, i) => (
                  <tr key={`pb-${i}`} className="bg-white text-xs text-gray-500">
                    <td className="pl-12 pr-6 py-1">↳ {r.label}</td>
                    <td className="px-6 py-1 text-right">{fmtPKR(r.val)}</td>
                    <td className="px-6 py-1 text-right">{rawQtyKG > 0 ? fmtPKR(r.val / rawQtyKG) : '—'}</td>
                    <td className="px-6 py-1 text-right">{totalBatchCost > 0 ? ((r.val / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-6 py-2 font-bold text-gray-900">Total Batch Cost (A)</td>
                <td className="px-6 py-2 text-right font-bold text-gray-900">{fmtPKR(totalBatchCost)}</td>
                <td className="px-6 py-2 text-right font-semibold text-gray-700">{fmtPKR(costPerMT / 1000)}<span className="text-[10px] font-normal"> /kg</span></td>
                <td className="px-6 py-2 text-right font-bold text-gray-900">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ═══ SECTION D: Yield / Output ═══ */}
        <div className="border-x border-t border-gray-200 px-6 py-3" style={{ backgroundColor: '#eff6ff' }}>
          <p className="text-[10px] font-bold text-blue-800 uppercase tracking-widest mb-2">Section D — Milling Yield & Output</p>
          <div className="grid grid-cols-5 gap-4 mb-3">
            <div><p className="text-xs text-blue-600">Raw Input</p><p className="text-base font-bold text-gray-900">{Math.round(rawQtyKG).toLocaleString()} kg</p></div>
            <div><p className="text-xs text-blue-600">Finished Rice</p><p className="text-base font-bold text-blue-900">{Math.round(finishedKG).toLocaleString()} kg</p></div>
            <div><p className="text-xs text-blue-600">Yield %</p><p className={`text-base font-bold ${pf(finishedYieldPct) >= 65 ? 'text-emerald-700' : 'text-red-700'}`}>{finishedYieldPct}%</p></div>
            <div><p className="text-xs text-blue-600">Total Output</p><p className="text-base font-bold text-gray-900">{Math.round(totalOutputMT * 1000).toLocaleString()} kg</p></div>
            <div><p className="text-xs text-blue-600">Recovery %</p><p className={`text-base font-bold ${pf(totalRecoveryPct) > 100 ? 'text-red-700' : 'text-emerald-700'}`}>{totalRecoveryPct}%</p>
              {pf(totalRecoveryPct) > 100.5 && <p className="text-[10px] text-red-600">⚠ Exceeds 100%</p>}
            </div>
          </div>

          {/* Yield breakdown bar */}
          <div className="flex rounded overflow-hidden h-5 mb-2">
            {finishedMT > 0 && <div className="bg-blue-500 flex items-center justify-center text-white text-[9px] font-bold" style={{ width: `${(finishedMT / rawQtyMT) * 100}%` }}>Rice {finishedYieldPct}%</div>}
            {byProducts.map(bp => bp.qty > 0 && <div key={bp.key} className={`flex items-center justify-center text-white text-[9px] font-bold ${bp.color || 'bg-gray-400'}`} style={{ width: `${(bp.qty / rawQtyMT) * 100}%` }} title={`${bp.type}: ${Math.round(bp.qtyKG).toLocaleString()} kg`}>{bp.yieldPct}%</div>)}
            {wastageMT > 0 && <div className="bg-red-400 flex items-center justify-center text-white text-[9px] font-bold" style={{ width: `${(wastageMT / rawQtyMT) * 100}%` }}>W</div>}
          </div>
        </div>

        {/* ═══ SECTION E: By-Product Economics ═══ */}
        <div className="border-x border-gray-200">
          <div className="px-6 py-2 bg-gray-50 border-t border-gray-200">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Section E — By-Product Recovery & Value</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#065f46' }}>
                <th className="text-left px-6 py-2 text-xs font-bold text-white uppercase">By-Product</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Qty (kg)</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Yield %</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Rate / kg</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Value (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {byProducts.map((bp, idx) => (
                <tr key={bp.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-2 font-medium text-gray-900">{bp.type}</td>
                  <td className="px-6 py-2 text-right text-gray-700">{bp.qty > 0 ? Math.round(bp.qtyKG).toLocaleString() : '—'}</td>
                  <td className="px-6 py-2 text-right text-gray-600">{bp.qty > 0 ? bp.yieldPct + '%' : '—'}</td>
                  <td className="px-6 py-2 text-right text-gray-600">{fmtPKR(bp.rate / 1000)}</td>
                  <td className="px-6 py-2 text-right font-medium text-emerald-700">{bp.value > 0 ? fmtPKR(bp.value) : '—'}</td>
                </tr>
              ))}
              <tr className="bg-gray-50">
                <td className="px-6 py-1.5 text-gray-500 italic">Wastage / Loss</td>
                <td className="px-6 py-1.5 text-right text-red-600">{wastageMT > 0 ? Math.round(wastageMT * 1000).toLocaleString() : '—'}</td>
                <td className="px-6 py-1.5 text-right text-red-500">{rawQtyMT > 0 && wastageMT > 0 ? (wastageMT / rawQtyMT * 100).toFixed(1) + '%' : '—'}</td>
                <td className="px-6 py-1.5 text-right text-gray-400">—</td>
                <td className="px-6 py-1.5 text-right text-gray-400">—</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-emerald-300 bg-emerald-50">
                <td className="px-6 py-2 font-bold text-emerald-900">Total By-Product Value (B)</td>
                <td className="px-6 py-2 text-right font-bold text-emerald-900">{Math.round(byProducts.reduce((s, bp) => s + bp.qty, 0) * 1000).toLocaleString()}</td>
                <td className="px-6 py-2"></td>
                <td className="px-6 py-2"></td>
                <td className="px-6 py-2 text-right font-bold text-emerald-900">{fmtPKR(totalByproductValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ═══ SECTION F: Final Costing Summary ═══ */}
        <div className="border-x border-t border-gray-200 px-6 py-4" style={{ backgroundColor: netCostAfterByproducts >= 0 ? '#f0fdf4' : '#fef2f2' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: H }}>Section F — Final Milling Cost Summary</p>

          {/* Net cost formula */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Total Batch Cost (A)</span><span className="font-bold text-gray-900">{fmtPKR(totalBatchCost)}</span></div>
              <div className="flex justify-between text-emerald-700"><span>Less: By-Product Recovery (B)</span><span className="font-bold">- {fmtPKR(totalByproductValue)}</span></div>
              <div className="flex justify-between border-t-2 border-gray-300 pt-2"><span className="font-bold text-gray-900">Net Cost of Finished Rice (A - B)</span><span className="text-lg font-bold text-gray-900">{fmtPKR(netCostAfterByproducts)}</span></div>
            </div>
          </div>

          {/* Per-unit costs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-3">
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Finished Rice</p><p className="text-lg font-bold text-blue-900">{Math.round(finishedKG).toLocaleString()} kg</p></div>
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Cost / KG</p><p className="text-lg font-bold text-gray-900">{fmtPKR(finalCostPerKG)}</p></div>
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Cost / Maund</p><p className="text-lg font-bold text-gray-900">{fmtPKR(finalCostPerMaund)}</p></div>
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Cost / Katta (50kg)</p><p className="text-lg font-bold text-gray-900">{fmtPKR(finalCostPerKatta)}</p></div>
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Cost / Ton</p><p className="text-lg font-bold text-gray-900">{fmtPKR(finalCostPerTon)}</p></div>
          </div>

          <p className="text-xs text-gray-600">Net amount in words: PKR {numberToWords(Math.abs(Math.round(netCostAfterByproducts)))} Only</p>
        </div>

        {/* ═══ SECTION G: Vehicle Arrivals ═══ */}
        {vehicles.length > 0 && (
          <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Section G — Vehicle Arrivals ({vehicles.length})</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-200">
                <th className="text-left py-1.5 font-semibold text-gray-500">#</th>
                <th className="text-left py-1.5 font-semibold text-gray-500">Vehicle No</th>
                <th className="text-left py-1.5 font-semibold text-gray-500">Driver</th>
                <th className="text-right py-1.5 font-semibold text-gray-500">Weight (kg)</th>
                <th className="text-left py-1.5 font-semibold text-gray-500">Date</th>
              </tr></thead>
              <tbody>
                {vehicles.map((v, i) => (
                  <tr key={v.id || i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-1.5 text-gray-500">{i + 1}</td>
                    <td className="py-1.5 font-mono font-bold text-gray-900">{v.vehicleNo || v.vehicle_no || '—'}</td>
                    <td className="py-1.5 text-gray-600">{v.driverName || v.driver_name || '—'}</td>
                    <td className="py-1.5 text-right text-gray-900">{pf(v.weight_kg) ? Math.round(pf(v.weight_kg)).toLocaleString() : '—'}</td>
                    <td className="py-1.5 text-gray-600">{fmtDate(v.arrivalDate || v.arrival_date)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-gray-200">
                <td colSpan={3} className="py-1.5 font-bold text-gray-900">Total</td>
                <td className="py-1.5 text-right font-bold text-gray-900">{Math.round(vehicles.reduce((s, v) => s + pf(v.weight_kg), 0)).toLocaleString()} kg</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        )}

        {/* ===== FOOTER ===== */}
        <div className="rounded-b-xl px-8 py-4 text-center" style={{ backgroundColor: H }}>
          <p className="text-white text-xs opacity-90">{companyProfile?.address || ''}</p>
          <p className="text-xs mt-1.5 opacity-75" style={{ color: G }}>
            {companyProfile?.phone || ''}
            {companyProfile?.phone && companyProfile?.email && ' | '}
            {companyProfile?.email || ''}
            {companyProfile?.email && companyProfile?.website && ' | '}
            {companyProfile?.website || ''}
          </p>
          {companyProfile?.ntn && (
            <p className="text-white text-xs mt-1 opacity-60">NTN: {companyProfile.ntn}</p>
          )}
        </div>
      </div>
    </>
  );
}
