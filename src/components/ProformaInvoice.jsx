import React from 'react';

/**
 * Number-to-words converter for currency amounts (USD).
 */
function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 1000000000) return convert(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + convert(n % 1000000) : '');
    return convert(Math.floor(n / 1000000000)) + ' Billion' + (n % 1000000000 ? ' ' + convert(n % 1000000000) : '');
  }

  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  let result = convert(intPart);
  if (decPart > 0) {
    result += ' and ' + convert(decPart) + ' Cents';
  }
  return result + ' Only';
}

/**
 * ProformaInvoice - A print-ready proforma invoice preview component.
 *
 * @param {object} props.order - Export order object
 * @param {object} props.companyProfile - Company profile with bank details
 */
export default function ProformaInvoice({ order, companyProfile }) {
  const piNumber = 'PI-' + (order.id || '').replace('EX-', '');
  const invoiceDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const qtyMT = parseFloat(order.qtyMT) || 0;
  const pricePerMT = parseFloat(order.pricePerMT) || 0;
  const advancePct = parseFloat(order.advancePct) || 0;
  const totalAmount = parseFloat(order.contractValue) || qtyMT * pricePerMT;
  const advanceAmount = parseFloat(order.advanceExpected) || (totalAmount * advancePct) / 100;
  const balancePct = 100 - advancePct;
  const bagSizeKg = order.bagSizeKg || 25;
  const bags = Math.round((qtyMT * 1000) / bagSizeKg);
  const containers = Math.ceil(qtyMT / 26);
  const hasBagSpec = order.bagType || order.bagQuality;
  const currency = order.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '\u20AC' : currency;

  const formatCurrency = (val) =>
    currencySymbol + (parseFloat(val) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const shipmentText = order.shipmentETA
    ? new Date(order.shipmentETA).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'PROMPT';

  const bank = companyProfile?.bank || {};

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .proforma-invoice, .proforma-invoice * { visibility: visible; }
          .proforma-invoice {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      <div className="proforma-invoice bg-white max-w-4xl mx-auto shadow-lg" style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>

        {/* ===== 1. HEADER BAR ===== */}
        <div className="flex items-center justify-between px-8 py-5" style={{ backgroundColor: '#1e3a5f' }}>
          {/* Left: Logo + Company Name */}
          <div className="flex items-center gap-4">
            {companyProfile?.logo && (
              <img
                src={companyProfile.logo}
                alt="Company Logo"
                className="rounded-lg object-contain"
                style={{ width: 60, height: 60 }}
              />
            )}
            <div>
              <h1 className="text-white text-2xl font-bold tracking-wider" style={{ letterSpacing: '0.12em' }}>
                {companyProfile?.name || 'AGRI COMMODITIES'}
              </h1>
              <p className="italic text-sm mt-0.5" style={{ color: '#d4a853' }}>
                {companyProfile?.tagline || 'Serving Natural Nutrition'}
              </p>
            </div>
          </div>

          {/* Right: Invoice badge */}
          <div className="bg-white bg-opacity-95 rounded-xl px-6 py-3 text-center shadow-md">
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#1e3a5f' }}>
              Proforma Invoice
            </p>
            <p className="text-lg font-bold mt-0.5" style={{ color: '#10b981' }}>
              {piNumber}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#666' }}>
              {invoiceDate}
            </p>
          </div>
        </div>

        {/* ===== 2. BILL TO + BANK DETAILS ===== */}
        <div className="grid grid-cols-2 gap-5 px-8 py-5">
          {/* Bill To */}
          <div className="rounded-lg border p-5" style={{ borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}>
            <h3 className="text-xs font-bold tracking-widest uppercase mb-3 pb-2 border-b" style={{ color: '#1e3a5f', borderColor: '#e2e8f0' }}>
              Bill To / Consignee
            </h3>
            <p className="font-bold text-base" style={{ color: '#1e3a5f' }}>
              {order.customerName}
            </p>
            <p className="text-sm mt-1" style={{ color: '#64748b' }}>
              {order.country}
            </p>
          </div>

          {/* Bank Details */}
          <div className="rounded-lg border p-5" style={{ borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}>
            <h3 className="text-xs font-bold tracking-widest uppercase mb-3 pb-2 border-b" style={{ color: '#1e3a5f', borderColor: '#e2e8f0' }}>
              Bank Details
            </h3>
            <table className="text-sm w-full" style={{ color: '#334155' }}>
              <tbody>
                <tr>
                  <td className="py-0.5 pr-3 font-medium whitespace-nowrap" style={{ color: '#64748b' }}>Bank:</td>
                  <td className="py-0.5 font-semibold">{bank.name}</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-3 font-medium whitespace-nowrap" style={{ color: '#64748b' }}>A/C No:</td>
                  <td className="py-0.5">{bank.account}</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-3 font-medium whitespace-nowrap" style={{ color: '#64748b' }}>Branch:</td>
                  <td className="py-0.5">{bank.branch}</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-3 font-medium whitespace-nowrap" style={{ color: '#64748b' }}>SWIFT:</td>
                  <td className="py-0.5">{bank.swift}</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-3 font-medium whitespace-nowrap" style={{ color: '#64748b' }}>IBAN:</td>
                  <td className="py-0.5 text-xs">{bank.iban}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 3. SHIPMENT INFO BAR ===== */}
        <div className="mx-8 rounded-lg grid grid-cols-5 text-center text-white text-xs" style={{ backgroundColor: '#2d5a87' }}>
          <div className="py-3 px-2 border-r border-white border-opacity-20">
            <p className="uppercase tracking-wider font-medium opacity-80 mb-1">Payment Terms</p>
            <p className="font-bold text-sm">{advancePct}% Advance</p>
            <p className="opacity-80">{balancePct}% Against BL</p>
          </div>
          <div className="py-3 px-2 border-r border-white border-opacity-20">
            <p className="uppercase tracking-wider font-medium opacity-80 mb-1">Loading Port</p>
            <p className="font-bold text-sm">Karachi</p>
            <p className="opacity-80">Pakistan</p>
          </div>
          <div className="py-3 px-2 border-r border-white border-opacity-20">
            <p className="uppercase tracking-wider font-medium opacity-80 mb-1">Shipment</p>
            <p className="font-bold text-sm">{shipmentText}</p>
          </div>
          <div className="py-3 px-2 border-r border-white border-opacity-20">
            <p className="uppercase tracking-wider font-medium opacity-80 mb-1">Containers</p>
            <p className="font-bold text-sm">{containers} x 20' FCL</p>
          </div>
          <div className="py-3 px-2">
            <p className="uppercase tracking-wider font-medium opacity-80 mb-1">Incoterm</p>
            <p className="font-bold text-sm">{order.incoterm || 'FOB'}</p>
          </div>
        </div>

        {/* ===== 4. PRODUCT TABLE ===== */}
        <div className="px-8 py-5">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ backgroundColor: '#1e3a5f' }}>
                <th className="text-white text-left py-3 px-4 rounded-tl-lg font-semibold" style={{ width: '6%' }}>S.No</th>
                <th className="text-white text-left py-3 px-4 font-semibold" style={{ width: '30%' }}>Description</th>
                <th className="text-white text-center py-3 px-4 font-semibold" style={{ width: '10%' }}>Bag</th>
                <th className="text-white text-center py-3 px-4 font-semibold" style={{ width: '12%' }}>Bags</th>
                <th className="text-white text-center py-3 px-4 font-semibold" style={{ width: '12%' }}>Wt (MT)</th>
                <th className="text-white text-right py-3 px-4 font-semibold" style={{ width: '14%' }}>Rate/MT</th>
                <th className="text-white text-right py-3 px-4 rounded-tr-lg font-semibold" style={{ width: '16%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {/* Product Row */}
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <td className="py-3 px-4 border-b" style={{ borderColor: '#e2e8f0', color: '#334155' }}>1</td>
                <td className="py-3 px-4 border-b font-semibold" style={{ borderColor: '#e2e8f0', color: '#1e3a5f' }}>
                  {order.productName}
                </td>
                <td className="py-3 px-4 border-b text-center" style={{ borderColor: '#e2e8f0', color: '#334155' }}>{bagSizeKg} KG</td>
                <td className="py-3 px-4 border-b text-center font-medium" style={{ borderColor: '#e2e8f0', color: '#334155' }}>
                  {bags.toLocaleString()}
                </td>
                <td className="py-3 px-4 border-b text-center font-medium" style={{ borderColor: '#e2e8f0', color: '#334155' }}>
                  {qtyMT.toLocaleString()}
                </td>
                <td className="py-3 px-4 border-b text-right" style={{ borderColor: '#e2e8f0', color: '#334155' }}>
                  {formatCurrency(pricePerMT)}
                </td>
                <td className="py-3 px-4 border-b text-right font-bold" style={{ borderColor: '#e2e8f0', color: '#1e3a5f' }}>
                  {formatCurrency(totalAmount)}
                </td>
              </tr>

              {/* Subtotal Row */}
              <tr>
                <td colSpan={5} />
                <td className="py-3 px-4 text-right font-bold border-b" style={{ borderColor: '#e2e8f0', color: '#1e3a5f' }}>
                  Subtotal:
                </td>
                <td className="py-3 px-4 text-right font-bold border-b" style={{ borderColor: '#e2e8f0', color: '#1e3a5f' }}>
                  {formatCurrency(totalAmount)}
                </td>
              </tr>

              {/* Advance Payment Row */}
              <tr>
                <td colSpan={5} />
                <td
                  className="py-3 px-4 text-right font-bold text-white rounded-bl-lg"
                  style={{ backgroundColor: '#10b981' }}
                >
                  Advance ({advancePct}%):
                </td>
                <td
                  className="py-3 px-4 text-right font-bold text-white rounded-br-lg"
                  style={{ backgroundColor: '#10b981' }}
                >
                  {formatCurrency(advanceAmount)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Amount in Words */}
          <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <p className="text-xs" style={{ color: '#64748b' }}>
              <span className="font-semibold" style={{ color: '#1e3a5f' }}>Amount in Words: </span>
              {currency} {numberToWords(totalAmount)}
            </p>
          </div>
        </div>

        {/* ===== 4B. PACKING SPECIFICATION ===== */}
        {hasBagSpec && (
          <div className="px-8 pb-2">
            <div className="rounded-lg border p-4" style={{ borderColor: '#e2e8f0', backgroundColor: '#fffbeb' }}>
              <h3 className="text-xs font-bold tracking-widest uppercase mb-3 pb-2 border-b" style={{ color: '#92400e', borderColor: '#fde68a' }}>
                Packing Specification
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                {order.bagType && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Bag Type</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagType}</p>
                  </div>
                )}
                {order.bagQuality && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Bag Quality</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagQuality}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium" style={{ color: '#92400e' }}>Bag Size</p>
                  <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{bagSizeKg} KG</p>
                </div>
                {order.bagWeightGm && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Bag Weight</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagWeightGm} gm</p>
                  </div>
                )}
                {order.bagPrinting && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Printing</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagPrinting}</p>
                  </div>
                )}
                {order.bagColor && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Bag Color</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagColor}</p>
                  </div>
                )}
                {order.bagBrand && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#92400e' }}>Brand / Marking</p>
                    <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{order.bagBrand}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium" style={{ color: '#92400e' }}>Total Bags</p>
                  <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>{bags.toLocaleString()}</p>
                </div>
              </div>
              {order.bagNotes && (
                <div className="mt-3 pt-2 border-t" style={{ borderColor: '#fde68a' }}>
                  <p className="text-xs" style={{ color: '#92400e' }}>
                    <span className="font-semibold">Packing Notes: </span>{order.bagNotes}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 5. TERMS & CONDITIONS ===== */}
        <div className="px-8 pb-5">
          <div className="rounded-lg border p-5" style={{ borderColor: '#e2e8f0' }}>
            <h3 className="font-bold text-sm uppercase tracking-wider mb-3 pb-2 border-b" style={{ color: '#1e3a5f', borderColor: '#e2e8f0' }}>
              Terms &amp; Conditions
            </h3>
            <ol className="list-decimal list-inside text-xs space-y-2" style={{ color: '#475569' }}>
              <li>
                <span className="font-medium">Payment Terms:</span> {advancePct}% advance payment via TT (Telegraphic Transfer)
                before production. {balancePct}% balance payable against scanned copy of Bill of Lading.
              </li>
              <li>
                <span className="font-medium">Advance Deposit:</span> An advance amount of{' '}
                <span className="font-bold" style={{ color: '#1e3a5f' }}>{formatCurrency(advanceAmount)}</span>{' '}
                is required to confirm this order and initiate production.
              </li>
              <li>
                <span className="font-medium">Packing:</span>{' '}
                {order.bagType
                  ? `${bagSizeKg} KG ${order.bagType}${order.bagQuality ? ` (${order.bagQuality})` : ''}${order.bagPrinting ? ` — ${order.bagPrinting}` : ''}. Bags marked as per buyer's instructions.`
                  : `Standard packing in ${bagSizeKg} KG polypropylene bags. Bags marked as per buyer's instructions.`}
              </li>
              <li>
                <span className="font-medium">Origin:</span> Product of Pakistan. All goods are of Pakistani origin
                and comply with international food safety standards.
              </li>
            </ol>
            <div className="mt-4 pt-3 border-t" style={{ borderColor: '#e2e8f0' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: '#1e3a5f' }}>Documents Provided:</p>
              <p className="text-xs" style={{ color: '#64748b' }}>
                Commercial Invoice, Packing List, Bill of Lading, Certificate of Origin,
                Phytosanitary Certificate, Fumigation Certificate, Quality / Weight Certificate
              </p>
            </div>
          </div>
        </div>

        {/* ===== 6. SIGNATURE SECTION ===== */}
        <div className="px-8 pb-6">
          <div className="grid grid-cols-2 gap-16 pt-4">
            {/* Authorized Signature */}
            <div className="text-center">
              <div className="border-b-2 mb-2 pb-8" style={{ borderColor: '#1e3a5f' }} />
              <p className="text-sm font-bold" style={{ color: '#1e3a5f' }}>Authorized Signature</p>
              <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                {companyProfile?.name || 'AGRI COMMODITIES'}
              </p>
              {companyProfile?.proprietor && (
                <p className="text-xs mt-0.5 italic" style={{ color: '#94a3b8' }}>
                  {companyProfile.proprietor}
                </p>
              )}
            </div>

            {/* Customer Acceptance */}
            <div className="text-center">
              <div className="border-b-2 mb-2 pb-8" style={{ borderColor: '#1e3a5f' }} />
              <p className="text-sm font-bold" style={{ color: '#1e3a5f' }}>Customer Acceptance</p>
              <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                {order.customerName}
              </p>
            </div>
          </div>
        </div>

        {/* ===== 7. FOOTER BAR ===== */}
        <div className="px-8 py-4 text-center" style={{ backgroundColor: '#1e3a5f' }}>
          <p className="text-white text-xs opacity-90">
            {companyProfile?.address}
          </p>
          <p className="text-xs mt-1.5 opacity-75" style={{ color: '#d4a853' }}>
            {companyProfile?.phone}
            {companyProfile?.phone && companyProfile?.email && ' | '}
            {companyProfile?.email}
            {companyProfile?.email && companyProfile?.website && ' | '}
            {companyProfile?.website}
          </p>
          {companyProfile?.ntn && (
            <p className="text-white text-xs mt-1 opacity-60">
              NTN: {companyProfile.ntn}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
