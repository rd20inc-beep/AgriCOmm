/**
 * Round-32 schema refinement.
 *
 * Three more classes of looseness covered:
 *
 *   1. Status whitelists for 10 more tables whose state machines are
 *      knowable from current data. Tables whose status column is
 *      empty AND I couldn't read a clear state machine from code are
 *      left alone (mills, internal_transfers, bank_transactions etc.)
 *      to avoid guessing.
 *
 *   2. severity / priority / type whitelists on the small set of
 *      tables where the values exist and have obvious bounds:
 *        - alerts.severity:        low / medium / high / critical
 *        - tasks_assignments.priority: Low / Normal / High / Urgent
 *
 *   3. Identifier uniqueness:
 *        - export_order_items   UNIQUE (order_id, line_no)
 *        - order_packing_lines  UNIQUE (order_id, line_no)
 *        - shipment_containers  UNIQUE (order_id, sequence_no)
 *        - shipment_containers.container_no partial UNIQUE
 *        - mill_purchases (supplier_id, LOWER(invoice_number))
 *          partial UNIQUE
 *        - bank_accounts.account_number UNIQUE
 *
 * Idempotent — every CHECK / index skips with a warning if the data
 * doesn't match.
 */

const STATUS_TARGETS = [
  ['alerts', 'status', ['Open', 'Acknowledged', 'Resolved', 'Dismissed', 'Escalated']],
  ['api_sync_log', 'status', ['Pending', 'Running', 'Success', 'Partial', 'Failed', 'Cancelled']],
  ['background_jobs', 'status', ['Pending', 'Running', 'Completed', 'Failed', 'Cancelled', 'Retrying']],
  ['document_dispatch_log', 'status', ['Pending', 'Sending', 'Delivered', 'Failed', 'Bounced', 'Cancelled']],
  ['email_logs', 'status', ['Pending', 'Queued', 'Sent', 'Delivered', 'Failed', 'Bounced']],
  ['export_order_documents', 'status', ['Pending', 'Draft Uploaded', 'Under Review', 'Approved', 'Rejected', 'Final']],
  ['follow_ups', 'status', ['Pending', 'In Progress', 'Done', 'Cancelled', 'Snoozed']],
  ['system_health', 'status', ['Healthy', 'Degraded', 'Down', 'Unknown']],
  ['task_execution_log', 'status', ['Pending', 'Running', 'Success', 'Failed', 'Skipped']],
  ['whatsapp_logs', 'status', ['Pending', 'Queued', 'Sent', 'Delivered', 'Read', 'Failed']],
];

const VALUE_WHITELISTS = [
  ['alerts', 'severity', ['low', 'medium', 'high', 'critical']],
  ['tasks_assignments', 'priority', ['Low', 'Normal', 'High', 'Urgent']],
];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}
async function indexExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_indexes WHERE indexname = ?`, [name]);
  return r.rowCount > 0;
}

async function addWhitelist(knex, table, column, allowed, conname) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  if (await constraintExists(knex, conname)) return;
  const offenders = await knex(table).whereNotNull(column).whereNotIn(column, allowed).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round32] ${table}.${column}: ${offenders.n} unknown values; skipping CHECK.`);
    return;
  }
  const list = allowed.map(v => `'${v}'`).join(',');
  await knex.raw(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${conname}"
     CHECK ("${column}" IS NULL OR "${column}" IN (${list}))`
  );
}

exports.up = async function (knex) {
  // ── Status whitelists ─────────────────────────────────────
  for (const [t, c, allowed] of STATUS_TARGETS) {
    await addWhitelist(knex, t, c, allowed, `chk_${t}_${c}_valid`);
  }

  // ── Severity / priority whitelists ────────────────────────
  for (const [t, c, allowed] of VALUE_WHITELISTS) {
    await addWhitelist(knex, t, c, allowed, `chk_${t}_${c}_valid`);
  }

  // ── Composite identifier uniques ──────────────────────────
  // export_order_items (order_id, line_no)
  if (await knex.schema.hasTable('export_order_items')
    && !(await indexExists(knex, 'export_order_items_order_line_uidx'))) {
    const dupes = await knex.raw(
      `SELECT order_id, line_no FROM export_order_items GROUP BY 1,2 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(`CREATE UNIQUE INDEX export_order_items_order_line_uidx ON export_order_items (order_id, line_no)`);
    }
  }
  // order_packing_lines (order_id, line_no)
  if (await knex.schema.hasTable('order_packing_lines')
    && !(await indexExists(knex, 'order_packing_lines_order_line_uidx'))) {
    const dupes = await knex.raw(
      `SELECT order_id, line_no FROM order_packing_lines GROUP BY 1,2 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(`CREATE UNIQUE INDEX order_packing_lines_order_line_uidx ON order_packing_lines (order_id, line_no)`);
    }
  }
  // shipment_containers (order_id, sequence_no)
  if (await knex.schema.hasTable('shipment_containers')
    && !(await indexExists(knex, 'shipment_containers_order_seq_uidx'))) {
    const dupes = await knex.raw(
      `SELECT order_id, sequence_no FROM shipment_containers GROUP BY 1,2 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(`CREATE UNIQUE INDEX shipment_containers_order_seq_uidx ON shipment_containers (order_id, sequence_no)`);
    }
  }
  // shipment_containers.container_no partial unique (real-world ID)
  if (await knex.schema.hasTable('shipment_containers')
    && !(await indexExists(knex, 'shipment_containers_container_no_uidx'))) {
    const dupes = await knex.raw(
      `SELECT LOWER(container_no) FROM shipment_containers
       WHERE container_no IS NOT NULL AND container_no <> ''
       GROUP BY 1 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(
        `CREATE UNIQUE INDEX shipment_containers_container_no_uidx
         ON shipment_containers (LOWER(container_no))
         WHERE container_no IS NOT NULL AND container_no <> ''`
      );
    }
  }
  // mill_purchases (supplier_id, LOWER(invoice_number)) partial unique
  if (await knex.schema.hasTable('mill_purchases')
    && !(await indexExists(knex, 'mill_purchases_supplier_invoice_uidx'))) {
    const dupes = await knex.raw(
      `SELECT supplier_id, LOWER(invoice_number) FROM mill_purchases
       WHERE invoice_number IS NOT NULL AND invoice_number <> ''
       GROUP BY 1,2 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(
        `CREATE UNIQUE INDEX mill_purchases_supplier_invoice_uidx
         ON mill_purchases (supplier_id, LOWER(invoice_number))
         WHERE invoice_number IS NOT NULL AND invoice_number <> ''`
      );
    }
  }
  // bank_accounts.account_number partial unique
  if (await knex.schema.hasTable('bank_accounts')
    && !(await indexExists(knex, 'bank_accounts_account_number_uidx'))) {
    const dupes = await knex.raw(
      `SELECT account_number FROM bank_accounts
       WHERE account_number IS NOT NULL AND account_number <> ''
       GROUP BY 1 HAVING COUNT(*) > 1`
    );
    if (dupes.rows.length === 0) {
      await knex.raw(
        `CREATE UNIQUE INDEX bank_accounts_account_number_uidx
         ON bank_accounts (account_number)
         WHERE account_number IS NOT NULL AND account_number <> ''`
      );
    }
  }
};

exports.down = async function (knex) {
  for (const [t, c] of [...STATUS_TARGETS, ...VALUE_WHITELISTS]) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS chk_${t}_${c}_valid`);
  }
  await knex.raw(`DROP INDEX IF EXISTS export_order_items_order_line_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS order_packing_lines_order_line_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS shipment_containers_order_seq_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS shipment_containers_container_no_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS mill_purchases_supplier_invoice_uidx`);
  await knex.raw(`DROP INDEX IF EXISTS bank_accounts_account_number_uidx`);
};
