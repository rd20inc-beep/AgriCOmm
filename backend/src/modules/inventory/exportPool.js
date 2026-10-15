// What stock an export order may draw on, and what it costs (P3-13).
//
// ONE predicate for the export stock pool. The picker (/available-stock) used
// to list "export_ready OR already in the export entity" while allocate-stock
// demanded export_ready, so a transferred lot without the flag was listed and
// then refused (EXP-28). Both sides now ask exportPoolProblem / applyExportPool.
//
// ONE cost basis per lot. Dispatch valued the lot movement at cost_per_unit
// while COGS used landed_cost_per_kg first (EXP-42), so the lot ledger and the
// GL disagreed on the same kilos. lotCostPerKg is that basis everywhere: the
// allocation guard, the dispatch movement, COGS, and the suggested lot.
const { inventoryAccountForLot } = require('../localSales/inventoryAccount');

const EXPORT_POOL_TYPES = ['finished', 'byproduct'];

/** PKR per kg a lot is carried at: landed → cost_per_unit → purchase rate. */
function lotCostPerKg(lot) {
  if (!lot) return 0;
  return parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.cost_per_unit) || parseFloat(lot.rate_per_kg) || 0;
}

/** Restrict a knex query over inventory_lots (aliased `alias`) to the export pool. */
function applyExportPool(q, alias = 'l') {
  return q
    .where(function () { this.where(`${alias}.export_ready`, true).orWhere(`${alias}.entity`, 'export'); })
    .whereNot(`${alias}.ownership`, 'client')
    .whereIn(`${alias}.type`, EXPORT_POOL_TYPES);
}

/** Why this lot may not go onto an export order, or null when it may. */
function exportPoolProblem(lot) {
  if (!lot) return 'Inventory lot not found.';
  if (lot.ownership === 'client') return 'Client-owned Service Milling stock cannot be allocated to an export order.';
  if (!EXPORT_POOL_TYPES.includes(lot.type)) return `${lot.lot_no || 'This lot'} is ${lot.type || 'not finished'} stock; only finished rice and by-products can go onto an export order.`;
  if (!(lot.export_ready || lot.entity === 'export')) {
    return 'Only export-ready stock can be allocated. Ask the mill to mark this lot Ready for Export first.';
  }
  return null;
}

module.exports = {
  EXPORT_POOL_TYPES,
  lotCostPerKg,
  applyExportPool,
  exportPoolProblem,
  inventoryAccountForLot,
};
