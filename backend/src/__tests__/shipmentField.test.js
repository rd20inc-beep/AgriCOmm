const path = require('path');
const fs = require('fs');
const { resolveShipmentField, resolveRequiredField } = require('../modules/exportOrders/shipmentField');

describe('resolveShipmentField', () => {
  test('a value sets it', () => {
    expect(resolveShipmentField('V-42', 'OLD')).toBe('V-42');
  });

  test("a blank clears it — the operator emptied the field", () => {
    expect(resolveShipmentField('', 'OLD')).toBeNull();
    expect(resolveShipmentField(null, 'OLD')).toBeNull();
  });

  test('absent keeps the stored value — the caller never mentioned it', () => {
    expect(resolveShipmentField(undefined, 'OLD')).toBe('OLD');
  });

  test('absent with nothing stored is null, not undefined', () => {
    // Returning undefined would make knex omit the column instead of writing it.
    expect(resolveShipmentField(undefined, null)).toBeNull();
    expect(resolveShipmentField(undefined, undefined)).toBeNull();
  });

  test('0 and false are treated as empty, which is right for these columns', () => {
    // Every field this guards is a string or a date; there is no meaningful 0.
    expect(resolveShipmentField(0, 'OLD')).toBeNull();
  });

  test('it is not `x || stored || null` — that could never clear', () => {
    expect(resolveShipmentField('', 'OLD')).not.toBe('OLD');
  });

  test('it is not `x || null` — that would wipe on a partial payload', () => {
    expect(resolveShipmentField(undefined, 'OLD')).not.toBeNull();
  });
});

describe('resolveRequiredField — NOT NULL columns', () => {
  test('clearing returns the default, never null', () => {
    // consignee_type is NOT NULL; writing null would fail the constraint.
    expect(resolveRequiredField('', 'direct', 'to_order_of_bank')).toBe('to_order_of_bank');
    expect(resolveRequiredField(null, 'direct', 'to_order_of_bank')).toBe('to_order_of_bank');
  });

  test('a value still wins, and absent still keeps', () => {
    expect(resolveRequiredField('direct', 'to_order_of_bank', 'to_order_of_bank')).toBe('direct');
    expect(resolveRequiredField(undefined, 'direct', 'to_order_of_bank')).toBe('direct');
  });

  test('nothing anywhere falls back to the default', () => {
    expect(resolveRequiredField(undefined, null, 'to_order_of_bank')).toBe('to_order_of_bank');
  });
});

// A field added to this update later with a bare `x || null` would silently
// reintroduce the partial-payload wipe. This fails if that happens.
describe('every document field in updateShipment goes through a resolver', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/exportOrders/exportOrders.controller.js'), 'utf8',
  );
  const updateBlock = (() => {
    const at = src.indexOf('async updateShipment');
    const open = src.indexOf('{', at);
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('updateShipment not found');
  })();

  const GUARDED = [
    'contract_number', 'bl_date', 'gate_pass_no',
    'fi_number', 'fi_number_2', 'fi_number_3', 'fi_date',
    'freight_terms', 'consignee_type',
    'shipment_window_start', 'shipment_window_end',
    'notify_party_name', 'notify_party_address', 'notify_party_phone', 'notify_party_email',
    'shipment_remarks',
  ];

  test.each(GUARDED)('%s is resolved, not written bare', (field) => {
    const resolved = updateBlock.includes(`${field}: resolveShipmentField(`)
      || updateBlock.includes(`${field}: resolveRequiredField(`);
    expect(resolved).toBe(true);
    // and specifically not either of the two shapes that are wrong
    expect(updateBlock).not.toContain(`${field}: ${field} || null`);
    expect(updateBlock).not.toContain(`${field}: ${field} || order.${field} || null`);
  });

  test('all sixteen are covered', () => {
    expect(GUARDED).toHaveLength(16);
  });
});
