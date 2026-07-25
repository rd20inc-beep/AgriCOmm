// Vehicle arrivals — dedicated Gate Pass Number + departure date (AgriRice
// System Changes item #4, and the extra date field for item #3's slider).
//
// The vehicle "Notes" field is being replaced in the UI by a first-class Gate
// Pass Number so it can be searched, filtered, and printed. The legacy `notes`
// column is left in place for existing rows.

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', 'gate_pass_no'))) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
      t.string('gate_pass_no', 80);
      t.index(['gate_pass_no']);
    });
  }
  if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', 'departure_date'))) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
      t.date('departure_date');
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('milling_vehicle_arrivals', 'departure_date')) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => t.dropColumn('departure_date'));
  }
  if (await knex.schema.hasColumn('milling_vehicle_arrivals', 'gate_pass_no')) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => t.dropColumn('gate_pass_no'));
  }
};
