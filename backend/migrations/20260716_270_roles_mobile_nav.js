// Per-role mobile bottom-nav shortcuts. Additive: one nullable jsonb column on
// `roles` holding an ordered array of nav-item keys (e.g. ["home","inventory",
// "milling","sales"]) that appear on the phone bottom bar for that role. NULL =
// use the app's default set. The available items + their routes/icons live in the
// frontend registry (src/lib/mobileNavItems.js); the DB only stores the chosen keys.

exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('roles', 'mobile_nav');
  if (!has) {
    await knex.schema.alterTable('roles', (t) => {
      t.jsonb('mobile_nav');
    });
  }
};

exports.down = async (knex) => {
  const has = await knex.schema.hasColumn('roles', 'mobile_nav');
  if (has) {
    await knex.schema.alterTable('roles', (t) => {
      t.dropColumn('mobile_nav');
    });
  }
};
