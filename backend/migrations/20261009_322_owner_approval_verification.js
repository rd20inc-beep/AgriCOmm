/**
 * Owner approvals are verified (owner decision G-11, 2026-10-09).
 *
 * Until now a non-owner passed ownerApproval by NAMING an owner. The owner now
 * enters their password on the requester's screen and the server checks it,
 * so each approval_authorizations row records how the owner was verified:
 *
 *   'self'      the Owner acted themselves
 *   'password'  a non-owner's request, authorized by the owner's password
 *   NULL        rows written before this change (named, not verified)
 *
 * Idempotent.
 */
exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('approval_authorizations', 'verification');
  if (!has) {
    await knex.schema.alterTable('approval_authorizations', (t) => {
      t.string('verification', 20).nullable();
    });
  }
  await knex.raw('ALTER TABLE approval_authorizations DROP CONSTRAINT IF EXISTS chk_approval_authorizations_verification');
  await knex.raw(`ALTER TABLE approval_authorizations ADD CONSTRAINT chk_approval_authorizations_verification
    CHECK (verification IS NULL OR verification IN ('self', 'password'))`);
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE approval_authorizations DROP CONSTRAINT IF EXISTS chk_approval_authorizations_verification');
  const has = await knex.schema.hasColumn('approval_authorizations', 'verification');
  if (has) {
    await knex.schema.alterTable('approval_authorizations', (t) => { t.dropColumn('verification'); });
  }
};
