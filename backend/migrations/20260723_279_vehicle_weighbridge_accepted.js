// Vehicle Details in New Purchase Lot (client change request #4).
//
// A truck arrival already records the DECLARED weight/bags. This adds the two
// remaining checkpoints so the intake trail is complete and the purchase →
// vehicle → weighbridge → accepted variance can be shown + kept on the lot ledger:
//   weighbridge_kg — the actual weighed quantity at the bridge
//   accepted_kg    — the final accepted quantity after any rejection/deduction
// Both nullable (older arrivals + optional entry). weight_kg stays the declared/
// received figure the lot's costing already uses.

exports.up = async (knex) => {
  const add = async (col, fn) => {
    if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', col))) {
      await knex.schema.alterTable('milling_vehicle_arrivals', fn);
    }
  };
  await add('weighbridge_kg', (t) => t.decimal('weighbridge_kg', 15, 2).nullable());
  await add('accepted_kg', (t) => t.decimal('accepted_kg', 15, 2).nullable());
};

exports.down = async (knex) => {
  for (const col of ['weighbridge_kg', 'accepted_kg']) {
    if (await knex.schema.hasColumn('milling_vehicle_arrivals', col)) {
      await knex.schema.alterTable('milling_vehicle_arrivals', (t) => t.dropColumn(col));
    }
  }
};
