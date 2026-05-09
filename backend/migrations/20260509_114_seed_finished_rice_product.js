/**
 * Seed a generic "Finished Rice" product so milling yield can land
 * a lot when the batch isn't linked to an export order and has no
 * batch.product_id.
 *
 * Symptom: recordYield 500'd with
 *   "null value in column "product_id" of relation "inventory_lots""
 * because inventoryService.recordMillingOutput resolves the finished
 * lot's product as:
 *   1. batch.product_id      — usually NULL on ad-hoc mill runs
 *   2. linked export order   — usually NULL when milling first, sell later
 *   3. products.name ILIKE 'Finished Rice'  — no such product seeded
 * → finishedProductId stays NULL → NOT NULL violation on insert.
 *
 * Fix: seed FINISHED-RICE as a permanent fallback. The resolver in a
 * separate commit also looks this up by code as the final fallback
 * before failing.
 *
 * Idempotent — only inserts if no FINISHED-RICE product exists yet.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('products'))) return;

  // Already exists? skip.
  const existing = await knex('products').where({ code: 'FINISHED-RICE' }).first('id');
  if (existing) return;

  // Resolve a category for the new product if categories exist
  let categoryId = null;
  try {
    const cat = await knex('product_categories').where({ group_key: 'ready_rice' }).first('id');
    if (cat) categoryId = cat.id;
  } catch (_) { /* product_categories may not exist on very-old envs */ }

  await knex('products').insert({
    name: 'Finished Rice',
    code: 'FINISHED-RICE',
    category: 'Rice',
    description: 'Generic finished-rice product used as a fallback when a milling batch has no specific product or linked export order. Override with a specific variety (Basmati / IRRI / etc.) when known.',
    is_byproduct: false,
    is_active: true,
    ...(categoryId ? { category_id: categoryId } : {}),
  });
};

exports.down = async function (knex) {
  await knex('products').where({ code: 'FINISHED-RICE' }).del();
};
