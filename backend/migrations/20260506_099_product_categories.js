/**
 * Round-25: Product categories with parent (subcategory) support.
 *
 * Client wants to enter inventory category-wise and group reports by
 * top-level group (READY RICE / BY-PRODUCTS / RAW RICE) plus admin
 * CRUD on category + subcategory.
 *
 * - product_categories table with self-referential parent_id
 * - products.category_id FK (keeps existing string `category` for back-compat)
 * - seed the three top-level groups
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('product_categories'))) {
    await knex.schema.createTable('product_categories', (t) => {
      t.increments('id').primary();
      t.string('name', 100).notNullable();
      t.integer('parent_id').nullable().references('id').inTable('product_categories').onDelete('SET NULL');
      t.string('group_key', 30); // 'ready_rice' | 'by_products' | 'raw_rice' | custom
      t.text('description');
      t.boolean('is_active').defaultTo(true);
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX product_categories_parent_id_idx ON product_categories(parent_id)');
  }

  // Seed the three canonical top-level groups (idempotent)
  const seeds = [
    { name: 'Ready Rice', group_key: 'ready_rice' },
    { name: 'By-Products', group_key: 'by_products' },
    { name: 'Raw Rice', group_key: 'raw_rice' },
  ];
  for (const s of seeds) {
    const existing = await knex('product_categories').where({ group_key: s.group_key }).first();
    if (!existing) {
      await knex('product_categories').insert({ ...s, parent_id: null });
    }
  }

  // Add category_id to products if not present
  if (await knex.schema.hasTable('products')) {
    if (!(await knex.schema.hasColumn('products', 'category_id'))) {
      await knex.schema.alterTable('products', (t) => {
        t.integer('category_id').nullable().references('id').inTable('product_categories').onDelete('SET NULL');
      });
      await knex.raw('CREATE INDEX products_category_id_idx ON products(category_id)');
    }

    // Backfill: map existing products to canonical groups by simple heuristic
    const ready = await knex('product_categories').where({ group_key: 'ready_rice' }).first();
    const byp = await knex('product_categories').where({ group_key: 'by_products' }).first();
    const raw = await knex('product_categories').where({ group_key: 'raw_rice' }).first();

    if (ready && byp && raw) {
      await knex.raw(
        `UPDATE products SET category_id = ?
         WHERE category_id IS NULL AND (
           LOWER(COALESCE(name,'')) LIKE '%paddy%' OR
           LOWER(COALESCE(category,'')) LIKE '%raw%'
         )`,
        [raw.id]
      );
      await knex.raw(
        `UPDATE products SET category_id = ?
         WHERE category_id IS NULL AND (
           is_byproduct = true OR
           LOWER(COALESCE(name,'')) ~ '(broken|bran|husk|phak)' OR
           LOWER(COALESCE(category,'')) LIKE '%by%'
         )`,
        [byp.id]
      );
      // Anything else with category 'Rice' or null → Ready Rice
      await knex.raw(
        `UPDATE products SET category_id = ? WHERE category_id IS NULL`,
        [ready.id]
      );
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('products', 'category_id')) {
    await knex.schema.alterTable('products', (t) => { t.dropColumn('category_id'); });
  }
  await knex.schema.dropTableIfExists('product_categories');
};
