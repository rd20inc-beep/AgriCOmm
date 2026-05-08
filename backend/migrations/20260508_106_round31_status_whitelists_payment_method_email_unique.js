/**
 * Round-31 schema refinement.
 *
 * Three more classes of looseness left after round 30:
 *
 *   1. Status whitelists for tables whose state machines I can read
 *      from controllers / current data:
 *        - production_plans
 *        - accounting_periods
 *        - tasks_assignments
 *        - document_store
 *        - cost_allocations
 *        - inventory_reservations
 *
 *   2. payments.payment_method had no whitelist but the Joi schema
 *      already constrains it to {cash, bank_transfer, cheque, lc, tt}
 *      at the API boundary. Mirror that to the DB.
 *
 *   3. customers/suppliers email could be unique (case-insensitive,
 *      ignoring NULL) but seed data has 4 duplicate pairs. Dedupe by
 *      suffixing later duplicates with `+dup<id>` so the original
 *      email survives, then add a partial unique index.
 *
 * Idempotent — every CHECK skips with a warning if existing data
 * doesn't match the whitelist.
 */

const STATUS_TARGETS = [
  ['production_plans', 'status', ['Draft', 'Scheduled', 'In Progress', 'Completed', 'Cancelled']],
  ['accounting_periods', 'status', ['Open', 'Closed', 'Locked']],
  ['tasks_assignments', 'status', ['Open', 'In Progress', 'Completed', 'Cancelled', 'Blocked']],
  ['document_store', 'status', ['Draft', 'Pending Review', 'Approved', 'Final', 'Rejected']],
  ['cost_allocations', 'status', ['Unallocated', 'Partial', 'Allocated', 'Posted']],
  ['inventory_reservations', 'status', ['Active', 'Released', 'Consumed', 'Expired']],
];

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'lc', 'tt'];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}

async function indexExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_indexes WHERE indexname = ?`, [name]);
  return r.rowCount > 0;
}

async function addStatusWhitelist(knex, table, column, allowed) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  const conname = `chk_${table}_${column}_valid`;
  if (await constraintExists(knex, conname)) return;
  const offenders = await knex(table).whereNotNull(column).whereNotIn(column, allowed).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round31] ${table}.${column}: ${offenders.n} unknown values; skipping CHECK.`);
    return;
  }
  const list = allowed.map(v => `'${v}'`).join(',');
  await knex.raw(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${conname}"
     CHECK ("${column}" IS NULL OR "${column}" IN (${list}))`
  );
}

exports.up = async function (knex) {
  // ── Status whitelists ───────────────────────────────────
  for (const [t, c, allowed] of STATUS_TARGETS) {
    await addStatusWhitelist(knex, t, c, allowed);
  }

  // ── payments.payment_method whitelist ───────────────────
  if (await knex.schema.hasTable('payments')
    && await knex.schema.hasColumn('payments', 'payment_method')
    && !(await constraintExists(knex, 'chk_payments_payment_method_valid'))) {
    const offenders = await knex('payments')
      .whereNotNull('payment_method')
      .whereNotIn('payment_method', PAYMENT_METHODS)
      .count('* as n').first();
    if (parseInt(offenders.n, 10) === 0) {
      const list = PAYMENT_METHODS.map(v => `'${v}'`).join(',');
      await knex.raw(
        `ALTER TABLE payments ADD CONSTRAINT chk_payments_payment_method_valid
         CHECK (payment_method IS NULL OR payment_method IN (${list}))`
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[round31] payments.payment_method: ${offenders.n} unknown values; skipping.`);
    }
  }

  // ── customers / suppliers email partial-unique ──────────
  // First dedupe: keep the lowest id, suffix the rest with +dup{id}.
  for (const t of ['customers', 'suppliers']) {
    if (!(await knex.schema.hasTable(t))) continue;
    const dupes = await knex.raw(`
      SELECT id, email FROM ${t} a
      WHERE email IS NOT NULL AND email <> ''
      AND id <> (
        SELECT MIN(b.id) FROM ${t} b
        WHERE LOWER(b.email) = LOWER(a.email)
      )
    `);
    for (const row of dupes.rows) {
      const localPart = row.email.split('@')[0];
      const domain = row.email.split('@')[1] || '';
      const newEmail = `${localPart}+dup${row.id}@${domain}`;
      await knex(t).where({ id: row.id }).update({ email: newEmail });
      // eslint-disable-next-line no-console
      console.warn(`[round31] ${t} id=${row.id}: '${row.email}' -> '${newEmail}'`);
    }
    const idxName = `${t}_email_lower_uidx`;
    if (!(await indexExists(knex, idxName))) {
      await knex.raw(
        `CREATE UNIQUE INDEX ${idxName}
         ON ${t} (LOWER(email))
         WHERE email IS NOT NULL AND email <> ''`
      );
    }
  }
};

exports.down = async function (knex) {
  for (const [t, c] of STATUS_TARGETS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS chk_${t}_${c}_valid`);
  }
  await knex.raw(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_payment_method_valid`);
  await knex.raw(`DROP INDEX IF EXISTS customers_email_lower_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS suppliers_email_lower_uidx`);
  // Note: suffixed emails are NOT restored to their original duplicates.
};
