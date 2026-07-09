// Service Milling — Phase A1, part 2: client-owned inventory tagging.
//
// A service-milling lot's finished goods + by-products physically exist in our
// warehouse (so they must appear in inventory for physical tracking), but they
// belong to the CLIENT — they must never count as company-owned stock, valuation,
// average cost, or export/local availability. We mark such lots with an explicit
// `ownership` column (default 'company' so every existing and future row is
// company-owned unless deliberately stamped 'client'). All company-owned
// aggregations filter `ownership = 'company'`; the Service inventory view filters
// `ownership = 'client'`. We keep entity = 'mill' on service lots (entity drives
// warehouse routing / GL account / currency and must not be overloaded).

const CNAME = 'chk_inventory_lots_ownership_valid';

exports.up = async (knex) => {
  const add = async (col, fn) => {
    if (!(await knex.schema.hasColumn('inventory_lots', col))) {
      await knex.schema.alterTable('inventory_lots', fn);
    }
  };
  // NOT NULL DEFAULT 'company' → existing rows backfill to company-owned, so
  // valuation/availability are byte-for-byte unchanged for current stock.
  await add('ownership', (t) => t.string('ownership', 20).notNullable().defaultTo('company'));
  await add('owner_customer_id', (t) => t.integer('owner_customer_id').nullable().references('id').inTable('customers'));
  await add('service_batch_id', (t) => t.integer('service_batch_id').nullable().references('id').inTable('milling_batches'));

  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [CNAME]);
  if (!exists.rows.length) {
    await knex.raw(
      `ALTER TABLE inventory_lots ADD CONSTRAINT ${CNAME} ` +
      `CHECK (ownership IN ('company', 'client'))`
    );
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_inventory_lots_ownership ON inventory_lots (ownership)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_inventory_lots_service_batch ON inventory_lots (service_batch_id)`);
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_inventory_lots_ownership`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inventory_lots_service_batch`);
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${CNAME}`);
  for (const col of ['ownership', 'owner_customer_id', 'service_batch_id']) {
    if (await knex.schema.hasColumn('inventory_lots', col)) {
      await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn(col));
    }
  }
};
