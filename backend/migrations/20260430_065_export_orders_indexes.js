/**
 * Add the indexes the read paths actually use.
 *
 *  - export_order_status_history(order_id, created_at DESC) — joined for the
 *    timeline tab and used to read recent status moves.
 *  - export_order_documents(order_id) — checklist + doc-join lookup.
 *  - export_orders(status, created_at DESC) — list page filters by status and
 *    orders by recency in one query.
 *  - export_order_items(order_id) — already covered by the composite
 *    (order_id, line_no), so not added again.
 */

const TARGETS = [
  {
    name: 'idx_eosh_order_created',
    table: 'export_order_status_history',
    sql: `CREATE INDEX IF NOT EXISTS idx_eosh_order_created
            ON export_order_status_history (order_id, created_at DESC)`,
  },
  {
    name: 'idx_eod_order_id',
    table: 'export_order_documents',
    sql: `CREATE INDEX IF NOT EXISTS idx_eod_order_id
            ON export_order_documents (order_id)`,
  },
  {
    name: 'idx_eo_status_created',
    table: 'export_orders',
    sql: `CREATE INDEX IF NOT EXISTS idx_eo_status_created
            ON export_orders (status, created_at DESC)`,
  },
];

exports.up = async function (knex) {
  for (const t of TARGETS) {
    const has = await knex.schema.hasTable(t.table);
    if (!has) continue;
    await knex.raw(t.sql);
  }
};

exports.down = async function (knex) {
  for (const t of TARGETS) {
    await knex.raw(`DROP INDEX IF EXISTS ${t.name}`);
  }
};
