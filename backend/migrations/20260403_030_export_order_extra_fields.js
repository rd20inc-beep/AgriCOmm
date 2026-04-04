/**
 * Add extra fields for export document generation:
 * voyage number, GD number, multiple FI numbers, notify party, shipment remarks
 */
exports.up = function (knex) {
  return knex.schema.alterTable('export_orders', (table) => {
    table.string('voyage_number', 50).nullable();
    table.string('gd_number', 100).nullable();
    table.date('gd_date').nullable();
    table.string('fi_number_2', 100).nullable();
    table.string('fi_number_3', 100).nullable();
    table.string('notify_party_name', 255).nullable();
    table.text('notify_party_address').nullable();
    table.string('notify_party_phone', 50).nullable();
    table.string('notify_party_email', 255).nullable();
    table.text('shipment_remarks').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('export_orders', (table) => {
    const cols = [
      'voyage_number', 'gd_number', 'gd_date', 'fi_number_2', 'fi_number_3',
      'notify_party_name', 'notify_party_address', 'notify_party_phone',
      'notify_party_email', 'shipment_remarks',
    ];
    cols.forEach((c) => table.dropColumn(c));
  });
};
