import { allEquivalents, allRateEquivalents } from '../utils/unitConversion';

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString('en-PK'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

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

/**
 * Lot Costing Sheet — print-ready component showing full lot details.
 * @param {object} lot - lot data from API
 * @param {object} companyProfile - company profile
 * @param {object} linkedBatch - optional linked milling batch with vehicles/quality
 * @param {array} transactions - lot transaction ledger
 */
export default function LotCostSheet({ lot, companyProfile, linkedBatch, transactions = [], sales = [] }) {
  if (!lot) return null;

  const bw = parseFloat(lot.bagWeightKg) || 50;
  const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.grossWeightKg) || 0;
  const eq = allEquivalents(netKg, bw);
  const rateKg = parseFloat(lot.ratePerKg) || 0;
  const landedKg = parseFloat(lot.landedCostPerKg) || 0;
  const rEq = allRateEquivalents(rateKg, bw);
  const lEq = allRateEquivalents(landedKg, bw);
  const purchaseAmt = parseFloat(lot.purchaseAmount) || 0;
  const landedTotal = parseFloat(lot.landedCostTotal) || 0;

  const costItems = [
    { label: 'Purchase Amount', value: purchaseAmt },
    { label: 'Transport / Freight', value: parseFloat(lot.transportCost) || 0 },
    { label: 'Labor / Loading', value: parseFloat(lot.laborCost) || 0 },
    { label: 'Unloading', value: parseFloat(lot.unloadingCost) || 0 },
    { label: 'Packing', value: parseFloat(lot.packingCost) || 0 },
    { label: 'Other Expenses', value: parseFloat(lot.otherCost) || 0 },
    { label: 'Bag Cost', value: parseFloat(lot.totalBagCost) || 0 },
  ];
  const totalDirectCosts = costItems.reduce((s, c) => s + c.value, 0);

  const vehicles = linkedBatch?.vehicles || [];

  return (
    <>
      <style>{`@media print { body * { visibility: hidden; } .lot-cost-sheet, .lot-cost-sheet * { visibility: visible; } .lot-cost-sheet { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>

      <div className="lot-cost-sheet text-sm" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

        {/* ===== HEADER ===== */}
        <div className="rounded-t-xl px-8 py-5 flex items-center justify-between" style={{ backgroundColor: '#1e3a5f' }}>
          <div className="flex items-center gap-4">
            {companyProfile?.logo && (
              <img src={companyProfile.logo} alt="Logo" className="rounded-lg object-contain" style={{ width: 60, height: 60 }} />
            )}
            <div>
              <h1 className="text-2xl font-bold text-white tracking-wider" style={{ letterSpacing: '0.12em' }}>
                {companyProfile?.name || 'AGRI COMMODITIES'}
              </h1>
              <p className="italic text-sm mt-0.5" style={{ color: '#d4a853' }}>
                {companyProfile?.tagline || 'Serving Natural Nutrition'}
              </p>
            </div>
          </div>
          <div className="bg-white bg-opacity-95 rounded-xl px-6 py-3 text-center shadow-md">
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#1e3a5f' }}>Lot Costing Sheet</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: '#10b981' }}>{lot.lotNo}</p>
            <p className="text-xs mt-0.5" style={{ color: '#666' }}>{fmtDate(lot.purchaseDate || lot.createdAt)}</p>
          </div>
        </div>

        {/* ===== LOT INFO ===== */}
        <div className="border-x border-gray-200 px-6 py-4 grid grid-cols-4 gap-4 bg-gray-50">
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Item / Rice Type</p><p className="font-semibold text-gray-900">{lot.itemName || '—'}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Variety / Grade</p><p className="font-semibold text-gray-900">{lot.variety || '—'}{lot.grade ? ` (${lot.grade})` : ''}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Supplier</p><p className="font-semibold text-gray-900">{lot.supplierName || '—'}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Warehouse</p><p className="font-semibold text-gray-900">{lot.warehouseName || '—'}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Purchase Date</p><p className="font-semibold text-gray-900">{fmtDate(lot.purchaseDate)}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Crop Year</p><p className="font-semibold text-gray-900">{lot.cropYear || '—'}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Status</p><p className="font-semibold text-gray-900">{lot.status}</p></div>
          <div><p className="text-[10px] font-semibold text-gray-500 uppercase">Payment</p><p className={`font-semibold ${lot.paymentStatus === 'Paid' ? 'text-green-700' : 'text-red-700'}`}>{lot.paymentStatus || 'Unpaid'}</p></div>
        </div>

        {/* ===== QUALITY ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Quality Specifications</p>
          <div className="grid grid-cols-6 gap-3">
            {[['Moisture', lot.moisturePct, '%'], ['Broken', lot.brokenPct, '%'], ['Sortex', lot.sortexStatus, ''], ['Whiteness', lot.whiteness, ''],
              ['Bag Type', lot.bagType, ''], ['Bag Quality', lot.bagQuality, '']
            ].map(([l, v, u]) => (
              <div key={l}><p className="text-[10px] text-gray-500">{l}</p><p className="font-semibold text-gray-900">{v ? `${v}${u}` : '—'}</p></div>
            ))}
          </div>
        </div>

        {/* ===== QUANTITY & WEIGHT ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3" style={{ backgroundColor: '#eff6ff' }}>
          <p className="text-[10px] font-semibold text-blue-800 uppercase mb-2">Quantity & Weight</p>
          <div className="grid grid-cols-5 gap-4">
            <div><p className="text-xs text-blue-600">Total KG</p><p className="text-base font-bold text-gray-900">{eq.kg.toLocaleString()}</p></div>
            <div><p className="text-xs text-blue-600">Katta / Bags</p><p className="text-base font-bold text-gray-900">{eq.katta.toLocaleString()}</p></div>
            <div><p className="text-xs text-blue-600">Maund</p><p className="text-base font-bold text-gray-900">{eq.maund.toLocaleString()}</p></div>
            <div><p className="text-xs text-blue-600">Metric Ton</p><p className="text-base font-bold text-gray-900">{eq.ton}</p></div>
            <div><p className="text-xs text-blue-600">Total Bags</p><p className="text-base font-bold text-gray-900">{lot.totalBags || eq.katta}</p></div>
          </div>
        </div>

        {/* ===== PURCHASE PRICING ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Purchase Rate</p>
          <div className="grid grid-cols-5 gap-4">
            <div><p className="text-xs text-gray-500">Original Rate</p><p className="font-bold text-gray-900">Rs {lot.rateInputValue || '—'} / {lot.rateInputUnit || 'kg'}</p></div>
            <div><p className="text-xs text-gray-500">Per KG</p><p className="font-bold text-gray-900">{fmtPKR(rateKg)}</p></div>
            <div><p className="text-xs text-gray-500">Per Katta</p><p className="font-bold text-gray-900">{fmtPKR(rEq.perKatta)}</p></div>
            <div><p className="text-xs text-gray-500">Per Maund</p><p className="font-bold text-gray-900">{fmtPKR(rEq.perMaund)}</p></div>
            <div><p className="text-xs text-gray-500">Per Ton</p><p className="font-bold text-gray-900">{fmtPKR(rEq.perTon)}</p></div>
          </div>
        </div>

        {/* ===== COST BREAKDOWN TABLE ===== */}
        <div className="border-x border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#1e3a5f' }}>
                <th className="text-left px-6 py-2.5 text-xs font-bold text-white uppercase">Cost Item</th>
                <th className="text-right px-6 py-2.5 text-xs font-bold text-white uppercase">Amount (PKR)</th>
                <th className="text-right px-6 py-2.5 text-xs font-bold text-white uppercase">Per KG</th>
                <th className="text-right px-6 py-2.5 text-xs font-bold text-white uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {costItems.map((item, idx) => (
                <tr key={item.label} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-2 font-medium text-gray-900">{item.label}</td>
                  <td className="px-6 py-2 text-right text-gray-700">{fmtPKR(item.value)}</td>
                  <td className="px-6 py-2 text-right text-gray-500">{netKg > 0 ? fmtPKR(item.value / netKg) : '—'}</td>
                  <td className="px-6 py-2 text-right text-gray-500">{totalDirectCosts > 0 ? ((item.value / totalDirectCosts) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-6 py-2.5 font-bold text-gray-900">Total Landed Cost</td>
                <td className="px-6 py-2.5 text-right font-bold text-gray-900">{fmtPKR(landedTotal || totalDirectCosts)}</td>
                <td className="px-6 py-2.5 text-right font-bold text-gray-900">{fmtPKR(landedKg)}</td>
                <td className="px-6 py-2.5 text-right font-bold text-gray-900">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ===== LANDED COST IN ALL UNITS ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3" style={{ backgroundColor: '#fffbeb' }}>
          <p className="text-[10px] font-semibold text-amber-800 uppercase mb-2">Landed Cost Per Unit</p>
          <div className="grid grid-cols-5 gap-4">
            <div><p className="text-xs text-amber-600">Total</p><p className="text-base font-bold text-gray-900">{fmtPKR(landedTotal || totalDirectCosts)}</p></div>
            <div><p className="text-xs text-amber-600">Per KG</p><p className="text-base font-bold text-gray-900">{fmtPKR(landedKg)}</p></div>
            <div><p className="text-xs text-amber-600">Per Katta</p><p className="text-base font-bold text-gray-900">{fmtPKR(lEq.perKatta)}</p></div>
            <div><p className="text-xs text-amber-600">Per Maund</p><p className="text-base font-bold text-gray-900">{fmtPKR(lEq.perMaund)}</p></div>
            <div><p className="text-xs text-amber-600">Per Ton</p><p className="text-base font-bold text-gray-900">{fmtPKR(lEq.perTon)}</p></div>
          </div>
          <p className="mt-2 text-xs text-gray-600">Amount in words: PKR {numberToWords(Math.round(landedTotal || totalDirectCosts))} Only</p>
        </div>

        {/* ===== VEHICLE ARRIVALS ===== */}
        {vehicles.length > 0 && (
          <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Vehicle Arrivals ({vehicles.length})</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1.5 font-semibold text-gray-500">Vehicle No</th>
                  <th className="text-left py-1.5 font-semibold text-gray-500">Driver</th>
                  <th className="text-right py-1.5 font-semibold text-gray-500">Weight (MT)</th>
                  <th className="text-left py-1.5 font-semibold text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v, i) => (
                  <tr key={v.id || i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-1.5 font-mono font-bold text-gray-900">{v.vehicleNo}</td>
                    <td className="py-1.5 text-gray-600">{v.driverName || '—'}</td>
                    <td className="py-1.5 text-right text-gray-900">{v.weightMT || '—'}</td>
                    <td className="py-1.5 text-gray-600">{fmtDate(v.arrivalDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 font-bold text-gray-900" colSpan={2}>Total</td>
                  <td className="py-1.5 text-right font-bold text-gray-900">{vehicles.reduce((s, v) => s + (v.weightMT || 0), 0).toFixed(1)} MT</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ===== STOCK STATUS ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Current Stock Status</p>
          <div className="grid grid-cols-5 gap-4">
            {[
              ['Total', netKg, 'text-gray-900'],
              ['Available', (parseFloat(lot.availableQty) || 0) * 1000, 'text-emerald-700'],
              ['Reserved', (parseFloat(lot.reservedQty) || 0) * 1000, 'text-amber-700'],
              ['Sold', parseFloat(lot.soldWeightKg) || 0, 'text-blue-700'],
              ['Damaged', parseFloat(lot.damagedWeightKg) || 0, 'text-red-700'],
            ].map(([label, kg, color]) => (
              <div key={label}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`font-bold ${color}`}>{Math.round(kg).toLocaleString()} KG</p>
                <p className="text-[10px] text-gray-400">{Math.round(kg / bw)} katta</p>
              </div>
            ))}
          </div>
        </div>

        {/* ===== SALES REVENUE & PROFITABILITY ===== */}
        {(() => {
          const hasSales = sales.length > 0;
          const totalSaleRevenue = sales.reduce((s, sale) => s + (parseFloat(sale.total_amount) || 0), 0);
          const totalSaleCost = sales.reduce((s, sale) => s + (parseFloat(sale.landed_cost_total) || 0), 0);
          const totalSaleProfit = sales.reduce((s, sale) => s + (parseFloat(sale.gross_profit) || 0), 0);
          const totalSaleKg = sales.reduce((s, sale) => s + (parseFloat(sale.quantity_kg) || 0), 0);
          const avgSaleRate = totalSaleKg > 0 ? totalSaleRevenue / totalSaleKg : 0;
          const profitPerKg = totalSaleKg > 0 ? totalSaleProfit / totalSaleKg : 0;

          return (
            <>
              <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
                <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Sales Revenue</p>
                {hasSales ? (
                  <>
                    <table className="w-full text-xs mb-3">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1.5 font-semibold text-gray-500">Sale No</th>
                          <th className="text-left py-1.5 font-semibold text-gray-500">Buyer</th>
                          <th className="text-left py-1.5 font-semibold text-gray-500">Date</th>
                          <th className="text-right py-1.5 font-semibold text-gray-500">Qty (KG)</th>
                          <th className="text-right py-1.5 font-semibold text-gray-500">Rate/KG</th>
                          <th className="text-right py-1.5 font-semibold text-gray-500">Revenue</th>
                          <th className="text-right py-1.5 font-semibold text-gray-500">Cost</th>
                          <th className="text-right py-1.5 font-semibold text-gray-500">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.map((sale, i) => (
                          <tr key={sale.id || i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                            <td className="py-1.5 font-mono font-bold text-gray-900">{sale.sale_no || sale.saleNo}</td>
                            <td className="py-1.5 text-gray-600">{sale.customer_name || sale.customerName || sale.buyer_name || sale.buyerName || '—'}</td>
                            <td className="py-1.5 text-gray-600">{fmtDate(sale.sale_date || sale.saleDate)}</td>
                            <td className="py-1.5 text-right text-gray-900">{Math.round(parseFloat(sale.quantity_kg || sale.quantityKg) || 0).toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-900">{fmtPKR(sale.rate_per_kg || sale.ratePerKg)}</td>
                            <td className="py-1.5 text-right font-medium text-gray-900">{fmtPKR(sale.total_amount || sale.totalAmount)}</td>
                            <td className="py-1.5 text-right text-gray-600">{fmtPKR(sale.landed_cost_total || sale.landedCostTotal)}</td>
                            <td className={`py-1.5 text-right font-bold ${(parseFloat(sale.gross_profit || sale.grossProfit) || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {fmtPKR(sale.gross_profit || sale.grossProfit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200">
                          <td colSpan={3} className="py-1.5 font-bold text-gray-900">Total</td>
                          <td className="py-1.5 text-right font-bold">{Math.round(totalSaleKg).toLocaleString()}</td>
                          <td className="py-1.5 text-right font-bold">{fmtPKR(avgSaleRate)}</td>
                          <td className="py-1.5 text-right font-bold">{fmtPKR(totalSaleRevenue)}</td>
                          <td className="py-1.5 text-right font-bold">{fmtPKR(totalSaleCost)}</td>
                          <td className={`py-1.5 text-right font-bold ${totalSaleProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(totalSaleProfit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 italic">No sales recorded from this lot yet.</p>
                )}
              </div>

              {/* Profitability Summary */}
              {hasSales && (
                <div className="border-x border-t border-gray-200 px-6 py-4" style={{ backgroundColor: totalSaleProfit >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                  <p className="text-[10px] font-semibold uppercase mb-3" style={{ color: totalSaleProfit >= 0 ? '#166534' : '#991b1b' }}>
                    Lot Profitability Summary
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div><p className="text-xs text-gray-500">Total Revenue</p><p className="text-base font-bold text-gray-900">{fmtPKR(totalSaleRevenue)}</p></div>
                    <div><p className="text-xs text-gray-500">Total Landed Cost</p><p className="text-base font-bold text-gray-900">{fmtPKR(totalSaleCost || landedTotal)}</p></div>
                    <div><p className="text-xs text-gray-500">Gross Profit</p><p className={`text-base font-bold ${totalSaleProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(totalSaleProfit)}</p></div>
                    <div><p className="text-xs text-gray-500">Profit / KG</p><p className={`text-base font-bold ${profitPerKg >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(profitPerKg)}</p></div>
                    <div><p className="text-xs text-gray-500">Profit / Maund</p><p className={`text-base font-bold ${profitPerKg >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(profitPerKg * 40)}</p></div>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    Profit in words: PKR {numberToWords(Math.abs(Math.round(totalSaleProfit)))} {totalSaleProfit < 0 ? '(Loss)' : 'Only'}
                  </p>
                </div>
              )}
            </>
          );
        })()}

        {/* ===== PAYMENT STATUS ===== */}
        <div className="border-x border-t border-gray-200 px-6 py-3 bg-white">
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Payment Summary</p>
          <div className="grid grid-cols-3 gap-4">
            <div><p className="text-xs text-gray-500">Total Due</p><p className="font-bold text-gray-900">{fmtPKR(landedTotal || purchaseAmt)}</p></div>
            <div><p className="text-xs text-emerald-600">Paid</p><p className="font-bold text-emerald-700">{fmtPKR(lot.paidAmount)}</p></div>
            <div><p className="text-xs text-red-600">Outstanding</p><p className="font-bold text-red-700">{fmtPKR(lot.dueAmount)}</p></div>
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="rounded-b-xl px-8 py-4 text-center" style={{ backgroundColor: '#1e3a5f' }}>
          <p className="text-white text-xs opacity-90">{companyProfile?.address || ''}</p>
          <p className="text-xs mt-1.5 opacity-75" style={{ color: '#d4a853' }}>
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
