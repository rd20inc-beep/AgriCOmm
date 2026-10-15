/**
 * Soft reservation of stock by PENDING local sales (P3-12 / INV-60).
 *
 * A sale entered by a clerk waits, Pending, for a Mill Manager / Owner to
 * confirm it; only confirmation draws the lot down. It used to hold nothing,
 * so a second sale could be entered against the same kilos and one of the two
 * then failed "Insufficient" at confirmation.
 *
 * The hold is DERIVED, not stored: the kilos of a lot's Pending local_sales
 * lines. Nothing is written when a sale is entered and nothing has to be
 * released when one is rejected — a Cancelled / Completed line simply stops
 * counting. It is "soft" because only local sales honour it:
 *
 *   - entering or editing a sale must fit in available − every OTHER pending
 *     hold (the newest entry never takes kilos an older one is waiting on);
 *   - confirming a sale must fit in available − the holds of OLDER pending
 *     sales (first entered, first served);
 *   - milling, transfers, export allocation and stock adjustments do not see
 *     it (they already draw the lot down for real). If they take the kilos,
 *     the pending sale is refused at confirmation, as before.
 */

// The sale's group key: lines of one multi-item sale share sale_group_no;
// a legacy single-line sale only has its sale_no.
const GROUP_KEY = 'COALESCE(sale_group_no, sale_no)';

/**
 * Kilos of `lotId` held by Pending local sales.
 *   excludeGroupNo  leave this sale's own lines out
 *   olderThanId     only lines entered before this local_sales.id
 */
async function pendingHoldKg(q, lotId, { excludeGroupNo = null, olderThanId = null } = {}) {
  if (!lotId) return 0;
  let query = q('local_sales')
    .where({ lot_id: lotId, status: 'Pending' })
    .whereNull('mill_item_id');
  if (excludeGroupNo) query = query.whereRaw(`${GROUP_KEY} <> ?`, [excludeGroupNo]);
  if (olderThanId) query = query.where('id', '<', olderThanId);
  const row = await query.sum({ kg: 'quantity_kg' }).first();
  return parseFloat(row && row.kg) || 0;
}

/** SQL for a lot list column: the kilos its Pending sales hold. `alias` is the lot alias. */
const pendingHoldKgSql = (alias = 'l') => `(SELECT COALESCE(SUM(ps.quantity_kg), 0)
   FROM local_sales ps
  WHERE ps.lot_id = ${alias}.id AND ps.status = 'Pending' AND ps.mill_item_id IS NULL)`;

module.exports = { pendingHoldKg, pendingHoldKgSql };
