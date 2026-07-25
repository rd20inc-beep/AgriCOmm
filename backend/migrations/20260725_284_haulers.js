// Transport / Hauler master (AgriRice System Changes item #5) — a dedicated
// registry of transport contractors, SEPARATE from suppliers. Purchase lots and
// vehicle arrivals now reference a hauler rather than borrowing the suppliers
// list for their "Transport / Hauler" dropdown.
//
// Scope (confirmed): entity + selection + basic history. Freight payables keep
// riding the existing payables/GL rail — the freight payable now attributes to a
// hauler via payables.hauler_id (supplier_id left NULL for freight), so the
// general ledger stays balanced without a finance-engine rewrite. The per-hauler
// payment / outstanding UI is intentionally deferred.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('haulers'))) {
    await knex.schema.createTable('haulers', (t) => {
      t.increments('id').primary();
      t.string('name', 160).notNullable();
      t.string('contact_person', 120);
      t.string('phone', 60);
      t.string('email', 160);
      t.text('address');
      t.string('ntn', 40);           // tax id, optional
      t.string('vehicle_types', 200); // free-text note of fleet, optional
      t.text('notes');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('created_by').references('id').inTable('users');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.index(['is_active']);
      t.index(['name']);
    });
  }

  // Lot-level hauler selection (replaces the supplier-based transport_vendor_id
  // going forward; transport_vendor_id is left in place for legacy rows).
  if (!(await knex.schema.hasColumn('inventory_lots', 'hauler_id'))) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.integer('hauler_id').references('id').inTable('haulers').onDelete('SET NULL');
      t.index(['hauler_id']);
    });
  }

  // Per-vehicle hauler (the add-vehicle slider records who carried each truck).
  if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', 'hauler_id'))) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
      t.integer('hauler_id').references('id').inTable('haulers').onDelete('SET NULL');
      t.index(['hauler_id']);
    });
  }

  // Freight payable attribution — a hauler payable keeps supplier_id NULL and
  // stamps hauler_id instead, so the GL stays balanced and the freight cost is
  // traceable to the hauler for basic history.
  if (!(await knex.schema.hasColumn('payables', 'hauler_id'))) {
    await knex.schema.alterTable('payables', (t) => {
      t.integer('hauler_id').references('id').inTable('haulers').onDelete('SET NULL');
      t.index(['hauler_id']);
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('payables', 'hauler_id')) {
    await knex.schema.alterTable('payables', (t) => t.dropColumn('hauler_id'));
  }
  if (await knex.schema.hasColumn('milling_vehicle_arrivals', 'hauler_id')) {
    await knex.schema.alterTable('milling_vehicle_arrivals', (t) => t.dropColumn('hauler_id'));
  }
  if (await knex.schema.hasColumn('inventory_lots', 'hauler_id')) {
    await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn('hauler_id'));
  }
  await knex.schema.dropTableIfExists('haulers');
};
