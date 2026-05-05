/**
 * Round-23 schema refinement.
 *
 * After the recent finance integration work (rounds 091, 094, 095,
 * 096, 101) every code path now consistently populates pay_no,
 * entity and payable_type on payables, and fx_rate / currency on
 * journal_entries. Lock those invariants at the DB level so a future
 * regression can't slip a NULL through.
 *
 * Also: posting_rules has UNIQUE(rule_name) but not UNIQUE(trigger_event).
 * autoPost looks rules up by `trigger_event + is_active=true` and
 * silently picks the first row — duplicate active rules would
 * post to whichever one happened to be returned. Add a partial
 * UNIQUE so two active rules can't share a trigger.
 *
 * Idempotent throughout — every NOT NULL re-checks zero NULLs after
 * backfill.
 */

exports.up = async function (knex) {
  // 1. payables.pay_no NOT NULL
  if (await knex.schema.hasColumn('payables', 'pay_no')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='payables' AND column_name='pay_no'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('payables').whereNull('pay_no').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payables ALTER COLUMN pay_no SET NOT NULL`);
      }
    }
  }

  // 2. payables.entity NOT NULL (defaulting to 'general' going forward)
  if (await knex.schema.hasColumn('payables', 'entity')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='payables' AND column_name='entity'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('payables').whereNull('entity').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payables ALTER COLUMN entity SET NOT NULL`);
        await knex.raw(`ALTER TABLE payables ALTER COLUMN entity SET DEFAULT 'general'`);
      }
    }
  }

  // 3. payables.payable_type NOT NULL with vendor default
  if (await knex.schema.hasColumn('payables', 'payable_type')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='payables' AND column_name='payable_type'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('payables').whereNull('payable_type').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE payables ALTER COLUMN payable_type SET DEFAULT 'vendor'`);
        await knex.raw(`ALTER TABLE payables ALTER COLUMN payable_type SET NOT NULL`);
      }
    }
  }

  // 4. journal_entries.fx_rate — backfill NULLs to 1.0, default 1.0, NOT NULL.
  //    PKR-only entries didn't set fx_rate; future PKR entries are 1.0.
  if (await knex.schema.hasColumn('journal_entries', 'fx_rate')) {
    await knex.raw(`UPDATE journal_entries SET fx_rate = 1.0 WHERE fx_rate IS NULL`);
    await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN fx_rate SET DEFAULT 1.0`);
    const nul = await knex('journal_entries').whereNull('fx_rate').count('* as n');
    if (parseInt(nul[0].n, 10) === 0) {
      await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN fx_rate SET NOT NULL`);
    }
  }

  // 5. journal_entries.currency NOT NULL (already has default 'PKR')
  if (await knex.schema.hasColumn('journal_entries', 'currency')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='journal_entries' AND column_name='currency'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('journal_entries').whereNull('currency').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN currency SET NOT NULL`);
      }
    }
  }

  // 6. Partial UNIQUE on posting_rules(trigger_event) WHERE is_active.
  //    Two simultaneous active rules for the same trigger would have
  //    autoPost silently posting to whichever the planner returned.
  const dupe = await knex.raw(`
    SELECT trigger_event FROM posting_rules
     WHERE is_active = true
     GROUP BY trigger_event HAVING COUNT(*) > 1 LIMIT 1
  `);
  if (dupe.rows.length === 0) {
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_posting_rules_active_trigger
        ON posting_rules (trigger_event)
        WHERE is_active = true
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS uniq_posting_rules_active_trigger`);
  if (await knex.schema.hasColumn('payables', 'pay_no')) {
    await knex.raw(`ALTER TABLE payables ALTER COLUMN pay_no DROP NOT NULL`);
  }
  if (await knex.schema.hasColumn('payables', 'entity')) {
    await knex.raw(`ALTER TABLE payables ALTER COLUMN entity DROP NOT NULL`);
    await knex.raw(`ALTER TABLE payables ALTER COLUMN entity DROP DEFAULT`);
  }
  if (await knex.schema.hasColumn('payables', 'payable_type')) {
    await knex.raw(`ALTER TABLE payables ALTER COLUMN payable_type DROP NOT NULL`);
    await knex.raw(`ALTER TABLE payables ALTER COLUMN payable_type DROP DEFAULT`);
  }
  if (await knex.schema.hasColumn('journal_entries', 'fx_rate')) {
    await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN fx_rate DROP NOT NULL`);
    await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN fx_rate DROP DEFAULT`);
  }
  if (await knex.schema.hasColumn('journal_entries', 'currency')) {
    await knex.raw(`ALTER TABLE journal_entries ALTER COLUMN currency DROP NOT NULL`);
  }
};
