/**
 * One export order, two P.I. lines at different prices in different bags:
 *   line 1 — 10 MT @ 1290 in 2 kg bags (10 kg master)
 *   line 2 — 10 MT @ 1250 in 5 kg bags (20 kg master)
 *
 * The order header stores contract value ÷ qty = 1270 (a weighted average) and
 * ONE bag spec (here line 1's 2 kg / 10 kg). The client's Proforma printed
 * line 1's bag on line 2 ("PACKED IN 2 KGS PP BAG, MASTER 10 KG OUTER",
 * 12,000 bags for both). Every line must print its OWN price and bag; the
 * header average stays for the value maths and is called an average.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderDocument, validateExportDoc } from '../components/DocumentCenter.jsx';
import ProformaInvoice from '../../../components/ProformaInvoice.jsx';
import { priceSummary, packingSummary, linePackaging } from '../utils/orderLines.js';
import { buildCreateOrderPayload, EMPTY_ITEM } from '../utils/createOrderForm.js';

// ─── The order as the detail page holds it (transformOrder shape) ───
const order = {
  id: 'EX-004', productName: 'Punjab Pride', qtyMT: 20, pricePerMT: 1270, contractValue: 25400,
  currency: 'USD', incoterm: 'FOB', advancePct: 0, advanceExpected: 0, paymentTerms: 'CAD',
  // The header's single bag spec — line 1's. It must NOT reach line 2.
  bagSizeKg: 2, masterBagSizeKg: 10, bagType: '',
  items: [
    { id: 11, lineNo: 1, productName: 'Punjab Pride 2kg', qtyMT: 10, pricePerMT: 1290, lineTotal: 12900, bagSizeKg: 2, masterBagSizeKg: 10, bagType: 'PP' },
    { id: 12, lineNo: 2, productName: 'Punjab Pride 5kg', qtyMT: 10, pricePerMT: 1250, lineTotal: 12500, bagSizeKg: 5, masterBagSizeKg: 20, bagType: 'PP' },
  ],
};

describe('order-level price and packing summaries', () => {
  it('the header price is labelled an average, with the line range', () => {
    expect(priceSummary(order)).toEqual({ mixed: true, label: 'Avg price per MT', value: 1270, min: 1250, max: 1290 });
  });

  it('a single-line order keeps calling it the unit price', () => {
    const one = { ...order, pricePerMT: 1290, items: [order.items[0]] };
    expect(priceSummary(one)).toMatchObject({ mixed: false, label: 'Price per MT', value: 1290 });
  });

  it('packing is per line: Mixed (2 kg, 5 kg), 5,000 + 2,000 bags, 1,000 + 500 masters', () => {
    const p = packingSummary(order);
    expect(p.label).toBe('Mixed (2 kg, 5 kg)');
    expect(p.masterLabel).toBe('Mixed (10 kg, 20 kg)');
    expect(p.lines.map((l) => [l.bagSizeKg, l.bags, l.masterBagSizeKg, l.masterBags])).toEqual([[2, 5000, 10, 1000], [5, 2000, 20, 500]]);
    expect(p.totalBags).toBe(7000);
  });

  it('a line with its own bag never borrows the header master bag', () => {
    const noMaster = { ...order, items: [order.items[0], { ...order.items[1], bagSizeKg: 25, masterBagSizeKg: null }] };
    expect(linePackaging(noMaster)[1]).toMatchObject({ bagSizeKg: 25, masterBagSizeKg: 0, masterBags: 0, bags: 400 });
  });

  it('a single line saved without its own bag still reads the header (legacy)', () => {
    const legacy = { ...order, items: [{ ...order.items[0], bagSizeKg: null, masterBagSizeKg: null }] };
    expect(linePackaging(legacy)[0]).toMatchObject({ bagSizeKg: 2, masterBagSizeKg: 10, bags: 5000 });
  });
});

describe('Proforma Invoice (on-screen / print component)', () => {
  const html = renderToStaticMarkup(React.createElement(ProformaInvoice, { order, companyProfile: {} }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('each line prints its own unit price and amount; total = contract value', () => {
    expect(text).toContain('$1,290.00');
    expect(text).toContain('$12,900.00');
    expect(text).toContain('$1,250.00');
    expect(text).toContain('$12,500.00');
    expect(text).toContain('$25,400.00');
    expect(text).not.toContain('1,270');
  });

  it('each line prints its own packing, bag size and bag count', () => {
    expect(text).toContain('PACKED IN 2 KGS PP BAG, MASTER 10 KG OUTER');
    expect(text).toContain('PACKED IN 5 KGS PP BAG, MASTER 20 KG OUTER');
    expect(text).toMatch(/5 KG\s+2,000/);
    expect(text).toMatch(/2 KG\s+5,000/);
    expect(text).not.toContain('12,000');
  });

  it('the packing clause follows the lines, not a hard-coded 25 KG', () => {
    expect(text).not.toContain('25 KG');
    expect(text).toContain('2 KG and 5 KG');
    expect(text).toContain('10 KG and 20 KG master');
  });

  it('a single-line order still reads exactly one bag', () => {
    const one = { ...order, pricePerMT: 1290, contractValue: 12900, qtyMT: 10, items: [order.items[0]] };
    const t = renderToStaticMarkup(React.createElement(ProformaInvoice, { order: one, companyProfile: {} })).replace(/<[^>]+>/g, ' ');
    expect(t).toContain('PACKED IN 2 KGS PP BAG, MASTER 10 KG OUTER');
    expect(t).not.toContain('Mixed');
  });
});

// ─── The Document Center payload (backend exportDocument.controller shape) ───
function docPayload(extraOrder = {}) {
  return {
    company: { name: 'Agri Commodities', address: 'Karachi', bank: {} },
    buyer: { name: 'ARROCERIA s.r.o', address: 'Bratislava', country: 'Slovakia' },
    order: {
      orderNo: 'EX-004', contractNumber: 'CN-004', invoiceNumber: 'INV-004', date: '2026-10-07',
      product: 'Punjab Pride', qtyMT: 20, pricePerMT: 1270, currency: 'USD', contractValue: 25400,
      incoterm: 'FOB', advancePct: 0, advanceAmount: 0, bagSizeKg: 2, masterBagSizeKg: 10, bagType: 'PP',
      totalBags: 7000, hsCode: '1006.3010', destinationPort: 'Bratislava', portOfLoading: 'Karachi, Pakistan',
      paymentTerms: 'CAD', docWeightUnit: 'kg', freightPerMT: 0, insurancePerMT: 0, freightDisplay: 'in_price',
      ...extraOrder,
    },
    shipment: { containerCount: 1, containerType: '20ft' },
    containers: [],
    totals: { netWeightKg: 20000, grossWeightKg: 20200, netWeightMT: 20, grossWeightMT: 20.2, totalPackages: 7000, totalBags: 7000, masterBagCount: 1500 },
    items: [
      { lineNo: 1, productName: 'Punjab Pride 2kg', qtyMT: 10, pricePerMT: 1290, lineTotal: 12900, hsCode: '1006.3010', bagSizeKg: 2, masterBagSizeKg: 10, bagType: 'PP' },
      { lineNo: 2, productName: 'Punjab Pride 5kg', qtyMT: 10, pricePerMT: 1250, lineTotal: 12500, hsCode: '1006.3010', bagSizeKg: 5, masterBagSizeKg: 20, bagType: 'PP' },
    ],
    packing: {},
    incotermInfo: { incoterm: 'FOB', portOfLoading: 'Karachi, Pakistan', portOfDischarge: 'Bratislava' },
  };
}
const renderDoc = (type) => renderDocument({ ...docPayload(), _docType: type, type }, {});

describe('Document Center — Proforma Invoice', () => {
  const html = renderDoc('proforma-invoice');

  it('prints each line at its own price; line totals and the grand total foot', () => {
    expect(html).toContain('1,290.00');
    expect(html).toContain('12,900.00');
    expect(html).toContain('1,250.00');
    expect(html).toContain('12,500.00');
    expect(html).toContain('25,400.00');
    expect(html).not.toContain('1,270');
  });

  it('prints each line in its own bag and master bag, with its own bag count', () => {
    expect(html).toMatch(/PACKED IN 2 KGS? PP BAG, MASTER 10 KGS? OUTER/);
    expect(html).toMatch(/PACKED IN 5 KGS? PP BAG, MASTER 20 KGS? OUTER/);
    expect(html).toContain('5,000');
    expect(html).toContain('2,000');
  });

  it('the Packing clause lists both bags', () => {
    expect(html).toMatch(/<b>Packing:<\/b> 2 KGS? & 5 KGS? PP bags, in 10 KGS? & 20 KGS? master/);
  });
});

describe('Document Center — the other documents built from the lines', () => {
  it('Packing List: line 2 is packed in 5 kg bags with 20 kg masters', () => {
    const html = renderDoc('packing-list');
    expect(html).toMatch(/PACKED IN 5 KGS? PP BAG/);
    expect(html).toMatch(/1,000 × 10 KGS? outer/);
    expect(html).toMatch(/500 × 20 KGS? outer/);
  });

  it('Commercial Invoice: each line at its own price, masters of both sizes', () => {
    const html = renderDoc('commercial-invoice');
    expect(html).toContain('1,290.00');
    expect(html).toContain('1,250.00');
    expect(html).not.toContain('1,270');
    expect(html).toMatch(/Master Bags of 10 KGS? & 20 KGS?/);
  });

  it('Bill of Lading: each line in its own bag', () => {
    const html = renderDoc('bill-of-lading');
    expect(html).toMatch(/PACKED IN 2 KGS? PP BAG IN 10 KGS? MASTER BAG/);
    expect(html).toMatch(/PACKED IN 5 KGS? PP BAG IN 20 KGS? MASTER BAG/);
  });

  it('Packing Certificate: both bag sizes', () => {
    const html = renderDoc('packing-certificate');
    expect(html).toMatch(/PACKED IN 2 KGS? & 5 KGS?/);
  });
});

describe('Create Export Order payload', () => {
  const form = {
    customerId: '1', country: 'Slovakia', currency: 'USD', incoterm: 'FOB', advancePct: 0,
    receivingMode: 'bags', packingType: 'retail', bagSizeKg: '25', masterBagSizeKg: '', source: 'Internal Mill',
  };
  const items = [
    { ...EMPTY_ITEM, productId: '1', qtyMT: '10', pricePerMT: '1290', bagSizeKg: '2', masterBagSizeKg: '10', bagType: 'PP' },
    { ...EMPTY_ITEM, productId: '1', qtyMT: '10', pricePerMT: '1250', bagSizeKg: '5', masterBagSizeKg: '20', bagType: 'PP' },
  ];
  const p = buildCreateOrderPayload({ form, items, products: [{ id: 1, name: 'Punjab Pride' }], status: 'Draft' });

  it('each line keeps its own price and bag', () => {
    expect(p.items.map((i) => [i.price_per_mt, i.bag_size_kg, i.master_bag_size_kg])).toEqual([[1290, 2, 10], [1250, 5, 20]]);
  });

  it('the header average stays 1270 for the value maths', () => {
    expect(p.price_per_mt).toBe(1270);
    expect(p.contract_value).toBe(25400);
  });

  it('the hidden single-item bag (25 kg) does not become the order bag; bags are counted per line', () => {
    expect(p.bag_size_kg).toBeNull();
    expect(p.master_bag_size_kg).toBeNull();
    expect(p.total_bags).toBe(7000);
  });
});

describe('a line without its own bag is flagged, never given line 1\'s', () => {
  const withLine2 = (line2) => {
    const d = docPayload();
    d.items = [d.items[0], { ...d.items[1], ...line2 }];
    return d;
  };

  it('line 2 with NO bag size prints "—" on the Proforma and is flagged — not 2 KG / 10 KG / 5,000', () => {
    const d = withLine2({ bagSizeKg: null, masterBagSizeKg: null });
    const html = renderDocument({ ...d, _docType: 'proforma-invoice', type: 'proforma-invoice' }, {});
    expect(html.match(/MASTER 10 KGS? OUTER/g)).toHaveLength(1);
    expect(html.match(/PACKED IN 2 KGS? PP BAG/g)).toHaveLength(1);
    const v = validateExportDoc({ ...d, _docType: 'proforma-invoice' });
    expect(v.warnings.join(' ')).toMatch(/Line 2: no bag size set/);
  });

  it('a 5 kg line with no master bag is flagged rather than lent line 1\'s 10 kg master', () => {
    const d = withLine2({ masterBagSizeKg: null });
    const html = renderDocument({ ...d, _docType: 'proforma-invoice', type: 'proforma-invoice' }, {});
    expect(html).toMatch(/PACKED IN 5 KGS? PP BAG</);
    expect(html.match(/MASTER 10 KGS? OUTER/g)).toHaveLength(1);
    const v = validateExportDoc({ ...d, _docType: 'proforma-invoice' });
    expect(v.warnings.join(' ')).toMatch(/Line 2: 5 kg retail bags have no master bag set/);
  });

  it('a stored packing text naming another line\'s bag gives way to the line\'s own bag', () => {
    const d = withLine2({ packing: 'PACKED IN 2 KGS PP BAG, MASTER 10 KG OUTER' });
    const html = renderDocument({ ...d, _docType: 'proforma-invoice', type: 'proforma-invoice' }, {});
    expect(html).toMatch(/PACKED IN 5 KGS? PP BAG, MASTER 20 KGS? OUTER/);
  });

  it('a stored packing text that states the line\'s own bag is kept as written', () => {
    const d = withLine2({ packing: 'PACKED IN 5 KG BOPP BAG WITH HANDLE' });
    const html = renderDocument({ ...d, _docType: 'proforma-invoice', type: 'proforma-invoice' }, {});
    expect(html).toContain('PACKED IN 5 KG BOPP BAG WITH HANDLE');
  });

  it('the on-screen Proforma shows "—" for a line with no bag, not the header 2 KG', () => {
    const o = { ...order, items: [order.items[0], { ...order.items[1], bagSizeKg: null, masterBagSizeKg: null }] };
    const t = renderToStaticMarkup(React.createElement(ProformaInvoice, { order: o, companyProfile: {} })).replace(/<[^>]+>/g, ' ');
    expect(t.match(/MASTER 10 KG OUTER/g)).toHaveLength(1);
    expect(t).not.toContain('12,000');
  });
});
