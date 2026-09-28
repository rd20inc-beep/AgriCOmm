/**
 * How many katta a repacked sale returns to the mill store, and of what size.
 *
 * Three things have to be true before a sack comes back:
 *
 *   the sale was repacked      rice tipped out of its original katta into the
 *                              customer's bags, or our own of a different size.
 *                              A sale that ships as-is frees nothing — the sacks
 *                              leave with the goods.
 *   the empties stayed with us a buyer can ask to keep them, which is what
 *                              freed_katta_to_store: false records.
 *   we know what was emptied   a size and a count, or there is nothing to credit.
 *
 * Returns null when any of those fails, so the caller needs no conditions of its
 * own. Freed katta are worth nothing until sold, so no value is computed here.
 */
function freedKattaFrom(repacking) {
  if (!repacking) return null;
  if (repacking.freed_katta_to_store === false) return null;

  const sizeKg = parseFloat(repacking.original_bag_size_kg) || 0;
  const count = parseInt(repacking.original_bag_count, 10) || 0;
  if (sizeKg <= 0 || count <= 0) return null;

  return { sizeKg, count };
}

module.exports = { freedKattaFrom };
