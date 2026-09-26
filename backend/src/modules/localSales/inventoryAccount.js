/**
 * Which inventory account a sale relieves when stock leaves.
 *
 * This used to be a two-branch ternary inline in the controller:
 *
 *     lot.type === 'finished' ? (lot.entity === 'export' ? '1230' : '1220') : '1210'
 *
 * which sent EVERY non-finished lot to 1210 Raw Rice Stock. A by-product sale
 * therefore relieved raw rice: LS-0001 sold 3,500 kg of D98 B2 broken rice from a
 * by-product lot and credited 1210 with Rs 415,905 instead of 1240 By-Products.
 * COGS and the P&L were right; only the asset account was wrong, so the error is
 * invisible on the income statement and shows up as two inventory accounts drifting
 * in opposite directions. Corrected on production by CORR-LS-0001-COGS.
 */

/** Chart-of-accounts code for a lot's inventory account. */
function inventoryAccountForLot(lot) {
  const type = lot && lot.type;
  if (type === 'finished') return (lot.entity === 'export') ? '1230' : '1220';
  if (type === 'byproduct') return '1240';
  return '1210';   // raw, and anything unrecognised — raw rice is the safe default
}

module.exports = { inventoryAccountForLot };
