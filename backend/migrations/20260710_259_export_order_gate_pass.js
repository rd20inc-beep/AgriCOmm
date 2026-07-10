// Export order gate pass: when an order is shipped out (goods physically leave
// the premises), a gate pass number is recorded on the shipment so it can be
// tracked later. Required at the Shipped transition (enforced in the controller).

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('export_orders', 'gate_pass_no'))) {
    await knex.schema.alterTable('export_orders', (t) => { t.string('gate_pass_no', 60); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('export_orders', 'gate_pass_no')) {
    await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('gate_pass_no'); });
  }
};
