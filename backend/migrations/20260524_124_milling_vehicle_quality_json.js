/**
 * Per-vehicle quality data on milling_vehicle_arrivals.
 *
 * Captures moisture, broken%, foreign matter, price/MT, etc. for the
 * specific truck — the batch-level arrival sample stays as the rolled-up
 * average. JSONB so we can add new fields without further migrations.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_vehicle_arrivals'))) return;
  if (await knex.schema.hasColumn('milling_vehicle_arrivals', 'quality_json')) return;
  await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
    t.jsonb('quality_json').nullable();
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_vehicle_arrivals'))) return;
  if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', 'quality_json'))) return;
  await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
    t.dropColumn('quality_json');
  });
};
