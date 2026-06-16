/**
 * Finish the paddy → rice rename (migration 119) in the accounting layer.
 *
 * The business buys already-milled rice by variety, not unmilled paddy, but the
 * GL still said "Raw Paddy": the chart-of-accounts account (code 1210), two
 * posting-rule descriptions, and the journal entries/lines those rules produced.
 * Rename the account, fix the rule text, and rewrite existing journal
 * descriptions/narrations + the raw-purchase ref_type to "Rice". Data-only
 * (no schema change). Idempotent.
 */
exports.up = async function (knex) {
  // 1. Chart of accounts — the raw-material stock account.
  await knex('chart_of_accounts')
    .where({ code: '1210' })
    .update({ name: 'Raw Rice Stock', updated_at: knex.fn.now() });

  // 2. Posting-rule descriptions that mention paddy.
  await knex('posting_rules').where({ trigger_event: 'purchase_invoice', entity: 'mill' })
    .update({ description: 'Supplier invoice for raw rice purchase' });
  await knex('posting_rules').where({ trigger_event: 'milling_completion', entity: 'mill' })
    .update({ description: 'Milling completed — finished goods from raw rice' });

  // 3. Existing raw-purchase journals: ref_type + description carry the rice type.
  await knex.raw(`
    UPDATE journal_entries je
    SET ref_type = 'Rice Purchase',
        description = 'Rice purchase — ' || COALESCE(p.name, 'rice') || ' (batch ' || je.ref_no || ')'
    FROM milling_batches mb
    LEFT JOIN products p ON p.id = mb.product_id
    WHERE je.ref_type = 'Raw Paddy Purchase' AND je.ref_no = mb.batch_no
  `);

  // 4. Journal-line narrations baked the old account name in at post time.
  await knex.raw(`
    UPDATE journal_lines
    SET narration = REPLACE(narration, 'Raw Paddy Stock', 'Raw Rice Stock')
    WHERE narration LIKE '%Raw Paddy Stock%'
  `);
  await knex.raw(`
    UPDATE journal_entries
    SET description = REPLACE(description, 'raw paddy', 'raw rice')
    WHERE description LIKE '%raw paddy%'
  `);
};

exports.down = async function (knex) {
  await knex('chart_of_accounts')
    .where({ code: '1210' })
    .update({ name: 'Raw Paddy Stock', updated_at: knex.fn.now() });

  await knex('posting_rules').where({ trigger_event: 'purchase_invoice', entity: 'mill' })
    .update({ description: 'Supplier invoice for raw paddy purchase' });
  await knex('posting_rules').where({ trigger_event: 'milling_completion', entity: 'mill' })
    .update({ description: 'Milling completed — finished goods from raw paddy' });

  await knex.raw(`
    UPDATE journal_lines
    SET narration = REPLACE(narration, 'Raw Rice Stock', 'Raw Paddy Stock')
    WHERE narration LIKE '%Raw Rice Stock%'
  `);
  // ref_type/description rewrites are not reverted (rice naming is canonical).
};
