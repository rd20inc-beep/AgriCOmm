/**
 * Round-19 schema refinement.
 *
 * The QR-pairing channel just landed (alongside the existing API
 * channel) but the templates table has no way to record which
 * channel a given template should use — every send currently has to
 * guess. Add a `channel` column, with a CHECK constraint pinning it
 * to {api, qr, auto}, defaulting to 'api' so existing behaviour is
 * preserved.
 *
 * Tighten the rest of the WhatsApp tables while we're here:
 *   - whatsapp_templates: SET NOT NULL on entity / trigger_event /
 *     is_active / recipient_type (all already populated).
 *   - whatsapp_logs.created_at: default NOW() + NOT NULL so reports
 *     can sort confidently.
 *   - whatsapp_logs: add indexes on to_phone, status, sent_at DESC,
 *     and template_used so the soon-to-arrive activity log views
 *     don't full-scan the table.
 *
 * Idempotent throughout.
 */

exports.up = async function (knex) {
  // 1. whatsapp_templates.channel
  if (await knex.schema.hasTable('whatsapp_templates')) {
    if (!(await knex.schema.hasColumn('whatsapp_templates', 'channel'))) {
      await knex.raw(`
        ALTER TABLE whatsapp_templates
          ADD COLUMN channel VARCHAR(10) NOT NULL DEFAULT 'api'
      `);
      await knex.raw(`
        ALTER TABLE whatsapp_templates
          ADD CONSTRAINT chk_whatsapp_templates_channel
          CHECK (channel IN ('api', 'qr', 'auto'))
      `);
    }

    // 2. SET NOT NULL on long-populated fields. Defensive zero-NULL
    //    check before each ALTER.
    for (const col of ['entity', 'trigger_event', 'is_active', 'recipient_type']) {
      const meta = await knex.raw(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name='whatsapp_templates' AND column_name=?`,
        [col]
      );
      if (!meta.rows[0] || meta.rows[0].is_nullable !== 'YES') continue;
      const nul = await knex('whatsapp_templates').whereNull(col).count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE whatsapp_templates ALTER COLUMN "${col}" SET NOT NULL`);
      }
    }
  }

  // 3. whatsapp_logs.created_at default + NOT NULL
  if (await knex.schema.hasTable('whatsapp_logs')) {
    if (await knex.schema.hasColumn('whatsapp_logs', 'created_at')) {
      await knex.raw(`UPDATE whatsapp_logs SET created_at = NOW() WHERE created_at IS NULL`);
      await knex.raw(`ALTER TABLE whatsapp_logs ALTER COLUMN created_at SET DEFAULT NOW()`);
      const nul = await knex('whatsapp_logs').whereNull('created_at').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE whatsapp_logs ALTER COLUMN created_at SET NOT NULL`);
      }
    }

    // 4. Common-query indexes on whatsapp_logs
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_to_phone ON whatsapp_logs (to_phone)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON whatsapp_logs (status)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sent_at ON whatsapp_logs (sent_at DESC)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_template_used ON whatsapp_logs (template_used)`);
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('whatsapp_templates', 'channel')) {
    await knex.raw(`ALTER TABLE whatsapp_templates DROP CONSTRAINT IF EXISTS chk_whatsapp_templates_channel`);
    await knex.schema.alterTable('whatsapp_templates', (t) => t.dropColumn('channel'));
  }
  await knex.raw(`DROP INDEX IF EXISTS idx_whatsapp_logs_to_phone`);
  await knex.raw(`DROP INDEX IF EXISTS idx_whatsapp_logs_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_whatsapp_logs_sent_at`);
  await knex.raw(`DROP INDEX IF EXISTS idx_whatsapp_logs_template_used`);
};
