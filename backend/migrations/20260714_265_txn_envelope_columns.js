// Offline Stage 3 — transaction-envelope columns on the primary syncable tables.
// Purely additive: every column is nullable or has a constant default, so existing
// INSERTs and endpoints are unaffected (Postgres adds constant-default columns as
// metadata-only — no table rewrite). Existing rows are, by definition, already on
// the server → sync_status defaults to 'synced', record_version to 1.
//
//   uuid            client-generated row identity, stable across offline→online
//                   (UNIQUE — Postgres allows many NULLs, so legacy rows are fine;
//                    new offline rows can't collide on sync)
//   device_uuid     originating device (attribution / revocation)
//   record_version  optimistic-lock version (R2 — detect concurrent master edits)
//   sync_status     'synced' | 'pending' | 'conflict'
//   local_ts        device clock at creation; server_ts is authoritative (set on sync)
//
// bank_transactions is INCLUDED here: it is designated the canonical bank ledger
// (R4). A later stage ensures every balance change writes it and derives
// current_balance from it; this stage only makes it syncable.
// inventory_reservations is INCLUDED (R5 — becomes append-only in a later stage).

const TABLES = [
  'lot_transactions', 'inventory_lots', 'milling_batches', 'local_sales', 'payments',
  'journal_entries', 'export_orders', 'business_expenses', 'mill_expenses',
  'receivables', 'payables', 'internal_transfers', 'service_milling_dispatches',
  'service_milling_invoices', 'goods_receipt_notes', 'inventory_reservations',
  'export_quotations', 'bank_transactions',
];

const COLS = ['uuid', 'device_uuid', 'record_version', 'sync_status', 'local_ts', 'server_ts'];

exports.up = async (knex) => {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    const need = {};
    for (const c of COLS) need[c] = !(await knex.schema.hasColumn(table, c));

    await knex.schema.alterTable(table, (t) => {
      if (need.uuid) t.uuid('uuid');
      if (need.device_uuid) t.text('device_uuid');
      if (need.record_version) t.integer('record_version').notNullable().defaultTo(1);
      if (need.sync_status) t.string('sync_status', 20).notNullable().defaultTo('synced');
      if (need.local_ts) t.timestamp('local_ts');
      if (need.server_ts) t.timestamp('server_ts');
    });

    if (need.uuid) {
      await knex.schema.alterTable(table, (t) => {
        t.unique('uuid', { indexName: `uq_${table}_uuid` });
      });
    }
  }
};

exports.down = async (knex) => {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    for (const c of COLS) {
      if (await knex.schema.hasColumn(table, c)) {
        await knex.schema.alterTable(table, (t) => t.dropColumn(c)); // drops uuid's unique index too
      }
    }
  }
};
