/**
 * Shipment requires reserved stock (P3-13, owner decision D-18 (a), 2026-10-15).
 *
 *   system_settings.export_reservation_tolerance_pct = '2'
 *     Ready to Ship / Shipped need the order's Active reservations within
 *     ±this % of the order quantity (reservationGate.js). Seeded only when
 *     absent — an existing value is never overwritten.
 *
 *   inventory_reservations.source  varchar(20) NOT NULL DEFAULT 'manual'
 *     How a reservation came about: 'manual' (picked on the order),
 *     'suggested' (the system's suggested lot, confirmed by the user — replaces
 *     the auto-reserve on advance confirmation), 'transfer' (stock moved mill →
 *     export for the order) or 'legacy' (every row that existed before this
 *     migration — some were the old auto-reserve, which cannot be told apart).
 *     Who confirmed and when are the row's created_by / created_at.
 *
 * down() drops the column and the setting.
 */

const SETTING = { key: 'export_reservation_tolerance_pct', value: '2', category: 'export' };
const SOURCES = ['manual', 'suggested', 'transfer', 'legacy'];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('inventory_reservations', 'source'))) {
    await knex.schema.alterTable('inventory_reservations', (t) => {
      t.string('source', 20).notNullable().defaultTo('manual');
    });
    await knex('inventory_reservations').update({ source: 'legacy' });
    await knex.raw(`ALTER TABLE inventory_reservations ADD CONSTRAINT chk_inventory_reservations_source_valid
      CHECK (source IN (${SOURCES.map((s) => `'${s}'`).join(', ')}))`);
  }

  const existing = await knex('system_settings').where({ key: SETTING.key }).first();
  if (!existing) await knex('system_settings').insert(SETTING);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('inventory_reservations', 'source')) {
    await knex.raw('ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS chk_inventory_reservations_source_valid');
    await knex.schema.alterTable('inventory_reservations', (t) => { t.dropColumn('source'); });
  }
  await knex('system_settings').where({ key: SETTING.key }).del();
};
