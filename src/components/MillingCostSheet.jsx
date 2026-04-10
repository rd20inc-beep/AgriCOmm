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

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString('en-PK'); }
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
  bran: 22400,
  husk: 8400,
};

export default function MillingCostSheet({ batch, companyProfile, millingCostCategories, vehicles = [], byproductRates = DEFAULT_BYPRODUCT_RATES }) {
  if (!batch) return null;

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

  // Auto-populate rawRice from quality sheet if not manually set
  const rawRiceCostFromSheet = rawMaterialCost;
  const rawRiceCostManual = pf(safeCosts.rawRice);
  const effectiveRawRiceCost = rawRiceCostManual > 0 ? rawRiceCostManual : rawRiceCostFromSheet;

  const processCostTotal = processCats.reduce((s, c) => s + pf(safeCosts[c.key]), 0);
  const overheadCostTotal = overheadCats.reduce((s, c) => s + pf(safeCosts[c.key]), 0);
  const totalBatchCost = effectiveRawRiceCost + processCostTotal + overheadCostTotal;

  // ═══ SECTION D: Yield Output ═══
  const finishedMT = pf(batch.actualFinishedMT);
  const finishedKG = finishedMT * 1000;
  const finishedYieldPct = rawQtyMT > 0 ? (finishedMT / rawQtyMT * 100).toFixed(1) : '0.0';

  // ═══ SECTION E: All Output Products (only those with qty > 0) ═══
  const allOutputProducts = [
    { type: 'Finished Rice', key: 'finished', qty: finishedMT, ratePerKG: finishedKG > 0 ? totalBatchCost / finishedKG : 0, color: 'bg-blue-500', isMain: true },
    { type: 'B1 (Large Broken)', key: 'b1', qty: pf(batch.b1MT), ratePerKG: pf(byproductRates.broken) / 1000, color: 'bg-amber-500' },
    { type: 'B2 (Medium Broken)', key: 'b2', qty: pf(batch.b2MT), ratePerKG: pf(byproductRates.broken) * 0.8 / 1000, color: 'bg-amber-400' },
    { type: 'B3 (Small Broken)', key: 'b3', qty: pf(batch.b3MT), ratePerKG: pf(byproductRates.broken) * 0.6 / 1000, color: 'bg-amber-300' },
    { type: 'CSR (Sortex Reject)', key: 'csr', qty: pf(batch.csrMT), ratePerKG: pf(byproductRates.broken) * 0.5 / 1000, color: 'bg-orange-400' },
    { type: 'Short Grain', key: 'shortGrain', qty: pf(batch.shortGrainMT), ratePerKG: pf(byproductRates.broken) * 0.7 / 1000, color: 'bg-yellow-500' },
    { type: 'Rice Bran / Polish', key: 'bran', qty: pf(batch.branMT), ratePerKG: pf(byproductRates.bran) / 1000, color: 'bg-green-500' },
    { type: 'Rice Husk / Bhusa', key: 'husk', qty: pf(batch.huskMT), ratePerKG: pf(byproductRates.husk) / 1000, color: 'bg-purple-500' },
  ].filter(p => p.qty > 0).map(p => ({
    ...p,
    qtyKG: p.qty * 1000,
    value: p.qty * 1000 * p.ratePerKG,
    yieldPct: rawQtyMT > 0 ? (p.qty / rawQtyMT * 100).toFixed(1) : '0.0',
  }));
  const byProducts = allOutputProducts.filter(p => !p.isMain);
  const wastageMT = pf(batch.wastageMT);
  const totalByproductValue = byProducts.reduce((s, bp) => s + bp.value, 0);
  const totalOutputMT = allOutputProducts.reduce((s, p) => s + p.qty, 0) + wastageMT;
  const totalRecoveryPct = rawQtyMT > 0 ? (totalOutputMT / rawQtyMT * 100).toFixed(1) : '0.0';

  // ═══ SECTION F: Final Costing ═══
  const netCostAfterByproducts = totalBatchCost - totalByproductValue;
  const finalCostPerKG = finishedKG > 0 ? netCostAfterByproducts / finishedKG : 0;
  const finalCostPerMaund = finalCostPerKG * 40;
  const finalCostPerKatta = finalCostPerKG * 50;
  const finalCostPerTon = finalCostPerKG * 1000;
  const costPerMT = rawQtyMT > 0 ? totalBatchCost / rawQtyMT : 0;

  const H = '#1e3a5f'; // header color
  const G = '#d4a853'; // gold accent

  return (
    <>
      <style>{`@media print { body * { visibility: hidden; } .cost-sheet, .cost-sheet * { visibility: visible; } .cost-sheet { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>

      <div className="cost-sheet text-sm" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

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
            <div><p className="text-[10px] text-gray-500">Supplier</p><p className="font-semibold text-gray-900">{batch.supplierName || '—'}</p></div>
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
          <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-2">Section B — Raw Material Buying Cost {inputPriceMT > 0 ? '(Auto-populated from Quality Sheet)' : '(Manual Entry)'}</p>
          <div className="grid grid-cols-5 gap-4">
            <div><p className="text-xs text-amber-700">Input Quantity</p><p className="text-base font-bold text-gray-900">{rawQtyMT} MT</p><p className="text-[10px] text-gray-500">{rawQtyKG.toLocaleString()} KG</p></div>
            <div><p className="text-xs text-amber-700">{safeSample?.pricePerMT ? 'Sample Price' : 'Rate'}</p><p className="text-base font-bold text-gray-900">{safeSample?.pricePerMT ? fmtPKR(safeSample.pricePerMT) : '—'}<span className="text-xs font-normal text-gray-500"> /MT</span></p></div>
            <div><p className="text-xs text-amber-700">{safeArrival?.pricePerMT ? 'Agreed/Arrival Price' : 'Agreed Price'}</p><p className="text-base font-bold text-blue-900">{inputPriceMT > 0 ? fmtPKR(inputPriceMT) : '—'}<span className="text-xs font-normal text-gray-500"> /MT</span></p></div>
            <div><p className="text-xs text-amber-700">Rate per KG</p><p className="text-base font-bold text-gray-900">{inputPriceKG > 0 ? fmtPKR(inputPriceKG) : '—'}</p></div>
            <div><p className="text-xs text-amber-700">Total Raw Material Cost</p><p className="text-base font-bold text-gray-900">{rawMaterialCost > 0 ? fmtPKR(rawMaterialCost) : fmtPKR(effectiveRawRiceCost)}</p></div>
          </div>
          {rawRiceCostManual > 0 && rawMaterialCost > 0 && Math.abs(rawRiceCostManual - rawMaterialCost) > 100 && (
            <p className="mt-2 text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1">
              Note: Manual cost entry ({fmtPKR(rawRiceCostManual)}) differs from quality sheet ({fmtPKR(rawMaterialCost)}). Using manual entry.
            </p>
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
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Per KG (Raw)</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {/* Raw material row */}
              <tr className="bg-amber-50 border-b border-amber-100">
                <td className="px-6 py-2 font-semibold text-amber-900">Raw Rice / Paddy Purchase</td>
                <td className="px-6 py-2 text-right font-bold text-amber-900">{fmtPKR(effectiveRawRiceCost)}</td>
                <td className="px-6 py-2 text-right text-amber-700">{rawQtyKG > 0 ? fmtPKR(effectiveRawRiceCost / rawQtyKG) : '—'}</td>
                <td className="px-6 py-2 text-right text-amber-700">{totalBatchCost > 0 ? ((effectiveRawRiceCost / totalBatchCost) * 100).toFixed(1) : '—'}%</td>
              </tr>
              {/* Process costs */}
              {processCats.map((cat, idx) => {
                const v = pf(safeCosts[cat.key]);
                return (
                  <tr key={cat.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-1.5 text-gray-900">{cat.label}</td>
                    <td className="px-6 py-1.5 text-right text-gray-700">{v > 0 ? fmtPKR(v) : '—'}</td>
                    <td className="px-6 py-1.5 text-right text-gray-500">{v > 0 && rawQtyKG > 0 ? fmtPKR(v / rawQtyKG) : '—'}</td>
                    <td className="px-6 py-1.5 text-right text-gray-500">{v > 0 && totalBatchCost > 0 ? ((v / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                );
              })}
              {/* Overhead costs */}
              {overheadCats.map((cat, idx) => {
                const v = pf(safeCosts[cat.key]);
                return v > 0 ? (
                  <tr key={cat.key} className="bg-gray-50">
                    <td className="px-6 py-1.5 text-gray-700 italic">{cat.label}</td>
                    <td className="px-6 py-1.5 text-right text-gray-600">{fmtPKR(v)}</td>
                    <td className="px-6 py-1.5 text-right text-gray-500">{rawQtyMT > 0 ? fmtPKR(v / rawQtyMT) : '—'}</td>
                    <td className="px-6 py-1.5 text-right text-gray-500">{totalBatchCost > 0 ? ((v / totalBatchCost) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-6 py-2 font-bold text-gray-900">Total Batch Cost (A)</td>
                <td className="px-6 py-2 text-right font-bold text-gray-900">{fmtPKR(totalBatchCost)}</td>
                <td className="px-6 py-2 text-right font-semibold text-gray-700">{rawQtyKG > 0 ? fmtPKR(totalBatchCost / rawQtyKG) : '—'}<span className="text-[10px] font-normal"> /KG</span></td>
                <td className="px-6 py-2 text-right font-bold text-gray-900">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ═══ SECTION D: Yield / Output ═══ */}
        <div className="border-x border-t border-gray-200 px-6 py-3" style={{ backgroundColor: '#eff6ff' }}>
          <p className="text-[10px] font-bold text-blue-800 uppercase tracking-widest mb-2">Section D — Milling Yield & Output</p>
          <div className="grid grid-cols-5 gap-4 mb-3">
            <div><p className="text-xs text-blue-600">Raw Input</p><p className="text-base font-bold text-gray-900">{rawQtyMT} MT</p></div>
            <div><p className="text-xs text-blue-600">Finished Rice</p><p className="text-base font-bold text-blue-900">{finishedMT} MT</p></div>
            <div><p className="text-xs text-blue-600">Yield %</p><p className={`text-base font-bold ${pf(finishedYieldPct) >= 65 ? 'text-green-700' : 'text-red-700'}`}>{finishedYieldPct}%</p></div>
            <div><p className="text-xs text-blue-600">Total Output</p><p className="text-base font-bold text-gray-900">{totalOutputMT.toFixed(1)} MT</p></div>
            <div><p className="text-xs text-blue-600">Recovery %</p><p className={`text-base font-bold ${pf(totalRecoveryPct) > 100 ? 'text-red-700' : 'text-green-700'}`}>{totalRecoveryPct}%</p>
              {pf(totalRecoveryPct) > 100.5 && <p className="text-[10px] text-red-600">⚠ Exceeds 100%</p>}
            </div>
          </div>

          {/* Yield breakdown bar */}
          <div className="flex rounded overflow-hidden h-5 mb-2">
            {allOutputProducts.map(p => (
              <div key={p.key} className={`${p.color} flex items-center justify-center text-white text-[9px] font-bold`} style={{ width: `${(p.qty / rawQtyMT) * 100}%` }}>{p.yieldPct}%</div>
            ))}
            {wastageMT > 0 && <div className="bg-red-400 flex items-center justify-center text-white text-[9px] font-bold" style={{ width: `${(wastageMT / rawQtyMT) * 100}%` }}>W</div>}
          </div>
        </div>

        {/* ═══ SECTION E: Output Products & Values ═══ */}
        <div className="border-x border-gray-200">
          <div className="px-6 py-2 bg-gray-50 border-t border-gray-200">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Section E — Output Products & Market Value</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#065f46' }}>
                <th className="text-left px-6 py-2 text-xs font-bold text-white uppercase">Product</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Qty (KG)</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Yield %</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Rate / KG</th>
                <th className="text-right px-6 py-2 text-xs font-bold text-white uppercase">Total Value (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {allOutputProducts.map((p, idx) => (
                <tr key={p.key} className={p.isMain ? 'bg-blue-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className={`px-6 py-2 font-medium ${p.isMain ? 'text-blue-900 font-bold' : 'text-gray-900'}`}>{p.type}</td>
                  <td className="px-6 py-2 text-right text-gray-700">{p.qtyKG.toLocaleString()}</td>
                  <td className="px-6 py-2 text-right text-gray-600">{p.yieldPct}%</td>
                  <td className="px-6 py-2 text-right text-gray-600">{fmtPKR(p.ratePerKG)}</td>
                  <td className={`px-6 py-2 text-right font-medium ${p.isMain ? 'text-blue-800 font-bold' : 'text-green-700'}`}>{fmtPKR(p.value)}</td>
                </tr>
              ))}
              {wastageMT > 0 && (
                <tr className="bg-gray-50">
                  <td className="px-6 py-1.5 text-gray-500 italic">Wastage / Sweeping</td>
                  <td className="px-6 py-1.5 text-right text-red-600">{(wastageMT * 1000).toLocaleString()}</td>
                  <td className="px-6 py-1.5 text-right text-red-500">{rawQtyMT > 0 ? (wastageMT / rawQtyMT * 100).toFixed(1) + '%' : '—'}</td>
                  <td className="px-6 py-1.5 text-right text-gray-400">—</td>
                  <td className="px-6 py-1.5 text-right text-gray-400">—</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-green-300 bg-green-50">
                <td className="px-6 py-2 font-bold text-green-900">Total By-Product Recovery (B)</td>
                <td className="px-6 py-2 text-right font-bold text-green-900">{byProducts.reduce((s, bp) => s + bp.qtyKG, 0).toLocaleString()}</td>
                <td className="px-6 py-2"></td>
                <td className="px-6 py-2"></td>
                <td className="px-6 py-2 text-right font-bold text-green-900">{fmtPKR(totalByproductValue)}</td>
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
              <div className="flex justify-between text-green-700"><span>Less: By-Product Recovery (B)</span><span className="font-bold">- {fmtPKR(totalByproductValue)}</span></div>
              <div className="flex justify-between border-t-2 border-gray-300 pt-2"><span className="font-bold text-gray-900">Net Cost of Finished Rice (A - B)</span><span className="text-lg font-bold text-gray-900">{fmtPKR(netCostAfterByproducts)}</span></div>
            </div>
          </div>

          {/* Per-unit costs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-3">
            <div className="bg-white rounded-lg border p-3 text-center"><p className="text-[10px] text-gray-500 uppercase">Finished Rice</p><p className="text-lg font-bold text-blue-900">{finishedMT} MT</p></div>
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
                <th className="text-right py-1.5 font-semibold text-gray-500">Weight (MT)</th>
                <th className="text-left py-1.5 font-semibold text-gray-500">Date</th>
              </tr></thead>
              <tbody>
                {vehicles.map((v, i) => (
                  <tr key={v.id || i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-1.5 text-gray-500">{i + 1}</td>
                    <td className="py-1.5 font-mono font-bold text-gray-900">{v.vehicleNo || v.vehicle_no || '—'}</td>
                    <td className="py-1.5 text-gray-600">{v.driverName || v.driver_name || '—'}</td>
                    <td className="py-1.5 text-right text-gray-900">{pf(v.weightMT || v.weight_mt) || '—'}</td>
                    <td className="py-1.5 text-gray-600">{fmtDate(v.arrivalDate || v.arrival_date)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-gray-200">
                <td colSpan={3} className="py-1.5 font-bold text-gray-900">Total</td>
                <td className="py-1.5 text-right font-bold text-gray-900">{vehicles.reduce((s, v) => s + pf(v.weightMT || v.weight_mt), 0).toFixed(1)} MT</td>
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
