/**
 * P3-18 (EXP-40 / MIL-48): purchase requirements now follow their export order
 * — reduced or cancelled when the order shrinks or is cancelled — and can be
 * cancelled by a person. An APPROVED request is never changed silently: when
 * the order no longer needs all of it, it is flagged for review instead.
 *
 * The status column has always been written as pending / approved / rejected /
 * purchased (and 'cancelled' was documented in migration 244) but had no CHECK.
 * Added NOT VALID, then validated when no existing row breaks it.
 */
const NAME = 'chk_purchase_requirements_status_valid';
const PREDICATE = "status IN ('pending', 'approved', 'rejected', 'purchased', 'cancelled')";

exports.up = async (knex) => {
  await knex.schema.alterTable('purchase_requirements', (t) => {
    t.timestamp('cancelled_at', { useTz: true }).nullable();
    t.integer('cancelled_by').unsigned().nullable();
    // Set when the need behind an APPROVED request fell below what was approved.
    t.boolean('review_required').notNullable().defaultTo(false);
    t.text('review_note').nullable();
  });
  await knex.raw(`ALTER TABLE purchase_requirements ADD CONSTRAINT ${NAME} CHECK (${PREDICATE}) NOT VALID`);
  const bad = await knex.raw(`SELECT count(*)::int AS n FROM purchase_requirements WHERE NOT (${PREDICATE})`);
  if (bad.rows[0].n === 0) await knex.raw(`ALTER TABLE purchase_requirements VALIDATE CONSTRAINT ${NAME}`);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE purchase_requirements DROP CONSTRAINT IF EXISTS ${NAME}`);
  await knex.schema.alterTable('purchase_requirements', (t) => {
    t.dropColumn('review_note');
    t.dropColumn('review_required');
    t.dropColumn('cancelled_by');
    t.dropColumn('cancelled_at');
  });
};
