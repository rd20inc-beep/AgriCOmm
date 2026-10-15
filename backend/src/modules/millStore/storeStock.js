const accountingService = require('../accounting/accounting.service');
const { ConflictError, NotFoundError } = require('../../shared/errors');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');

// ─── Mill-store stock: quantity AND value move together (P3-05 / P3-06) ─────
//
// The store is valued at moving-average cost: an item's value is its on-hand
// (every bucket) × mill_items.avg_cost_per_unit, and 1250 Bags & Packaging is
// meant to equal the sum of those values. Every path that moves store stock
// used to do its own UPDATE on mill_stock, most with no row lock and a
// GREATEST(…, 0) clamp that hid shortages, and several moved quantity with no
// value at all (freed katta "at zero value" into an item valued at the
// purchased average), so the store value and 1250 drifted apart.
//
// moveStock is the one place quantity and value move. Its caller decides how
// the move is valued and posts the matching journal (postStoreJournal), in the
// same transaction:
//   'avg'   at the item's current average (an issue, or a return of an
//           issue) — value = qty × average; the average does not change
//   'cost'  at a given unit cost (a receipt, or a return at the cost it left
//           at) — moving average
//   'zero'  no value (freed sacks, by-weight katta, already-expensed printed
//           bags) — the item keeps its value and the average is re-spread
//           over the new quantity, so store value still equals 1250. One that
//           takes the item to zero reports the value left behind (`stranded`)
//           for the caller to write off.
// An out-move larger than the bucket holds is refused (ConflictError), or with
// `clamp` moves what is there and reports the rest as `short`. Stock never goes
// below zero and the movement row always records what actually moved.

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const EPS = 1e-6;

// The bucket's stock row, locked; created (empty) when the item has none there.
async function lockStockRow(trx, itemId, warehouseId = null) {
  // knex renders `warehouse_id: null` as IS NULL.
  const where = (q) => q.where({ item_id: itemId, warehouse_id: warehouseId ?? null });
  let row = await where(trx('mill_stock')).forUpdate().first();
  if (!row) {
    await trx('mill_stock').insert({ item_id: itemId, warehouse_id: warehouseId, quantity_available: 0, quantity_reserved: 0 });
    row = await where(trx('mill_stock')).forUpdate().first();
  }
  return row;
}

// The item row, locked — its average cost changes with every valued move, so
// two moves on one item must not interleave (INV-47).
async function lockItem(trx, itemId) {
  const item = await trx('mill_items').where('id', itemId).forUpdate().first();
  if (!item) throw new NotFoundError(`Store item ${itemId} not found.`);
  return item;
}

async function itemOnHand(trx, itemId) {
  const row = await trx('mill_stock').where('item_id', itemId).sum({ q: 'quantity_available' }).first();
  return Number((row && row.q) || 0);
}

/**
 * Move `qty` (signed: + into store, − out of it) of an item in one bucket.
 * Returns { moved, short, unitCost, value, item } — value signed like qty.
 */
async function moveStock(trx, {
  itemId, warehouseId = null, qty, valuation = 'avg', unitCost = null, clamp = false,
  movement = {}, label = null, shortMessage = null,
}) {
  const want = Number(qty) || 0;
  const item = await lockItem(trx, itemId);
  const stock = await lockStockRow(trx, itemId, warehouseId);
  if (Math.abs(want) < EPS) return { moved: 0, short: 0, unitCost: 0, value: 0, item };

  const avail = Number(stock.quantity_available) || 0;
  let moved = want;
  let short = 0;
  if (want < 0 && avail + want < -EPS) {
    if (!clamp) {
      throw new ConflictError(shortMessage
        ? shortMessage({ item, needed: r4(-want), available: r4(avail) })
        : `Not enough ${label || item.name} in store: ${r4(-want)} needed, ${r4(avail)} available.`);
    }
    moved = -avail;
    short = r4(-want - avail);
  }

  const onHand = await itemOnHand(trx, itemId);
  const avg = Number(item.avg_cost_per_unit) || 0;
  const unit = valuation === 'zero' ? 0 : valuation === 'cost' ? (Number(unitCost) || 0) : avg;
  const value = r2(moved * unit);
  const after = onHand + moved;
  let newAvg = avg;
  if (valuation !== 'avg' && after > EPS) newAvg = r4((onHand * avg + value) / after);
  // An unvalued out-move that empties the item cannot keep the item's value
  // anywhere: report it, so the caller writes it off with a journal instead of
  // leaving it stranded in 1250.
  const stranded = valuation === 'zero' && moved < 0 && after <= EPS ? r2(onHand * avg) : 0;

  if (Math.abs(moved) > EPS) {
    await trx('mill_stock').where({ id: stock.id }).update({
      quantity_available: trx.raw('quantity_available + ?', [moved]),
      updated_at: trx.fn.now(),
    });
    await trx('mill_stock_movements').insert({
      item_id: itemId,
      warehouse_id: warehouseId,
      quantity: moved,
      cost_per_unit: unit,
      total_cost: Math.abs(value),
      ...movement,
    });
  }
  if (newAvg !== avg) {
    await trx('mill_items').where({ id: itemId }).update({ avg_cost_per_unit: newAvg, updated_at: trx.fn.now() });
  }
  return { moved, short, unitCost: unit, value, stranded, item: { ...item, avg_cost_per_unit: newAvg } };
}

/**
 * The 1250 side of a store move. `amount` > 0 = value LEFT the store
 * (DR counter / CR 1250); < 0 = value came back (DR 1250 / CR counter).
 * Throws (rolling the caller back) when it cannot be posted.
 */
async function postStoreJournal(trx, {
  amount, counterCode = '6000', refType, refNo, description, userId = null,
  entity = 'mill', date = null, what = 'The store movement', partyType = null, partyId = null,
}) {
  const amt = r2(Math.abs(Number(amount) || 0));
  if (amt < 0.01) return null;
  const [store, counter] = await Promise.all([
    trx('chart_of_accounts').where({ code: '1250' }).first(),
    trx('chart_of_accounts').where({ code: counterCode }).first(),
  ]);
  if (!store || !counter) throw missingAccounts([counterCode, '1250'], what);
  const out = Number(amount) > 0;
  const [dr, cr] = out ? [counter, store] : [store, counter];
  try {
    const j = await accountingService.createJournal(trx, {
      date: date || new Date().toISOString().slice(0, 10), entity,
      refType, refNo, description, currency: 'PKR', fxRate: 1, isAuto: true,
      userId: userId || null, partyType, partyId,
      lines: [
        { account_id: dr.id, account: dr.name, debit: amt, credit: 0, narration: `DR ${dr.code} ${dr.name} — ${description}`.slice(0, 250) },
        { account_id: cr.id, account: cr.name, debit: 0, credit: amt, narration: `CR ${cr.code} ${cr.name} — ${description}`.slice(0, 250) },
      ],
    });
    if (j && j.id) await accountingService.postJournal(trx, j.id);
    return j;
  } catch (e) {
    throw ledgerFailure(e, what);
  }
}

/** Store value by the store's own rule: Σ on-hand × average, active or not. */
async function storeValue(q) {
  const row = await q('mill_stock as ms')
    .join('mill_items as mi', 'mi.id', 'ms.item_id')
    .select(q.raw('COALESCE(SUM(ms.quantity_available * COALESCE(mi.avg_cost_per_unit, 0)), 0) AS v'))
    .first();
  return r2(row && row.v);
}

module.exports = { moveStock, postStoreJournal, lockStockRow, lockItem, itemOnHand, storeValue, r2, r4 };
