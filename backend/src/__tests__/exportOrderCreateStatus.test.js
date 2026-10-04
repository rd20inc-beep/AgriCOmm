/**
 * A new export order may only start before the advance gates.
 *
 * createExportOrder accepted every status, Shipped/Closed/Cancelled included,
 * so a POST could create an order already past the advance, stock and document
 * gates the workflow enforces on the way there.
 */
const schemas = require('../middleware/schemas');

const run = (body) => schemas.createExportOrder.validate(body, { abortEarly: false, stripUnknown: true });
const minimal = {
  customer_id: 1, product_id: 1, qty_mt: 10, price_per_mt: 500,
  contract_value: 5000, incoterm: 'FOB', bank_account_id: 2,
};

describe('createExportOrder status', () => {
  it.each(['Draft', 'Awaiting Advance', 'Advance Received'])('%s is a valid starting status', (status) => {
    const { error, value } = run({ ...minimal, status });
    expect(error).toBeUndefined();
    expect(value.status).toBe(status);
  });

  it.each(['Procurement Pending', 'In Milling', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed', 'Cancelled'])(
    '%s is refused at creation',
    (status) => {
      expect(run({ ...minimal, status }).error).toBeDefined();
    },
  );

  it('no status still defaults to Draft', () => {
    expect(run(minimal).value.status).toBe('Draft');
  });
});
