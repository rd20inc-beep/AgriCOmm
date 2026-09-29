/**
 * Export documents: weights in pounds, and freight that does not lie about the
 * Incoterm.
 *
 * These render the REAL documents from a payload shaped like the one the
 * backend sends, and read the HTML that comes out — so a renderer that stops
 * threading the unit through, or a total that stops adding up, fails here
 * rather than on a document already sent to a bank.
 */
import { describe, it, expect } from 'vitest';
import { renderDocument } from '../DocumentCenter.jsx';
import { freightBreakdown } from '../../../../shared/constants/exportFreight.js';
import { formatWeight, formatPackSize, KG_PER_LB } from '../../../../shared/constants/weightUnits.js';

// 24 MT of rice in 50 kg bags, sold CFR Hamburg at 822.50 — of which 760.00 is
// the FOB value, 58.00 ocean freight and 4.50 marine insurance.
const NET_KG = 24000;
const GROSS_KG = 24320;

function payload(orderOverrides = {}) {
  return {
    company: { name: 'Agri Commodities', address: 'Karachi', proprietor: 'A. Shah', rexNumber: 'PK-REX-1', bank: {} },
    buyer: { name: 'Nordic Foods GmbH', address: '1 Hafenstrasse', country: 'Germany', port: 'Hamburg' },
    order: {
      orderNo: 'EX-010', contractNumber: 'CN-010', invoiceNumber: 'INV-010', date: '2026-09-29',
      product: 'IRRI-6', productName: 'IRRI-6', qtyMT: 24, pricePerMT: 822.5, currency: 'USD',
      contractValue: 24 * 822.5, incoterm: 'CIF', advancePct: 0, advanceAmount: 0,
      bagSizeKg: 50, bagType: 'PP', totalBags: 480, hsCode: '1006.3010',
      destinationPort: 'Hamburg', portOfLoading: 'Karachi, Pakistan', paymentTerms: 'CAD',
      qualityDescription: 'Pakistani IRRI-6',
      docWeightUnit: 'kg', freightPerMT: 0, insurancePerMT: 0, freightDisplay: 'in_price',
      freightBasisDate: '', freightValidUntil: '', freightClause: '',
      ...orderOverrides,
    },
    shipment: { containerCount: 1, containerType: '40ft' },
    containers: [],
    totals: { netWeightKg: NET_KG, grossWeightKg: GROSS_KG, netWeightMT: 24, grossWeightMT: 24.32, totalPackages: 480, totalBags: 480, masterBagCount: 0 },
    items: [],
    packing: {},
    incotermInfo: { incoterm: 'CIF', sellerPaysFreight: true, portOfLoading: 'Karachi, Pakistan', portOfDischarge: 'Hamburg' },
  };
}

const render = (type, overrides) => renderDocument({ ...payload(overrides), _docType: type, type }, {});

// Every document that states a weight. Kept as a list so a new renderer that
// prints one is added here rather than quietly shipping in kilograms.
const WEIGHT_DOCS = ['proforma-invoice', 'commercial-invoice', 'packing-list', 'invoice', 'packing-certificate'];

describe('weights print in the unit chosen on the order', () => {
  it('a kilogram order never says LBS', () => {
    for (const t of WEIGHT_DOCS) {
      expect(render(t), t).not.toMatch(/\bLBS\b/);
    }
  });

  it('a kilogram order still says KG where it always did', () => {
    // The Invoice states its weights in METRIC TONS and carries no kilogram
    // figure at all, so it is not in this list — that is by design, not a miss.
    for (const t of ['proforma-invoice', 'commercial-invoice', 'packing-list', 'packing-certificate']) {
      expect(render(t), t).toMatch(/\bKGS?\b/);
    }
  });

  it('a pounds order says LBS and never KG', () => {
    for (const t of WEIGHT_DOCS) {
      const html = render(t, { docWeightUnit: 'lb' });
      expect(html, t).toMatch(/\bLBS\b/);
      // The whole point of "LBS only": no kilogram figure survives anywhere.
      expect(html, t).not.toMatch(/\bKGS?\b/);
    }
  });

  it('the converted figure is the exact pound value, not a rounded 2.2', () => {
    // 24,000 kg / 0.45359237 = 52,910.9429... lb
    const html = render('commercial-invoice', { docWeightUnit: 'lb' });
    expect(html).toContain('52,910.94 LBS');
    expect(html).toContain('53,616.42 LBS');   // 24,320 kg gross
    expect(html).not.toContain('52,800');      // what 2.2 would have given
  });

  it('a 50 kg bag reads 110.23 LBS and an 8 lb bag reads 8 LBS', () => {
    expect(formatPackSize(50, 'lb')).toBe('110.23 LBS');
    // Stored as the exact kg equivalent, it must come back a clean 8 — a retail
    // bag is sold as "8 lb", not "8.00 LBS" and certainly not "7.99".
    expect(formatPackSize(8 * KG_PER_LB, 'lb')).toBe('8 LBS');
    expect(formatPackSize(50, 'kg')).toBe('50 KGS');
  });

  it('metric tons are NOT converted — the contract is priced per MT either way', () => {
    const html = render('commercial-invoice', { docWeightUnit: 'lb' });
    expect(html).toContain('24.000 MT');
    expect(html).toContain('822.50');          // price per MT, unchanged
  });

  it('the packing list headings carry the unit', () => {
    expect(render('packing-list')).toContain('WEIGHT (IN KGS)');
    expect(render('packing-list', { docWeightUnit: 'lb' })).toContain('WEIGHT (IN LBS)');
  });
});

describe('freight: the two presentations describe the SAME shipment', () => {
  const CFR = { freightPerMT: 58, insurancePerMT: 4.5, freightBasisDate: '2026-09-29', freightValidUntil: '2026-10-29' };

  it('both ways the buyer owes the same money', () => {
    const inPrice = freightBreakdown({ ...CFR, currency: 'USD', pricePerMT: 822.5, qtyMT: 24, freightDisplay: 'in_price' }, { goodsTotal: 822.5 * 24 });
    const separate = freightBreakdown({ ...CFR, currency: 'USD', pricePerMT: 760, qtyMT: 24, freightDisplay: 'separate' }, { goodsTotal: 760 * 24 });
    expect(inPrice.totalPayable).toBeCloseTo(19740, 2);
    expect(separate.totalPayable).toBeCloseTo(19740, 2);
    expect(inPrice.goodsAmount).toBeCloseTo(separate.goodsAmount, 2);
    expect(inPrice.basePerMt).toBeCloseTo(760, 2);
  });

  it('in_price states the real term and breaks the price down inside it', () => {
    const html = render('proforma-invoice', { ...CFR, freightDisplay: 'in_price', incoterm: 'CIF', pricePerMT: 822.5 });
    expect(html).toContain('of which ocean freight');
    expect(html).toContain('of which insurance');
    expect(html).toContain('1,392.00');                 // 58 x 24
    expect(html).toContain('108.00');                   // 4.50 x 24
    // The price column heading is the order's term, not a hardcoded FOB.
    expect(html).toContain('CIF<br/>Price Per MT');
    // Nothing is ADDED — the freight is already inside the invoice total.
    expect(html).not.toContain('TOTAL PAYABLE');
  });

  it('separate keeps the FOB price and adds the freight below', () => {
    const html = render('proforma-invoice', { ...CFR, freightDisplay: 'separate', incoterm: 'CIF', pricePerMT: 760 });
    expect(html).toContain('FOB<br/>Price Per MT');
    expect(html).toContain('ADD: Ocean freight');
    expect(html).toContain('TOTAL PAYABLE');
    expect(html).toContain('19,740.00');
    expect(html).not.toContain('of which ocean freight');
  });

  it('the escalation clause is what actually protects the margin', () => {
    const html = render('proforma-invoice', { ...CFR, freightDisplay: 'in_price', pricePerMT: 822.5 });
    expect(html).toContain('Freight Escalation');
    expect(html).toContain('29 September 2026');
    expect(html).toContain('29 October 2026');
    expect(html).toContain("Buyer's account");
    expect(html).toContain('Bill of Lading');
  });

  it('a house clause replaces the generated wording entirely', () => {
    const html = render('sales-contract', { ...CFR, pricePerMT: 822.5, freightClause: 'Freight fixed and final. No escalation.' });
    expect(html).toContain('Freight fixed and final. No escalation.');
    expect(html).not.toContain('bunker adjustment');
  });

  it('the sales contract states the freight and the total the buyer pays', () => {
    const html = render('sales-contract', { ...CFR, freightDisplay: 'separate', pricePerMT: 760 });
    expect(html).toContain('FOB');
    expect(html).toContain('payable by the Buyer in addition to the goods value');
    expect(html).toContain('19,740.00');
  });

  it('the commercial invoice carries the customs split', () => {
    // The EU adds freight to reach CIF and US CBP deducts it, so the FOB /
    // freight / insurance make-up has to be on the invoice customs reads.
    const html = render('commercial-invoice', { ...CFR, freightDisplay: 'in_price', pricePerMT: 822.5 });
    expect(html).toContain('of which goods (FOB)');
    expect(html).toContain('18,240.00');
  });

  it('an order with no freight figure renders exactly as before', () => {
    for (const t of ['proforma-invoice', 'sales-contract', 'commercial-invoice']) {
      const html = render(t);
      expect(html, t).not.toContain('of which ocean freight');
      expect(html, t).not.toContain('ADD: Ocean freight');
      expect(html, t).not.toContain('Freight Escalation');
    }
  });

  // Both of these were caught by rendering a real proforma whose contract value
  // had not been computed, which is the state an order is in before it is priced.
  it('with no item total to work from, both presentations still agree', () => {
    const inPrice = freightBreakdown({ ...CFR, currency: 'USD', pricePerMT: 822.5, qtyMT: 24, freightDisplay: 'in_price' });
    const separate = freightBreakdown({ ...CFR, currency: 'USD', pricePerMT: 760, qtyMT: 24, freightDisplay: 'separate' });
    // The 'separate' fallback used to price the items at the DELIVERED rate and
    // then add the freight again — 21,240 instead of 19,740.
    expect(separate.totalPayable).toBeCloseTo(19740, 2);
    expect(inPrice.totalPayable).toBeCloseTo(19740, 2);
    expect(separate.goodsAmount).toBeCloseTo(18240, 2);
    expect(inPrice.goodsAmount).toBeCloseTo(18240, 2);
  });

  it('a zero item total never backs out a negative goods value', () => {
    const f = freightBreakdown({ ...CFR, currency: 'USD', pricePerMT: 822.5, qtyMT: 24, freightDisplay: 'in_price' }, { goodsTotal: 0 });
    expect(f.goodsAmount).toBeGreaterThan(0);
    // And the document prints no breakdown at all rather than a nonsense one.
    const html = render('proforma-invoice', { ...CFR, freightDisplay: 'in_price', pricePerMT: 30, contractValue: 0 });
    expect(html).not.toContain('of which goods');
  });

  it('freight bigger than the price is flagged, not printed as a negative FOB', () => {
    // A per-container rate typed into a per-MT field.
    const f = freightBreakdown({ currency: 'USD', pricePerMT: 50, qtyMT: 24, freightPerMT: 1800, freightDisplay: 'in_price' });
    expect(f.invalid).toBe(true);
  });
});

describe('the two settings are independent', () => {
  it('a US order can print pounds AND a freight split at once', () => {
    const html = render('commercial-invoice', {
      docWeightUnit: 'lb', freightPerMT: 58, insurancePerMT: 0,
      freightDisplay: 'in_price', pricePerMT: 822.5, destinationPort: 'New York',
    });
    expect(html).toContain('52,910.94 LBS');
    expect(html).toContain('of which ocean freight');
    expect(html).not.toMatch(/\bKGS?\b/);
  });
});

describe('the unit conversion itself', () => {
  it.each([
    [0, '0.00 LBS'],
    [1, '2.20 LBS'],
    [1000, '2,204.62 LBS'],
    [24000, '52,910.94 LBS'],
  ])('%s kg → %s', (kg, expected) => {
    expect(formatWeight(kg, 'lb')).toBe(expected);
  });

  it('an unknown unit falls back to kilograms, never to a blank', () => {
    expect(formatWeight(1000, undefined)).toBe('1,000.00 KG');
    expect(formatWeight(1000, 'stone')).toBe('1,000.00 KG');
  });
});
