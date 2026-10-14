/**
 * Service-milling invoices: void instead of delete, and one live invoice per
 * batch (P2-16 / MIL-32, MIL-33).
 *
 * - status ('Active' | 'Void') + void_reason / voided_at / voided_by /
 *   void_authorized_by: a void keeps the invoice, its receivable and its
 *   journals (owner decision D-23 — financial records are voided, never
 *   deleted). The old void deleted the invoice, its receivable, its payments and
 *   their bank rows.
 * - Partial unique index on service_batch_id WHERE status = 'Active': the
 *   create path's "already invoiced?" check was an unlocked read, so two saves
 *   could both pass it. A voided invoice does not block re-issuing.
 *
 * Read-only duplicate check first: if any batch already has more than one
 * invoice the index cannot be built — the migration stops and names the batch
 * ids (counts only) instead of deleting anything. Resolve them per
 * docs/runbooks/service-invoice-void.md (scripts/checkServiceInvoiceDuplicates.js).
 */

const INDEX = 'uq_service_milling_invoices_batch_active';

exports.up = async function up(knex) {
  const dupes = await knex('service_milling_invoices')
    .whereNotNull('service_batch_id')
    .groupBy('service_batch_id')
    .havingRaw('count(*) > 1')
    .select('service_batch_id');
  if (dupes.length) {
    throw new Error(`[353] ${dupes.length} service batch(es) have more than one invoice (batch ids: ${dupes.map((d) => d.service_batch_id).join(', ')}). `
      + 'Resolve them before migrating — see docs/runbooks/service-invoice-void.md.');
  }

  await knex.schema.alterTable('service_milling_invoices', (t) => {
    t.string('status', 10).notNullable().defaultTo('Active');
    t.text('void_reason');
    t.timestamp('voided_at', { useTz: true });
    t.integer('voided_by').references('id').inTable('users').onDelete('SET NULL');
    t.integer('void_authorized_by').references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.raw(`ALTER TABLE service_milling_invoices
    ADD CONSTRAINT chk_service_milling_invoices_status_valid CHECK (status IN ('Active', 'Void'))`);
  await knex.raw(`CREATE UNIQUE INDEX ${INDEX} ON service_milling_invoices (service_batch_id) WHERE status = 'Active'`);
  // FK indexes (schema-hygiene convention: every FK column is indexed).
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_service_milling_invoices_voided_by ON service_milling_invoices (voided_by)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_service_milling_invoices_void_authorized_by ON service_milling_invoices (void_authorized_by)');
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
  await knex.raw('DROP INDEX IF EXISTS idx_service_milling_invoices_voided_by');
  await knex.raw('DROP INDEX IF EXISTS idx_service_milling_invoices_void_authorized_by');
  await knex.raw('ALTER TABLE service_milling_invoices DROP CONSTRAINT IF EXISTS chk_service_milling_invoices_status_valid');
  await knex.schema.alterTable('service_milling_invoices', (t) => {
    t.dropColumn('void_authorized_by');
    t.dropColumn('voided_by');
    t.dropColumn('voided_at');
    t.dropColumn('void_reason');
    t.dropColumn('status');
  });
};
