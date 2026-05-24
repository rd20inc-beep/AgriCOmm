/**
 * Approval workflow for master-data additions.
 *
 * Users can add a new product (rice type) or supplier on-the-go from
 * the Purchase Lot drawer. Those entries are flagged 'pending' and an
 * admin reviews them in the Approvals tab. The entry is usable
 * immediately so operations don't stall — a pending badge follows it
 * everywhere until reviewed.
 *
 * Columns added to BOTH `products` and `suppliers`:
 *   - approval_status   varchar(20)  default 'approved'  ('pending' / 'approved' / 'rejected')
 *   - submitted_by      int          FK -> users(id)     (who created it)
 *   - submitted_at      timestamp
 *   - reviewed_by       int          FK -> users(id)     (admin who acted)
 *   - reviewed_at       timestamp
 *   - review_notes      text                              (optional message back to submitter)
 *
 * Existing rows are grandfathered to 'approved' via the column default.
 *
 * Idempotent.
 */

const TABLES = ['products', 'suppliers'];

async function addApprovalColumns(knex, table) {
  if (!(await knex.schema.hasTable(table))) return;
  await knex.schema.alterTable(table, (t) => {
    // knex .alterTable swallows IF NOT EXISTS but each addition is guarded below
  });
  if (!(await knex.schema.hasColumn(table, 'approval_status'))) {
    await knex.schema.alterTable(table, (t) => {
      t.string('approval_status', 20).notNullable().defaultTo('approved');
    });
    // Constrain values at the DB level so a typo can't slip through.
    const name = `chk_${table}_approval_status`;
    const check = await knex.raw(
      `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`,
      [name]
    );
    if (!check.rows.length) {
      await knex.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (approval_status IN ('pending', 'approved', 'rejected'))`
      );
    }
  }
  if (!(await knex.schema.hasColumn(table, 'submitted_by'))) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('submitted_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }
  if (!(await knex.schema.hasColumn(table, 'submitted_at'))) {
    await knex.schema.alterTable(table, (t) => { t.timestamp('submitted_at').nullable(); });
  }
  if (!(await knex.schema.hasColumn(table, 'reviewed_by'))) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }
  if (!(await knex.schema.hasColumn(table, 'reviewed_at'))) {
    await knex.schema.alterTable(table, (t) => { t.timestamp('reviewed_at').nullable(); });
  }
  if (!(await knex.schema.hasColumn(table, 'review_notes'))) {
    await knex.schema.alterTable(table, (t) => { t.text('review_notes').nullable(); });
  }
  // Partial index for fast "pending count" lookups.
  const idxName = `idx_${table}_approval_status_pending`;
  const idx = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
    [idxName]
  );
  if (!idx.rows.length) {
    await knex.raw(`CREATE INDEX ${idxName} ON ${table} (approval_status) WHERE approval_status = 'pending'`);
  }
}

exports.up = async function (knex) {
  for (const table of TABLES) {
    await addApprovalColumns(knex, table);
  }

  // Seed a master_data.approve permission so admins can govern this.
  if (await knex.schema.hasTable('permissions')) {
    const existing = await knex('permissions')
      .where({ module: 'master_data', action: 'approve' })
      .first('id');
    if (!existing) {
      const [perm] = await knex('permissions').insert({
        module: 'master_data',
        action: 'approve',
        description: 'Approve or reject pending product / supplier submissions',
      }).returning('id');
      const permId = perm.id || perm;
      // Grant to Super Admin + Owner by default.
      if (await knex.schema.hasTable('role_permissions')) {
        const adminRoles = await knex('roles').whereIn('name', ['Super Admin', 'Owner']).select('id');
        for (const r of adminRoles) {
          const has = await knex('role_permissions').where({ role_id: r.id, permission_id: permId }).first();
          if (!has) {
            await knex('role_permissions').insert({ role_id: r.id, permission_id: permId });
          }
        }
      }
    }
  }
};

exports.down = async function (knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_approval_status_pending`);
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_approval_status`);
    for (const col of ['review_notes', 'reviewed_at', 'reviewed_by', 'submitted_at', 'submitted_by', 'approval_status']) {
      if (await knex.schema.hasColumn(table, col)) {
        await knex.schema.alterTable(table, (t) => { t.dropColumn(col); });
      }
    }
  }
  if (await knex.schema.hasTable('permissions')) {
    await knex('permissions').where({ module: 'master_data', action: 'approve' }).delete();
  }
};
