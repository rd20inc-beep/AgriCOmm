/**
 * The create form has to actually SEND what the backend can store.
 *
 * The freight and weight-unit columns, the Joi schema and the create handler
 * were all wired up — and the create form never offered the fields, so every new
 * order was written with them blank and they had to be filled in afterwards from
 * the Overview tab. Nothing failed: a field nobody sends is indistinguishable
 * from a field nobody set.
 *
 * Same shape as the stripUnknown class of bug, from the other direction, so it
 * is checked the same way: against the schema, not by eye.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const FORM = read('src/modules/exportOrders/pages/CreateExportOrder.jsx');
const SCHEMAS = read('backend/src/middleware/schemas.js');
const CONTROLLER = read('backend/src/modules/exportOrders/exportOrders.controller.js');

// Everything migration 302 added that a new order should be able to carry.
const FIELDS = [
  'doc_weight_unit',
  'freight_per_mt',
  'insurance_per_mt',
  'freight_basis_date',
  'freight_valid_until',
  'freight_display',
  'freight_clause',
];

describe('a new export order can carry its freight terms', () => {
  it.each(FIELDS)('the create form sends %s', (field) => {
    expect(FORM).toContain(`${field}:`);
  });

  it.each(FIELDS)('createExportOrder declares %s, so Joi keeps it', (field) => {
    // validate() runs with stripUnknown — an undeclared field is deleted from
    // the body before the controller ever sees it.
    const createBlock = SCHEMAS.slice(
      SCHEMAS.indexOf('const createExportOrder'),
      SCHEMAS.indexOf('const updateExportShipment'),
    );
    expect(createBlock).toContain(`${field}:`);
  });

  it.each(FIELDS)('create() writes %s to the row', (field) => {
    const createBlock = CONTROLLER.slice(
      CONTROLLER.indexOf('async create(req, res)'),
      CONTROLLER.indexOf('async update(req, res)'),
    );
    expect(createBlock).toContain(`${field}:`);
  });

  it('the form offers an input for each of them, not just a payload key', () => {
    // A payload key fed by state that nothing can set is the same bug in a new
    // costume, so the control and its label are checked too.
    for (const [state, label] of [
      ['docWeightUnit', 'Weights on Export Documents'],
      ['freightPerMT', 'Ocean freight per MT'],
      ['insurancePerMT', 'Insurance per MT'],
      ['freightBasisDate', 'Rate quoted on'],
      ['freightValidUntil', 'Holds until'],
      ['freightDisplay', 'How it prints'],
    ]) {
      expect(FORM, label).toContain(`set('${state}'`);
      expect(FORM, label).toContain(label);
    }
  });

  it('leaving freight blank sends null, not zero', () => {
    // A zero would be a freight figure — it would print freight rows reading
    // 0.00 on the proforma. Blank has to stay blank.
    expect(FORM).toContain("form.freightPerMT === '' ? null : parseFloat(form.freightPerMT)");
    expect(FORM).toContain("form.insurancePerMT === '' ? null : parseFloat(form.insurancePerMT)");
  });
});

describe('the costing preview uses the freight that was entered', () => {
  it('the flat $65/MT guess is only a fallback now', () => {
    // It was a placeholder for CIF/CNF orders. With a real rate on the order,
    // the estimated margin should be the real margin.
    expect(FORM).toContain('parseFloat(form.freightPerMT) || 0');
    expect(FORM).toMatch(/freightCost = \(freightPerMt \+ insurancePerMt\) > 0/);
    expect(FORM).toContain('qtyMT * 65');   // still there, still the fallback
  });

  it('it recomputes when the freight changes', () => {
    // Left out of the dependency list, the estimate would silently stay stale.
    const memo = FORM.slice(FORM.indexOf('const costing = useMemo'), FORM.indexOf('const fmtUSD'));
    expect(memo).toContain('form.freightPerMT');
    expect(memo).toContain('form.insurancePerMT');
  });
});

describe('the form warns before it writes something contradictory', () => {
  it('freight inside the price needs an Incoterm that carries freight', () => {
    expect(FORM).toContain('incotermCarriesFreight(form.incoterm)');
    expect(FORM).toContain('does not put the freight on the seller');
  });

  it('freight at or above the price per MT is flagged', () => {
    expect(FORM).toContain('Freight is not smaller than the price per MT');
  });
});
