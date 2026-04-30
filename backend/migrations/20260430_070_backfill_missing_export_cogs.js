/**
 * Backfill COGS for shipped/arrived/closed orders that bypassed the
 * workflow lock job (typically seed-data orders inserted directly in
 * their final status).
 *
 * Strategy: re-run the COGS computation using the smarter calculateOrderCOGS
 * that now falls back to the linked milling batch's milling_costs when
 * neither inventory_reservations nor internal_transfers exist.
 *
 * For orders with no recoverable cost source (no reservations, no transfers,
 * no linked batch with costs), we leave inventory_cogs_total_pkr as-is and
 * log a warning the user can act on.
 *
 * Idempotent: only touches orders where status ∈ {Shipped,Arrived,Closed}
 * AND inventory_cogs_total_pkr IS NULL OR = 0.
 */

exports.up = async function (knex) {
  const inventoryService = require('../src/modules/inventory/inventory.service');
  const fxRateService = require('../src/modules/finance/fxRate.service');

  const targets = await knex('export_orders')
    .whereIn('status', ['Shipped', 'Arrived', 'Closed'])
    .where(function () {
      this.whereNull('inventory_cogs_total_pkr').orWhere('inventory_cogs_total_pkr', 0);
    })
    .select('id', 'order_no');

  if (targets.length === 0) return;

  let pkrRate = 280;
  try {
    const r = await fxRateService.getLatestRate('USD');
    pkrRate = r.rate || 280;
  } catch (_) { /* fall back to 280 */ }

  let backfilled = 0;
  let unrecoverable = 0;
  for (const o of targets) {
    try {
      const result = await knex.transaction(async (trx) => {
        return await inventoryService.lockOrderCOGS(trx, o.id, pkrRate);
      });
      if (result && result.totalCOGS > 0) {
        backfilled++;
      } else {
        unrecoverable++;
      }
    } catch (e) {
      console.warn(`[070 backfill] Failed for ${o.order_no}: ${e.message}`);
      unrecoverable++;
    }
  }

  if (backfilled > 0 || unrecoverable > 0) {
    console.log(`[070 backfill] Processed ${targets.length} shipped-no-COGS orders: ${backfilled} backfilled, ${unrecoverable} unrecoverable.`);
  }
};

exports.down = async function () {
  // No rollback — we don't want to clear the COGS values we just computed.
};
