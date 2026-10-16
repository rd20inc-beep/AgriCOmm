// Local-sale lot + COGS helpers (P3-12).

const num = (v) => parseFloat(v) || 0;

// Kilos of a lot free to sell: available less what sales awaiting
// confirmation hold (soft reservation, INV-60 — the server enforces the same
// rule; pendingSaleKg comes from the lot list).
export function lotFreeKg(lot) {
  if (!lot) return 0;
  return Math.max(0, num(lot.availableQty ?? lot.available_qty) - num(lot.pendingSaleKg ?? lot.pending_sale_kg));
}

// Why a lot cannot be sold, or null. Uses the server's has_cost FLAG, never
// the cost figures: those are redacted for cost-blind roles (Inventory
// Officer), which made every lot look uncosted and blocked them from selling
// at all (INV-52). With no flag (an older server) the server's own check
// stands — nothing is refused here.
export function lotSaleBlock(lot) {
  if (!lot) return null;
  const flag = lot.hasCost ?? lot.has_cost;
  if (flag === false) {
    return `${lot.lotNo || lot.lot_no || 'This lot'} has no recorded cost (Rs 0/kg). Set its purchase price before selling.`;
  }
  return null;
}

// One sale line's cost of goods sold for reports (INV-54) — twin of
// LOCKED_COGS_SQL in the local-sales controller:
//   confirmed (Completed) → the locked cogs_total_pkr, i.e. what the COGS
//     journal posted; a lot line from before the lock → landed_cost_total
//     (what its journal was posted from); a line with no lot → 0 (no COGS
//     journal).
//   anything else (Pending) → an ESTIMATE at the lot's cost when entered;
//     confirmation re-prices it.
export function saleCogs(s) {
  if (!s) return { cost: 0, locked: false };
  const hasLot = !!(s.lotId ?? s.lot_id);
  const status = s.status;
  const lockedRaw = s.cogsTotalPkr ?? s.cogs_total_pkr;
  const landed = num(s.landedCostTotal ?? s.landed_cost_total);
  if (status === 'Completed') {
    if (lockedRaw != null && lockedRaw !== '') return { cost: num(lockedRaw), locked: true };
    return { cost: hasLot ? landed : 0, locked: true };
  }
  const est = landed || num(s.costPerKg ?? s.cost_per_kg) * num(s.quantityKg ?? s.quantity_kg);
  return { cost: est, locked: false };
}

// Deep link into New Local Sale (P5-10, NAV-20): /local-sales?new=1 opens the
// drawer; &lot=<lot no or id> (Lot Detail's "Sell Locally") also preselects
// that lot. A lot alone implies opening the drawer.
export function saleIntentFromParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const lotRef = (get('lot') || '').trim() || null;
  const n = get('new');
  return { open: n === '1' || n === 'true' || !!lotRef, lotRef };
}

// The lot a preset reference points at, among the lots the picker loaded:
// matched on lot number first, then id. Never a fuzzy match — picking the
// wrong lot is the risk this link exists to remove.
export function matchPresetLot(lots, ref) {
  if (!ref || !Array.isArray(lots)) return null;
  const r = String(ref).trim().toLowerCase();
  return lots.find((l) => String(l.lotNo ?? l.lot_no ?? '').toLowerCase() === r)
    || lots.find((l) => String(l.id) === String(ref).trim())
    || null;
}
