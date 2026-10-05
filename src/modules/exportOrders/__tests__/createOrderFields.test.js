/**
 * The create form has to actually SEND what the backend can store, and
 * "Duplicate Order" has to carry the deal across.
 *
 * These RUN the form's payload builder, costing preview and prefills
 * (utils/createOrderForm.js) and the Overview edit builders (utils/orderEdits.js).
 * Two checks still read source, because what they check IS source structure:
 *   - that every key the builder emits is declared in the backend Joi schema
 *     (validate() runs stripUnknown; joi isn't installed in the frontend CI job,
 *     so the declaration is matched in the schema text), and
 *   - that the form renders a control for each field.
 * The backend side (create() writes these columns) is executed in
 * backend/src/__tests__/exportOrderWorkflowFixes.test.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildCreateOrderPayload, estimateCosting, orderTotals, customerPrefill,
  lastOrderPrefill, duplicateStateFromOrder, EMPTY_ITEM,
} from '../utils/createOrderForm';
import { contractEditPayload, lineItemsPayload, orderHasReceipts } from '../utils/orderEdits';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const baseForm = {
  customerId: '10', country: 'UAE', destinationPort: 'Jebel Ali (Dubai)',
  currency: 'USD', incoterm: 'CFR', advancePct: 20, source: 'Internal Mill',
  paymentTerms: 'CAD', docAddressMode: 'country', docWeightUnit: 'kg', bankAccountId: '3',
  freightPerMT: '45', insurancePerMT: '', freightBasisDate: '2026-10-01', freightValidUntil: '2026-10-31',
  freightDisplay: 'in_price', freightClause: '',
  receivingMode: 'bags', bagType: 'PP', bagQuality: '', bagSizeKg: '25', bagWeightGm: '', bagPrinting: '',
  bagColor: '', bagBrand: '', masterBagSizeKg: '', masterBagType: '', masterBagWeightGm: '',
  packingType: 'retail', bagMaterial: '', palletized: false,
  contractNumber: '', consigneeType: 'to_order_of_bank', brokenPctTarget: '', qualityDescription: '',
  shipmentWindowStart: '', shipmentWindowEnd: '', notes: '', packingNotes: '', quantityUnit: 'ton',
};
const products = [{ id: 20, name: 'Super Kernel' }, { id: 21, name: '1121 Sella' }];
const items = [
  { ...EMPTY_ITEM, productId: '20', qtyMT: '100', pricePerMT: '500', hsCode: '1006.30' },
  { ...EMPTY_ITEM, productId: '21', qtyMT: '50', pricePerMT: '650' },
];
const build = (form = baseForm, its = items, status = 'Awaiting Advance') =>
  buildCreateOrderPayload({ form, items: its, products, status });

describe('the create payload', () => {
  it('sums the lines into the order totals', () => {
    const p = build();
    expect(p.qty_mt).toBe(150);
    expect(p.contract_value).toBe(82500);
    expect(p.price_per_mt).toBeCloseTo(550);
    expect(p.advance_expected).toBe(16500);
    expect(p.items.map((i) => [i.product_id, i.product_name, i.qty_mt, i.price_per_mt]))
      .toEqual([[20, 'Super Kernel', 100, 500], [21, '1121 Sella', 50, 650]]);
  });

  it('sends the destination port, bank and payment terms', () => {
    const p = build();
    expect(p.destination_port).toBe('Jebel Ali (Dubai)');
    expect(p.bank_account_id).toBe(3);
    expect(p.payment_terms).toBe('CAD');
  });

  it('sends the freight terms, and blank freight as null rather than zero', () => {
    const p = build();
    expect(p).toMatchObject({
      doc_weight_unit: 'kg', freight_per_mt: 45, insurance_per_mt: null,
      freight_basis_date: '2026-10-01', freight_valid_until: '2026-10-31', freight_display: 'in_price',
    });
    const blank = build({ ...baseForm, freightPerMT: '' });
    expect(blank.freight_per_mt).toBeNull();      // a zero would print 0.00 freight rows
    expect(blank.freight_basis_date).toBeNull();
  });

  it('a draft can go with blank quantities and prices', () => {
    const p = build({ ...baseForm, bankAccountId: '' }, [{ ...EMPTY_ITEM, productId: '20' }], 'Draft');
    expect(p).toMatchObject({ status: 'Draft', qty_mt: 0, price_per_mt: 0, contract_value: 0, bank_account_id: null });
  });

  it('every key it sends is declared in the backend schema, or Joi would strip it', () => {
    const SCHEMAS = read('backend/src/middleware/schemas.js');
    const itemBlock = SCHEMAS.slice(SCHEMAS.indexOf('const exportOrderItem ='), SCHEMAS.indexOf('const createExportOrder ='));
    const orderBlock = SCHEMAS.slice(SCHEMAS.indexOf('const createExportOrder ='), SCHEMAS.indexOf('const DRAFT_BLANK'));
    const mixed = buildCreateOrderPayload({
      form: { ...baseForm, receivingMode: 'mixed', bagSizeKg: '2', masterBagSizeKg: '20' },
      items, products, status: 'Draft',
      packingLines: [{ bagType: 'PP', fillWeightKg: '25', bagCount: '10' }],
    });
    for (const key of Object.keys(mixed)) expect(orderBlock, key).toMatch(new RegExp(`\\n  ${key}: Joi`));
    for (const key of Object.keys(mixed.items[0])) expect(itemBlock, key).toMatch(new RegExp(`\\n  ${key}: Joi`));
  });
});

describe('the costing preview', () => {
  it('uses the freight that was entered', () => {
    const c = estimateCosting({ ...baseForm, freightPerMT: '45', insurancePerMT: '5' }, items);
    expect(c.freightCost).toBe(150 * 50);
  });

  it('falls back to the flat $65/MT only for CIF/CNF without a rate', () => {
    expect(estimateCosting({ ...baseForm, freightPerMT: '', incoterm: 'CIF' }, items).freightCost).toBe(150 * 65);
    expect(estimateCosting({ ...baseForm, freightPerMT: '', incoterm: 'FOB' }, items).freightCost).toBe(0);
  });

  it('splits advance and balance by the advance %', () => {
    const c = estimateCosting({ ...baseForm, advancePct: 30 }, items);
    expect(c.advanceExpected).toBeCloseTo(24750);
    expect(c.balanceExpected).toBeCloseTo(57750);
  });
});

describe('prefills', () => {
  it('picking a buyer fills country, port and payment terms', () => {
    expect(customerPrefill({ country: 'Kenya', port: 'Mombasa', paymentTerms: 'LC 60 Days' }))
      .toEqual({ country: 'Kenya', destinationPort: 'Mombasa', paymentTerms: 'LC 60 Days' });
  });

  it('a buyer without a port or terms leaves what was chosen alone', () => {
    expect(customerPrefill({ country: 'Kenya', port: '', paymentTerms: '' })).toEqual({ country: 'Kenya' });
    expect(customerPrefill(undefined)).toEqual({ country: '' });
  });

  it('the buyer’s last order carries its Incoterm, currency and bank', () => {
    expect(lastOrderPrefill({ incoterm: 'CIF', currency: 'EUR', bank_account_id: 4 }))
      .toEqual({ incoterm: 'CIF', currency: 'EUR', bankAccountId: '4' });
    expect(lastOrderPrefill(undefined)).toEqual({});
  });
});

describe('Duplicate Order', () => {
  const source = {
    id: 'EX-014', customerId: 10, country: 'UAE', destinationPort: 'Jebel Ali (Dubai)',
    currency: 'EUR', incoterm: 'CIF', advancePct: 30, paymentTerms: 'LC 60 Days', bankAccountId: 4,
    freightPerMT: 45, insurancePerMT: 3, freightDisplay: 'separate', freightClause: 'GRI for buyer',
    receivingMode: 'bags', packingType: 'retail', bagType: 'BOPP', bagSizeKg: 5, masterBagSizeKg: 20,
    palletized: true, bagMaterial: 'Woven',
    items: [
      { id: 1, productId: 20, productName: 'Super Kernel', qtyMT: 100, pricePerMT: 500, hsCode: '1006.30', bagSizeKg: 5, masterBagSizeKg: 20, bagBrand: 'GOLD' },
      { id: 2, productId: 21, productName: '1121 Sella', qtyMT: 25, pricePerMT: 640 },
    ],
  };

  it('carries items, qty, price, packing, bank, incoterm, freight and payment terms', () => {
    const dup = duplicateStateFromOrder(source);
    const p = buildCreateOrderPayload({ form: { ...baseForm, ...dup.form }, items: dup.items, products, status: 'Draft' });
    expect(p.items.map((i) => [i.product_id, i.qty_mt, i.price_per_mt, i.bag_size_kg, i.master_bag_size_kg]))
      .toEqual([[20, 100, 500, 5, 20], [21, 25, 640, null, null]]);
    expect(p.items[0]).toMatchObject({ hs_code: '1006.30', bag_brand: 'GOLD' });
    expect(p).toMatchObject({
      customer_id: 10, currency: 'EUR', incoterm: 'CIF', advance_pct: 30,
      payment_terms: 'LC 60 Days', bank_account_id: 4, destination_port: 'Jebel Ali (Dubai)',
      freight_per_mt: 45, insurance_per_mt: 3, freight_display: 'separate', freight_clause: 'GRI for buyer',
      packing_type: 'retail', palletized: true, bag_material: 'Woven', bag_type: 'BOPP',
      bag_size_kg: 5, master_bag_size_kg: 20, units_per_bag: 4,
      qty_mt: 125, contract_value: 66000,
    });
  });

  it('a legacy order without line rows still duplicates its single product', () => {
    const dup = duplicateStateFromOrder({ ...source, items: [], productId: 20, qtyMT: 10, pricePerMT: 700 });
    expect(orderTotals(dup.items)).toMatchObject({ qtyMT: 10, contractValue: 7000 });
  });
});

describe('editing an order on the Overview tab', () => {
  const order = { currency: 'USD', qtyMT: 100, pricePerMT: 500, items: [{ id: 1 }] };
  const contract = {
    qty_mt: '100', price_per_mt: '500', currency: 'USD', incoterm: 'FOB', advance_pct: '20',
    destination_port: '', freight_per_mt: '', insurance_per_mt: '',
  };

  it('qty/price are only sent when they change', () => {
    expect(contractEditPayload(order, contract, { qtyPriceEditable: true })).not.toHaveProperty('qty_mt');
    const p = contractEditPayload(order, { ...contract, qty_mt: '120' }, { qtyPriceEditable: true });
    expect(p.qty_mt).toBe(120);
    expect(p).not.toHaveProperty('price_per_mt');
  });

  it('a multi-line order never sends an order-level qty/price', () => {
    const multi = { ...order, items: [{ id: 1 }, { id: 2 }] };
    const p = contractEditPayload(multi, { ...contract, qty_mt: '120', price_per_mt: '9' }, { qtyPriceEditable: true });
    expect(p).not.toHaveProperty('qty_mt');
    expect(p).not.toHaveProperty('price_per_mt');
  });

  it('the currency is only sent when it changes', () => {
    expect(contractEditPayload(order, contract, { qtyPriceEditable: true })).not.toHaveProperty('currency');
    expect(contractEditPayload(order, { ...contract, currency: 'EUR' }, { qtyPriceEditable: true }).currency).toBe('EUR');
  });

  it('receipts lock the contract', () => {
    expect(orderHasReceipts({ advanceReceived: 0, balanceReceived: 0 })).toBe(false);
    expect(orderHasReceipts({ advanceReceived: 1000, balanceReceived: 0 })).toBe(true);
  });

  it('line edits send every line, by id, with every field kept', () => {
    const lines = [
      { id: 7, productId: 20, productName: 'Super Kernel', qtyMT: 100, pricePerMT: 500, hsCode: '1006.30', bagSizeKg: 25, bagBrand: 'GOLD', notes: '' },
      { id: 8, productId: 21, productName: '1121 Sella', qtyMT: 50, pricePerMT: 650 },
    ];
    const out = lineItemsPayload(lines, { 7: { qtyMT: '90', pricePerMT: '510' } });
    expect(out.map((l) => [l.id, l.qty_mt, l.price_per_mt])).toEqual([[7, 90, 510], [8, 50, 650]]);
    expect(out[0]).toMatchObject({ product_id: 20, hs_code: '1006.30', bag_size_kg: 25, bag_brand: 'GOLD', notes: null });
  });
});

describe('the form offers an input for each field, not just a payload key', () => {
  it('renders the controls', () => {
    const FORM = read('src/modules/exportOrders/pages/CreateExportOrder.jsx');
    // A payload key fed by state that nothing can set is the same bug in a new
    // costume, so the control and its label are checked.
    for (const [state, label] of [
      ['docWeightUnit', 'Weights on Export Documents'],
      ['freightPerMT', 'Ocean freight per MT'],
      ['insurancePerMT', 'Insurance per MT'],
      ['freightBasisDate', 'Rate quoted on'],
      ['freightValidUntil', 'Holds until'],
      ['freightDisplay', 'How it prints'],
      ['destinationPort', 'Destination Port'],
    ]) {
      expect(FORM, label).toContain(`set('${state}'`);
      expect(FORM, label).toContain(label);
    }
    // The warnings before something contradictory is written.
    expect(FORM).toContain('incotermCarriesFreight(form.incoterm)');
    expect(FORM).toContain('Freight is not smaller than the price per MT');
  });
});
