/**
 * Extend the master-data approval workflow (migration 127) to CUSTOMERS.
 *
 * Local Sales lets an operator sell to a walk-in / not-registered buyer. When
 * they opt to register that buyer, a customer row is created 'pending' and an
 * admin approves it in Admin → Approvals (same flow as products/suppliers).
 *
 * Adds to `customers`: approval_status, submitted_by, submitted_at,
 * reviewed_by, reviewed_at, review_notes. Existing rows grandfather to
 * 'approved' via the default. Idempotent.
 */
const TABLE = 'customers';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  if (!(await knex.schema.hasColumn(TABLE, 'approval_status'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string('approval_status', 20).notNullable().defaultTo('approved');
    });
    const name = `chk_${TABLE}_approval_status`;
    const check = await knex.raw(
      `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`, [name]);
    if (!check.rows.length) {
      await knex.raw(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (approval_status IN ('pending', 'approved', 'rejected'))`);
    }
  }
  if (!(await knex.schema.hasColumn(TABLE, 'submitted_by'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.integer('submitted_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'submitted_at'))) {
    await knex.schema.alterTable(TABLE, (t) => { t.timestamp('submitted_at').nullable(); });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'reviewed_by'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.integer('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'reviewed_at'))) {
    await knex.schema.alterTable(TABLE, (t) => { t.timestamp('reviewed_at').nullable(); });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'review_notes'))) {
    await knex.schema.alterTable(TABLE, (t) => { t.text('review_notes').nullable(); });
  }

  const idxName = `idx_${TABLE}_approval_status_pending`;
  const idx = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`, [idxName]);
  if (!idx.rows.length) {
    await knex.raw(`CREATE INDEX ${idxName} ON ${TABLE} (approval_status) WHERE approval_status = 'pending'`);
  }

  // Broaden the existing permission's description (added in 127) to mention customers.
  if (await knex.schema.hasTable('permissions')) {
    await knex('permissions')
      .where({ module: 'master_data', action: 'approve' })
      .update({ description: 'Approve or reject pending product / supplier / customer submissions' });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.raw(`DROP INDEX IF EXISTS idx_${TABLE}_approval_status_pending`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS chk_${TABLE}_approval_status`);
  for (const col of ['review_notes', 'reviewed_at', 'reviewed_by', 'submitted_at', 'submitted_by', 'approval_status']) {
    if (await knex.schema.hasColumn(TABLE, col)) {
      await knex.schema.alterTable(TABLE, (t) => { t.dropColumn(col); });
    }
  }
};
