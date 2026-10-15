/**
 * P3-01 — the lot quantity invariant, enforced by the database.
 *
 *   available_qty = qty − reserved_qty − milling_reserved_qty   (± 0.01 kg)
 *
 * postMovement is the one writer of these columns (lotQuantity.js); the CHECK
 * makes any other writer fail loudly instead of drifting. milling_reserved_qty
 * gets the ≥ 0 CHECK its siblings already have.
 *
 * Existing rows may have drifted (an old "Use in Batch" lowered available_qty
 * only, etc.), so both CHECKs are added NOT VALID — they bind every new write
 * at once — and validated only when no row breaks them. Drifted lots are
 * listed by scripts/detectLotQuantityDrift.js and corrected by
 * scripts/correctLotQuantityDrift.js (docs/runbooks/lot-quantity-invariant.md);
 * a later deploy validates the CHECK once they are clean.
 *
 * Status: 'Depleted' joins the allowed values. postMovement now derives
 * Available ↔ Depleted from the quantity (INV-32); 'Depleted' was already used
 * by the stock summary filter but not allowed by the CHECK.
 */
const AVAIL = 'inventory_lots_available_derived_chk';
const AVAIL_PRED = 'abs(available_qty - (qty - reserved_qty - milling_reserved_qty)) <= 0.01';
const MILL = 'inventory_lots_milling_reserved_nonneg_chk';
const MILL_PRED = 'milling_reserved_qty >= 0';
const STATUS = 'inventory_lots_status_chk';
const OLD_STATUSES = ['Available', 'Reserved', 'Closed', 'Sold', 'Damaged', 'OnHold', 'On Hold'];
const NEW_STATUSES = [...OLD_STATUSES, 'Depleted'];

const statusPred = (list) => `status IN (${list.map((s) => `'${s}'`).join(', ')})`;

async function addChecked(knex, name, predicate) {
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${name}`);
  await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT ${name} CHECK (${predicate}) NOT VALID`);
  const bad = await knex.raw(`SELECT count(*)::int AS n FROM inventory_lots WHERE NOT (${predicate})`);
  if (bad.rows[0].n === 0) await knex.raw(`ALTER TABLE inventory_lots VALIDATE CONSTRAINT ${name}`);
  else console.warn(`[371] ${name}: ${bad.rows[0].n} lot(s) break it — left NOT VALID; run scripts/detectLotQuantityDrift.js`);
}

exports.up = async (knex) => {
  await addChecked(knex, STATUS, statusPred(NEW_STATUSES));
  await addChecked(knex, MILL, MILL_PRED);
  await addChecked(knex, AVAIL, AVAIL_PRED);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${AVAIL}`);
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${MILL}`);
  // Depleted is not an old value: those lots go back to the old default.
  await knex.raw("UPDATE inventory_lots SET status = 'Available' WHERE status = 'Depleted'");
  await addChecked(knex, STATUS, statusPred(OLD_STATUSES));
};
