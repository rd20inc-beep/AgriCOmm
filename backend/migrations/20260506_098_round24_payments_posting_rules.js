/**
 * Round-24 schema refinement.
 *
 * After the Money In / Money Out work (round 116/117), every code
 * path that writes to payments now stamps fx_rate, base_amount_pkr,
 * and payment_date. The legacy backfill brought every existing row
 * into compliance. Lock those invariants at the DB so a future
 * insert that forgets to set them — or sneaks back into a NULL
 * fallback — fails loudly instead of silently producing wrong PKR
 * totals.
 *
 * Also: posting_rules.debit_account_id / credit_account_id can in
 * principle be NULL (the schema allowed it) but every active rule
 * needs both to actually post. is_active also lacked NOT NULL.
 *
 * Idempotent — every NOT NULL re-checks zero NULLs after backfill.
 */

exports.up = async function (knex) {
  // ── payments ─────────────────────────────────────────────
  if (await knex.schema.hasTable('payments')) {
    // fx_rate: backfill to 1 if any slipped through, default 1, NOT NULL.
    if (await knex.schema.hasColumn('payments', 'fx_rate')) {
      await knex.raw(`UPDATE payments SET fx_rate = 1 WHERE fx_rate IS NULL`);
      await knex.raw(`ALTER TABLE payments ALTER COLUMN fx_rate SET DEFAULT 1`);
      const nul = await knex('payments').whereNull('fx_rate').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payments ALTER COLUMN fx_rate SET NOT NULL`);
      }
    }
    // base_amount_pkr: backfill to amount when missing for PKR rows.
    if (await knex.schema.hasColumn('payments', 'base_amount_pkr')) {
      await knex.raw(`UPDATE payments SET base_amount_pkr = amount WHERE (base_amount_pkr IS NULL OR base_amount_pkr = 0) AND currency = 'PKR'`);
      const nul = await knex('payments').whereNull('base_amount_pkr').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payments ALTER COLUMN base_amount_pkr SET NOT NULL`);
      }
    }
    // payment_date: default today + NOT NULL.
    if (await knex.schema.hasColumn('payments', 'payment_date')) {
      await knex.raw(`UPDATE payments SET payment_date = created_at::date WHERE payment_date IS NULL`);
      await knex.raw(`ALTER TABLE payments ALTER COLUMN payment_date SET DEFAULT CURRENT_DATE`);
      const nul = await knex('payments').whereNull('payment_date').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payments ALTER COLUMN payment_date SET NOT NULL`);
      }
    }
  }

  // ── posting_rules ───────────────────────────────────────
  if (await knex.schema.hasTable('posting_rules')) {
    for (const col of ['debit_account_id', 'credit_account_id']) {
      const meta = await knex.raw(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name='posting_rules' AND column_name=?`,
        [col]
      );
      if (!meta.rows[0] || meta.rows[0].is_nullable !== 'YES') continue;
      const nul = await knex('posting_rules').whereNull(col).count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE posting_rules ALTER COLUMN "${col}" SET NOT NULL`);
      }
    }
    if (await knex.schema.hasColumn('posting_rules', 'is_active')) {
      const meta = await knex.raw(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name='posting_rules' AND column_name='is_active'`
      );
      if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
        await knex.raw(`UPDATE posting_rules SET is_active = true WHERE is_active IS NULL`);
        await knex.raw(`ALTER TABLE posting_rules ALTER COLUMN is_active SET NOT NULL`);
      }
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('payments')) {
    await knex.raw(`ALTER TABLE payments ALTER COLUMN fx_rate DROP NOT NULL`);
    await knex.raw(`ALTER TABLE payments ALTER COLUMN fx_rate DROP DEFAULT`);
    await knex.raw(`ALTER TABLE payments ALTER COLUMN base_amount_pkr DROP NOT NULL`);
    await knex.raw(`ALTER TABLE payments ALTER COLUMN payment_date DROP NOT NULL`);
    await knex.raw(`ALTER TABLE payments ALTER COLUMN payment_date DROP DEFAULT`);
  }
  if (await knex.schema.hasTable('posting_rules')) {
    await knex.raw(`ALTER TABLE posting_rules ALTER COLUMN debit_account_id DROP NOT NULL`);
    await knex.raw(`ALTER TABLE posting_rules ALTER COLUMN credit_account_id DROP NOT NULL`);
    await knex.raw(`ALTER TABLE posting_rules ALTER COLUMN is_active DROP NOT NULL`);
  }
};
