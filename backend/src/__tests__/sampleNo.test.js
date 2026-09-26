/**
 * Sample numbering: mirrors the purchase lot so a sample and the lot it becomes
 * are recognisably the same consignment.
 */
jest.mock('../config/database', () => {
  const fn = () => fn;
  fn.transaction = async (cb) => cb(fn);
  fn.fn = { now: () => 'now()' };
  return fn;
});
jest.mock('../modules/inventory/inventory.service', () => ({
  deriveSupplierCode: jest.fn(async () => 'SHAP'),
  deriveProductCode: jest.fn(async () => '1121BASM'),
}));
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'SMP-2026-0007') }));

const { buildSampleNo } = require('../modules/sampleAnalysis/sampleAnalysis.service');
const { nextDocNo } = require('../utils/docNumber');

// Minimal query-builder stub: records the LIKE prefix and returns a prior row.
function trxWith(lastSampleNo) {
  return () => ({
    where: () => ({ orderBy: () => ({ first: async () => (lastSampleNo ? { sample_no: lastSampleNo } : undefined) }) }),
  });
}

describe('buildSampleNo', () => {
  test('matches the purchase-lot shape: SUP-VARIETY-YYMMDD-SEQ', async () => {
    const no = await buildSampleNo(trxWith(null), { supplierId: 148, productId: 3, date: '2026-09-26' });
    // Production lot for this supplier/product/day is SHAP-1121BASM-260926-01.
    expect(no).toBe('SHAP-1121BASM-260926-01');
  });

  test('increments within the same supplier + variety + day', async () => {
    const no = await buildSampleNo(trxWith('SHAP-1121BASM-260926-04'), { supplierId: 148, productId: 3, date: '2026-09-26' });
    expect(no).toBe('SHAP-1121BASM-260926-05');
  });

  test('uses SAMPLE in place of the variety when no product is chosen yet', async () => {
    const no = await buildSampleNo(trxWith(null), { supplierId: 148, date: '2026-09-26' });
    expect(no).toBe('SHAP-SAMPLE-260926-01');
  });

  test('falls back to the old SMP- numbering when there is no supplier to key on', async () => {
    const no = await buildSampleNo(trxWith(null), { productId: 3, date: '2026-09-26' });
    expect(no).toBe('SMP-2026-0007');
    expect(nextDocNo).toHaveBeenCalled();
  });

  test('a two-digit date is zero-padded, so numbers sort correctly', async () => {
    const no = await buildSampleNo(trxWith(null), { supplierId: 148, productId: 3, date: '2026-01-05' });
    expect(no).toBe('SHAP-1121BASM-260105-01');
  });
});
