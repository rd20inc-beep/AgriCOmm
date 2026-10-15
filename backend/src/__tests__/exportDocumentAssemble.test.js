/**
 * Every export document type assembles.
 *
 * #515 queried the freight debit notes inside gatherOrderData but never
 * returned them, so generate() read an undeclared `debitNotes` and EVERY
 * document — the Proforma first among them — failed with a 500. The tests that
 * shipped with it read the source as text and passed. This one runs the code:
 * a stub database returns an order and nothing else, and each type must come
 * back as a document.
 */
// The order's status — post-shipment documents need it Shipped (P3-17).
const mockOrderState = { status: 'Shipped' };
jest.mock('../config/database', () => {
  const ORDER = {
    id: 6, order_no: 'EX-006', currency: 'USD', quantity_mt: 24, price_per_mt: 500,
    incoterm: 'FOB', customer_name: 'ZZ Buyer', created_at: '2026-10-01',
  };
  // A query builder that accepts any chain: awaiting it yields no rows, and
  // .first() yields the order for export_orders and nothing for anything else.
  const builder = (table) => {
    const b = new Proxy(function stub() {}, {
      get(_, key) {
        if (key === 'then') return (ok, ko) => Promise.resolve([]).then(ok, ko);
        if (key === 'first') return async () => (String(table).startsWith('export_orders') ? { ...ORDER, status: mockOrderState.status } : undefined);
        return () => b;
      },
      apply: () => b,
    });
    return b;
  };
  const db = (table) => builder(table);
  db.raw = async () => ({ rows: [] });
  db.fn = { now: () => 'now()' };
  return db;
});

const { assembleDocument } = require('../modules/documents/exportDocument.controller');

const TYPES = [
  'sales-contract', 'proforma-invoice', 'production-plan', 'bank-fi-request',
  'export-undertaking', 'appendix-v-10a', 'itrs', 'indemnity', 'invoice',
  'commercial-invoice', 'bill-of-lading', 'packing-certificate',
  'freight-debit-note', 'packing-list', 'certificate-of-origin',
  'statement-of-origin', 'bank-covering-letter', 'buyer-covering-letter',
  'lab-test-request',
];

describe('export documents assemble', () => {
  let errorSpy;
  beforeAll(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterAll(() => errorSpy.mockRestore());

  it.each(TYPES)('%s', async (type) => {
    await expect(assembleDocument(6, type)).resolves.toBeTruthy();
  });

  // EXP-34: the Certificate / Statement of Origin and the covering letters
  // exist only once the goods have sailed.
  it.each(['certificate-of-origin', 'statement-of-origin', 'bank-covering-letter', 'buyer-covering-letter'])(
    '%s is refused before the order has shipped', async (type) => {
      mockOrderState.status = 'Ready to Ship';
      try {
        await expect(assembleDocument(6, type)).rejects.toMatchObject({
          status: 409, code: 'POST_SHIPMENT_DOCUMENT',
          message: expect.stringMatching(/post-shipment document .* once the order is Shipped \(it is Ready to Ship\)/),
        });
        // A pre-shipment document is not affected.
        await expect(assembleDocument(6, 'commercial-invoice')).resolves.toBeTruthy();
      } finally { mockOrderState.status = 'Shipped'; }
    },
  );

  it('the debit notes reach the document payload', async () => {
    const doc = await assembleDocument(6, 'proforma-invoice');
    expect(JSON.stringify(doc)).toContain('"debitNotes":[]');
  });
});
