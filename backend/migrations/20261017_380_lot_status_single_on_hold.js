/**
 * P3-15 / DAT-23: inventory_lots.status allowed both 'OnHold' and 'On Hold'
 * (inventory_lots_status_chk, migration 101). Nothing writes 'OnHold'; the one
 * spelling the app uses everywhere else is 'On Hold'. Drop the duplicate.
 *
 * Quantities are untouched. Rows still carrying 'OnHold' are NOT rewritten
 * here — that is a data correction, done by the reviewed, dry-run-by-default
 * backend/scripts/correctLotStatusOnHold.js (runbook:
 * docs/runbooks/lot-status-on-hold.md), which also tightens the CHECK once
 * the rows are normalised. While any such row exists this migration leaves
 * the old CHECK in place (a NOT VALID CHECK would still reject every UPDATE of
 * those rows, i.e. block stock movements on them).
 */
const NAME = 'inventory_lots_status_chk';
const NEW = "status IN ('Available','Reserved','Closed','Sold','Damaged','On Hold','Depleted')";
const OLD = "status IN ('Available','Reserved','Closed','Sold','Damaged','OnHold','On Hold','Depleted')";

async function swap(knex, predicate) {
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${NAME}`);
  await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT ${NAME} CHECK (${predicate})`);
}

exports.up = async (knex) => {
  const { rows } = await knex.raw("SELECT count(*)::int AS n FROM inventory_lots WHERE status = 'OnHold'");
  if (rows[0].n > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[380] ${rows[0].n} lot(s) still have status 'OnHold' — CHECK left as is; run scripts/correctLotStatusOnHold.js.`);
    return;
  }
  await swap(knex, NEW);
};

exports.down = (knex) => swap(knex, OLD);

exports.NEW_PREDICATE = NEW;
exports.CONSTRAINT_NAME = NAME;
