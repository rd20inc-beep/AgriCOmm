/**
 * Joi for POST /export-orders/:id/costs (P2-05) and /:id/cancel (P2-15).
 * Same options as middleware/validate.js: a field the controller reads but the
 * schema omits would be silently stripped.
 */
const schemas = require('../middleware/schemas');

const run = (schema, body) => schema.validate(body, { abortEarly: false, stripUnknown: true });

describe('addExportOrderCost', () => {
  test('a freight bill with its vendor and bill number comes through whole', () => {
    const body = { category: 'freight', amount: 150000, currency: 'PKR', fx_rate: null, notes: 'Sept freight', supplier_id: 4, vendor_name: '', bill_ref: 'MSK-77' };
    const { error, value } = run(schemas.addExportOrderCost, body);
    expect(error).toBeUndefined();
    for (const k of ['category', 'amount', 'currency', 'notes', 'supplier_id', 'vendor_name', 'bill_ref', 'fx_rate']) {
      expect(Object.prototype.hasOwnProperty.call(value, k)).toBe(true);
    }
  });

  test.each(['rice', 'raw_rice', 'milling', 'RICE', ' Milling '])('refuses the internal category %p', (category) => {
    const { error } = run(schemas.addExportOrderCost, { category, amount: 100 });
    expect(error).toBeDefined();
    expect(error.details[0].message).toMatch(/costed from stock at shipment/);
  });

  test.each([
    [{ amount: 100 }, 'category'],
    [{ category: 'freight' }, 'amount'],
    [{ category: 'freight', amount: 0 }, 'amount'],
    [{ category: 'freight', amount: -5 }, 'amount'],
    [{ category: 'freight', amount: 'abc' }, 'amount'],
    [{ category: 'freight', amount: 10, supplier_id: 'x' }, 'supplier_id'],
    [{ category: 'freight', amount: 10, currency: 'DOLLARS' }, 'currency'],
  ])('rejects %p (bad %s)', (body, field) => {
    const { error } = run(schemas.addExportOrderCost, body);
    expect(error).toBeDefined();
    expect(error.details.map((d) => d.path[0])).toContain(field);
  });

  test('currency defaults to PKR', () => {
    expect(run(schemas.addExportOrderCost, { category: 'freight', amount: 1 }).value.currency).toBe('PKR');
  });
});

describe('cancelExportOrder', () => {
  test('every field the controller reads survives', () => {
    const body = {
      reason: 'buyer withdrew', money_disposition: 'refund', refund_bank_account_id: 3,
      refund_date: '2026-10-15', refund_reference: 'TT-1', authorized_by_owner_id: 7,
    };
    const { error, value } = run(schemas.cancelExportOrder, body);
    expect(error).toBeUndefined();
    expect(Object.keys(value).sort()).toEqual(Object.keys(body).sort());
  });

  test('only refund / credit / forfeit are dispositions', () => {
    expect(run(schemas.cancelExportOrder, { money_disposition: 'keep' }).error).toBeDefined();
    for (const d of ['refund', 'credit', 'forfeit', null, '']) {
      expect(run(schemas.cancelExportOrder, { money_disposition: d }).error).toBeUndefined();
    }
  });
});
