const inventoryService = require('../modules/inventory/inventory.service');

// The Milling Cost box (manual_milling_cost_pkr) and the "Milling / Processing"
// cost category are the same charge entered in two places. Both used to be added
// to Net Purchase, so batch M-001 — manual 17,672 AND a `processing` row of
// 17,672 — counted it twice.
const batch = (over = {}) => ({
  actual_finished_kg: 1000,
  broken_kg: 0, bran_kg: 0, husk_kg: 0, sortex_rejects_kg: 0,
  b1_kg: 0, b2_kg: 0, b3_kg: 0, csr_kg: 0, short_grain_kg: 0,
  powder_kg: 0, sweeping_kg: 0, choba_kg: 0,
  ...over,
});
// Net Purchase is the figure under test; by-products are all zero above, so the
// finished pool equals it.
const netPurchase = (b, raw, proc, pack, millingCat) =>
  inventoryService.computeResidualAllocation(b, raw, proc, pack, millingCat).netPurchase;

describe('the milling charge is counted once', () => {
  // M-001 as it stands on production.
  const RAW = 795976.90;
  const PACK = 4392;
  const PROCESSING = 17672;          // the "Milling / Processing" category row
  const OTHER_ROWS = 650 + 2840;     // transport + other
  const PROC_TOTAL = OTHER_ROWS + PROCESSING;

  test('manual figure set AND a matching category row: counted once', () => {
    const b = batch({ manual_milling_cost_pkr: 17672, manual_other_expenses_pkr: 0 });
    // raw + milling(17,672) + other(650+2,840) + packing — NOT 17,672 twice.
    expect(netPurchase(b, RAW, PROC_TOTAL, PACK, PROCESSING))
      .toBeCloseTo(RAW + 17672 + OTHER_ROWS + PACK, 2);
  });

  test('the old behaviour would have been 17,672 higher', () => {
    const b = batch({ manual_milling_cost_pkr: 17672, manual_other_expenses_pkr: 0 });
    const now = netPurchase(b, RAW, PROC_TOTAL, PACK, PROCESSING);
    const doubleCounted = RAW + 17672 + PROC_TOTAL + PACK;
    expect(doubleCounted - now).toBeCloseTo(17672, 2);
  });

  test('no manual figure: the recorded category still counts, once', () => {
    const b = batch({ manual_milling_cost_pkr: null, manual_other_expenses_pkr: 0 });
    expect(netPurchase(b, RAW, PROC_TOTAL, PACK, PROCESSING))
      .toBeCloseTo(RAW + PROC_TOTAL + PACK, 2);
  });

  test('a manual figure larger than the row wins outright', () => {
    const b = batch({ manual_milling_cost_pkr: 25000, manual_other_expenses_pkr: 0 });
    expect(netPurchase(b, RAW, PROC_TOTAL, PACK, PROCESSING))
      .toBeCloseTo(RAW + 25000 + OTHER_ROWS + PACK, 2);
  });

  test('a manual Other figure still overrides every processing row', () => {
    const b = batch({ manual_milling_cost_pkr: 17672, manual_other_expenses_pkr: 5000 });
    expect(netPurchase(b, RAW, PROC_TOTAL, PACK, PROCESSING))
      .toBeCloseTo(RAW + 17672 + 5000 + PACK, 2);
  });

  test('no milling charge anywhere', () => {
    const b = batch({ manual_milling_cost_pkr: null, manual_other_expenses_pkr: 0 });
    expect(netPurchase(b, RAW, OTHER_ROWS, PACK, 0))
      .toBeCloseTo(RAW + OTHER_ROWS + PACK, 2);
  });

  test('other expenses never go negative if the category exceeds the total', () => {
    // Defensive: a stale sum should clamp rather than subtract money away.
    const b = batch({ manual_milling_cost_pkr: 100, manual_other_expenses_pkr: 0 });
    expect(netPurchase(b, 1000, 50, 0, 500)).toBeCloseTo(1000 + 100 + 0, 2);
  });

  test('the milling cost is omitted entirely when neither source has it', () => {
    const b = batch({ manual_milling_cost_pkr: 0, manual_other_expenses_pkr: 0 });
    expect(netPurchase(b, 1000, 0, 0, 0)).toBeCloseTo(1000, 2);
  });
});
