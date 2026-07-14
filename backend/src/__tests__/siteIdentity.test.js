// Offline Stage 16b — identity extraction (pure, no DB).
const { deriveEntity, extractRef, extractDocNo } = require('../site/identity');

describe('deriveEntity', () => {
  test('is the first path segment after /api', () => {
    expect(deriveEntity('/api/local-sales')).toBe('local-sales');
    expect(deriveEntity('/api/local-sales/5/pay?x=1')).toBe('local-sales');
    expect(deriveEntity('/api/milling/batches/9')).toBe('milling');
  });
  test('null for non-api / empty', () => {
    expect(deriveEntity('/health')).toBeNull();
    expect(deriveEntity('')).toBeNull();
  });
});

describe('extractRef', () => {
  test('reads the created row id from { data }', () => {
    expect(extractRef({ success: true, data: { id: 42, sale_no: 'LS-0042' } })).toBe(42);
  });
  test('reads a bare row id', () => {
    expect(extractRef({ id: 7 })).toBe(7);
  });
  test('null when no id / not an object / list payload', () => {
    expect(extractRef({ success: true, data: [{ id: 1 }] })).toBeNull();
    expect(extractRef({ success: true })).toBeNull();
    expect(extractRef(null)).toBeNull();
  });
});

describe('extractDocNo', () => {
  test('finds the first known doc-number key', () => {
    expect(extractDocNo({ data: { id: 1, sale_no: 'LS-0042' } })).toBe('LS-0042');
    expect(extractDocNo({ data: { id: 2, batch_no: 'M-013' } })).toBe('M-013');
    expect(extractDocNo({ data: { id: 3, order_no: 'EXP-2026-1' } })).toBe('EXP-2026-1');
  });
  test('null when no known doc-number key is present', () => {
    expect(extractDocNo({ data: { id: 1, note: 'x' } })).toBeNull();
  });
});
