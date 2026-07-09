// Service Milling (toll / job-work milling) — Phase A1, part 1.
//
// "Service Milling" = we mill rice OWNED BY A THIRD-PARTY CLIENT. The paddy/rice
// is not ours; we only charge service fees (milling per-kg, rental per-katta,
// labour per-katta). Until now the New Batch card only stuffed the client name /
// contact / fee into the batch `notes` string — no structured data. This adds
// real columns to milling_batches so a service lot can be tracked, billed and
// kept out of company-owned stock/costing.
//
// Note: milling_batches already has `milling_fee_per_kg` (own-milling cost input)
// and `status` (batch workflow status). We add DISTINCT service-* columns and a
// service-specific `service_lot_status` so existing semantics are untouched.

const LOT_STATUSES = [
  'Draft', 'Received', 'In Milling', 'Milled', 'In Stock',
  'Partially Dispatched', 'Fully Dispatched', 'Closed',
];
const CNAME = 'chk_milling_batches_service_lot_status_valid';

exports.up = async (knex) => {
  const add = async (col, fn) => {
    if (!(await knex.schema.hasColumn('milling_batches', col))) {
      await knex.schema.alterTable('milling_batches', fn);
    }
  };
  await add('is_service_milling', (t) => t.boolean('is_service_milling').notNullable().defaultTo(false));
  await add('client_customer_id', (t) => t.integer('client_customer_id').nullable().references('id').inTable('customers'));
  await add('service_milling_rate_per_kg', (t) => t.decimal('service_milling_rate_per_kg', 14, 4).nullable());
  await add('service_rental_rate_per_katta', (t) => t.decimal('service_rental_rate_per_katta', 14, 4).nullable());
  await add('service_labour_rate_per_katta', (t) => t.decimal('service_labour_rate_per_katta', 14, 4).nullable());
  await add('date_received', (t) => t.date('date_received').nullable());
  await add('katta_count', (t) => t.integer('katta_count').nullable());
  await add('bag_count', (t) => t.integer('bag_count').nullable());
  await add('expected_output_kg', (t) => t.decimal('expected_output_kg', 14, 3).nullable());
  await add('service_remarks', (t) => t.text('service_remarks').nullable());
  await add('service_lot_status', (t) => t.string('service_lot_status', 30).nullable());

  // CHECK: service_lot_status ∈ whitelist (NULL for non-service batches is allowed).
  // ⚠️ COUPLING: mirrors the lot-status enum used in the Service Milling UI/service.
  const bad = await knex('milling_batches')
    .whereNotNull('service_lot_status')
    .whereNotIn('service_lot_status', LOT_STATUSES)
    .count('* as n').first();
  if (Number(bad.n) > 0) {
    throw new Error(`Cannot add CHECK on milling_batches.service_lot_status: ${bad.n} row(s) hold an invalid value.`);
  }
  const exists = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ?`, [CNAME]
  );
  if (!exists.rows.length) {
    const list = LOT_STATUSES.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE milling_batches ADD CONSTRAINT ${CNAME} ` +
      `CHECK (service_lot_status IS NULL OR service_lot_status IN (${list}))`
    );
  }

  // Partial index for the Service Milling dashboard / list queries.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_milling_batches_service ` +
    `ON milling_batches (is_service_milling) WHERE is_service_milling = true`
  );
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_milling_batches_service`);
  await knex.raw(`ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS ${CNAME}`);
  const cols = [
    'is_service_milling', 'client_customer_id', 'service_milling_rate_per_kg',
    'service_rental_rate_per_katta', 'service_labour_rate_per_katta', 'date_received',
    'katta_count', 'bag_count', 'expected_output_kg', 'service_remarks', 'service_lot_status',
  ];
  for (const col of cols) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => t.dropColumn(col));
    }
  }
};
